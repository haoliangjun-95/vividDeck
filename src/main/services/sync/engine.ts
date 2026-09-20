/**
 * 同步引擎（主进程）
 *
 * 触发时机：应用启动 / 本地素材库变更后防抖 30s（autoSync 可关）/ 手动（设置页、托盘）
 * 流程：连接 → 拉全部清单快照 → CRDT 合并（LWW+墓碑+去重）→ 本地落地
 *      → 上传缺失二进制与缩略图（内容寻址，断点友好）→ 发布新清单快照 → 压缩旧快照
 * 并发模型：每设备写独立快照（manifests/<deviceId>-<ts>.json），合并幂等可交换，
 *          无需条件写；进程内互斥锁防止本设备重入。
 */
import { BrowserWindow, app } from 'electron'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { IPC_EVENTS } from '@shared/ipc'
import type {
  ImageItem,
  SyncConfig,
  SyncDownloadScope,
  SyncProgress,
  SyncResultStats,
  SyncStatus
} from '@shared/types'
import { JsonStore } from '../store'
import { isRealFile, libraryDir } from '../paths'
import { getLibrary, applySyncMerge, markLocalFile, onLibraryChanged } from '../library'
import { ensureThumb, thumbPath } from '../thumbnails'
import { getDeviceId } from '../device'
import { listTombstones, replaceTombstones } from '../tombstones'
import { getSyncConfig, hasSecret, loadSecret } from './store'
import { mergeAll } from './merge'
import * as client from './client'

interface EngineState {
  lastSyncAt: number | null
  lastError: string | null
  lastResult: SyncResultStats | null
  /** 已确认上传过的内容哈希（跨重启，避免每次同步全量 HEAD） */
  uploadedHashes: string[]
}

const engineStore = new JsonStore<EngineState>('sync-state', {
  lastSyncAt: null,
  lastError: null,
  lastResult: null,
  uploadedHashes: []
})

/** 正在按需下载的图片（防止并发重复下载） */
const inflightDownloads = new Map<string, Promise<string>>()
/** 同步互斥 */
let running = false
/** 合并落地中（此时忽略变更防抖，防止同步自触发） */
let applying = false
/** 变更防抖定时器 */
let debounceTimer: NodeJS.Timeout | null = null

function broadcast(channel: string, payload?: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(channel, payload)
  }
}

function progress(p: SyncProgress): void {
  broadcast(IPC_EVENTS.SYNC_PROGRESS, p)
}

function getUploadedSet(): Set<string> {
  return new Set(engineStore.get().uploadedHashes)
}

function markUploaded(hash: string): void {
  const state = engineStore.get()
  if (!state.uploadedHashes.includes(hash)) {
    engineStore.set({ uploadedHashes: [...state.uploadedHashes, hash] })
  }
}

function isConfigured(): boolean {
  const cfg = getSyncConfig()
  return cfg.endpoint !== '' && cfg.accessKey !== '' && hasSecret()
}

/**
 * 开发模式同步保险丝：未打包运行（npm run dev / npx electron .）时禁止同步，
 * 防止开发实例携带真实凭据误写共享桶（曾因遗留的 dev userData 差点污染真实数据）。
 * 显式设置 VD_ALLOW_DEV_SYNC=1 可在开发模式下开启（联调同步功能时用）。
 */
function devSyncBlocked(): boolean {
  return !app.isPackaged && process.env.VD_ALLOW_DEV_SYNC !== '1'
}

function makeClient(): { cfg: SyncConfig; client: import('minio').Client } | null {
  const cfg = getSyncConfig()
  if (!isConfigured()) return null
  return { cfg, client: client.createClient(cfg, loadSecret()) }
}

export function getStatus(): SyncStatus {
  const cfg = getSyncConfig()
  return {
    configured: isConfigured(),
    hasSecret: hasSecret(),
    enabled: cfg.enabled,
    running,
    lastSyncAt: engineStore.get().lastSyncAt,
    lastError: engineStore.get().lastError,
    lastResult: engineStore.get().lastResult,
    cloudOnlyCount: getLibrary().images.filter((img) => !img.localFile).length
  }
}

/** 并发执行（简单池） */
async function runPool<T>(items: T[], limit: number, fn: (item: T, index: number) => Promise<void>): Promise<void> {
  let index = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (index < items.length) {
      const i = index++
      await fn(items[i], i)
    }
  })
  await Promise.all(workers)
}

/** 完整同步（互斥） */
export async function syncNow(): Promise<SyncResultStats> {
  if (running) throw new Error('同步正在进行中')
  if (devSyncBlocked()) throw new Error('开发模式下同步已禁用（设置 VD_ALLOW_DEV_SYNC=1 可开启）')
  const made = makeClient()
  if (!made) throw new Error('尚未配置同步（请在设置中填写 MinIO 连接信息）')
  const { cfg, client: mc } = made
  const t0 = Date.now()
  running = true
  const stats: SyncResultStats = { pushed: 0, pulled: 0, uploaded: 0, downloaded: 0, conflicts: 0, durationMs: 0 }
  try {
    progress({ phase: 'connecting', current: 0, total: 0, message: `连接 ${cfg.endpoint}:${cfg.port}…` })
    await client.testAndPrepareBucket(mc, cfg.bucket)

    // 1) 拉取全部清单
    progress({ phase: 'merging', current: 0, total: 1, message: '拉取云端清单…' })
    const manifests = await client.fetchManifests(mc, cfg.bucket)

    // 2) 合并
    const local = getLibrary()
    const merged = mergeAll({
      localImages: local.images,
      localCategories: local.categories,
      localTombstones: listTombstones(),
      remoteManifests: manifests.map((m) => m.manifest)
    })
    Object.assign(stats, merged.stats)

    // 3) 本地落地（远端新记录进入本地；本地态保留）
    applying = true
    try {
      if (merged.images.length !== local.images.length || merged.categories.length !== local.categories.length || stats.pulled > 0) {
        applySyncMerge(merged.images, merged.categories)
        replaceTombstones(merged.tombstones)
        broadcast(IPC_EVENTS.LIBRARY_CHANGED)
      } else {
        replaceTombstones(merged.tombstones)
      }
    } finally {
      applying = false
    }

    // 4) 下载远端新图的缩略图（小文件、并发 4；失败不阻塞同步）
    const cloudImages = merged.images.filter((img) => !img.localFile)
    if (cloudImages.length > 0) {
      progress({ phase: 'downloading', current: 0, total: cloudImages.length, message: '同步缩略图…' })
      let done = 0
      await runPool(cloudImages, 4, async (img) => {
        try {
          const target = thumbPath(img)
          if (!fs.existsSync(target)) {
            await client.downloadFile(mc, cfg.bucket, `thumbs/${path.basename(target)}`, target)
          }
        } catch {
          /* 缩略图缺失仅影响首屏显示，下载原图后会补生成 */
        } finally {
          done++
          progress({ phase: 'downloading', current: done, total: cloudImages.length, message: '同步缩略图…' })
        }
      })
    }

    // 5) 上传缺失的二进制与缩略图（并发 2）
    const uploaded = getUploadedSet()
    const withFile = merged.images.filter((img) => img.localFile && isRealFile(img.path))
    const needUpload = withFile.filter((img) => !uploaded.has(img.hash))
    if (needUpload.length > 0) {
      progress({ phase: 'uploading', current: 0, total: needUpload.length, message: '' })
      let done = 0
      await runPool(needUpload, 2, async (img) => {
        try {
          if (!(await client.objectExists(mc, cfg.bucket, `objects/${img.hash}`))) {
            await client.uploadFile(mc, cfg.bucket, `objects/${img.hash}`, img.path, 'application/octet-stream')
          }
          // 缩略图一并上传（新设备画廊秒开的关键）
          const thumb = await ensureThumb(img)
          const thumbKey = `thumbs/${path.basename(thumb)}`
          if (!(await client.objectExists(mc, cfg.bucket, thumbKey))) {
            await client.uploadFile(mc, cfg.bucket, thumbKey, thumb, 'image/webp')
          }
          markUploaded(img.hash)
          stats.uploaded++
        } catch (err) {
          console.error(`[sync] 上传失败 ${img.fileName}:`, err)
        } finally {
          done++
          progress({ phase: 'uploading', current: done, total: needUpload.length, message: `上传 ${done}/${needUpload.length}` })
        }
      })
    }

    // 6) 发布清单快照（无差异则跳过）
    if (merged.manifestToPublish) {
      progress({ phase: 'finalizing', current: 0, total: 0, message: '发布清单…' })
      const snapshot = { ...merged.manifestToPublish, updatedBy: getDeviceId() }
      await client.putObjectJson(mc, cfg.bucket, `manifests/${getDeviceId()}-${Date.now()}.json`, snapshot)
      stats.pushed = snapshot.images.length
    }

    // 7) 压缩旧快照
    await client.compactManifests(mc, cfg.bucket, manifests, {
      version: 1,
      updatedAt: Date.now(),
      updatedBy: getDeviceId(),
      images: merged.images.map((img) => ({
        id: img.id, fileName: img.fileName, hash: img.hash, width: img.width, height: img.height,
        sizeBytes: img.sizeBytes, format: img.format, categoryId: img.categoryId, tags: img.tags,
        favorite: img.favorite, addedAt: img.addedAt, updatedAt: img.updatedAt, updatedBy: img.updatedBy ?? ''
      })),
      categories: merged.categories,
      tombstones: merged.tombstones
    })

    stats.durationMs = Date.now() - t0
    engineStore.set({ lastSyncAt: Date.now(), lastError: null, lastResult: stats })
    progress({ phase: 'finalizing', current: 1, total: 1, message: '同步完成' })
    broadcast(IPC_EVENTS.SYNC_DONE, { ok: true, stats })
    broadcast(IPC_EVENTS.LIBRARY_CHANGED)
    return stats
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[sync] 同步失败:', message)
    engineStore.set({ lastSyncAt: Date.now(), lastError: message })
    broadcast(IPC_EVENTS.SYNC_DONE, { ok: false, error: message })
    throw err
  } finally {
    running = false
    engineStore.flush()
  }
}

/** 连接测试（不要求已启用） */
export async function testConnection(): Promise<{ ok: true; bucketCreated: boolean } | { ok: false; error: string }> {
  const made = makeClient()
  if (!made) return { ok: false, error: '请先填写完整的连接信息（地址 / AccessKey / SecretKey）' }
  try {
    const { bucketCreated } = await client.testAndPrepareBucket(made.client, made.cfg.bucket)
    return { ok: true, bucketCreated }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/**
 * 按需下载原图到本地（幂等）：
 * media://original、设壁纸、轮播命中时调用；下载后生成缩略图并回填记录。
 */
export async function ensureLocal(imageId: string): Promise<string> {
  const image = getLibrary().images.find((img) => img.id === imageId)
  if (!image) throw new Error('图片不存在')
  if (image.localFile && isRealFile(image.path)) return image.path

  const made = makeClient()
  if (!made) throw new Error('该图片仅在云端，请先配置并启用同步')

  const existing = inflightDownloads.get(imageId)
  if (existing) return existing

  const task = (async (): Promise<string> => {
    // 下载到媒体库（文件名冲突以 id 前缀规避）
    const safeName = `${image.id.slice(-6)}_${image.fileName.replace(/[/\\:*?"<>|]/g, '_')}`
    const target = path.join(libraryDir(), safeName)
    await client.downloadFile(made.client, made.cfg.bucket, `objects/${image.hash}`, target)
    // 顺带补缩略图
    try {
      await ensureThumb({ ...image, path: target })
    } catch {
      /* 缩略图失败不影响主流程 */
    }
    markLocalFile(imageId, target)
    inflightDownloads.delete(imageId)
    broadcast(IPC_EVENTS.LIBRARY_CHANGED)
    return target
  })()

  inflightDownloads.set(imageId, task)
  try {
    return await task
  } catch (err) {
    inflightDownloads.delete(imageId)
    // 清理半成品文件
    const safeName = `${image.id.slice(-6)}_${image.fileName.replace(/[/\\:*?"<>|]/g, '_')}`
    await fsp.unlink(path.join(libraryDir(), safeName)).catch(() => undefined)
    throw err
  }
}

/** 批量下载（离线准备） */
export async function downloadScope(scope: SyncDownloadScope): Promise<{ downloaded: number; failed: number }> {
  const images = getLibrary().images.filter((img) => {
    if (img.localFile) return false
    if (scope.type === 'favorite') return img.favorite
    if (scope.type === 'category') return img.categoryId === scope.categoryId
    return true
  })
  let downloaded = 0
  let failed = 0
  progress({ phase: 'downloading', current: 0, total: images.length, message: '批量下载原图…' })
  for (const img of images) {
    try {
      await ensureLocal(img.id)
      downloaded++
    } catch {
      failed++
    }
    progress({ phase: 'downloading', current: downloaded + failed, total: images.length, message: `下载 ${downloaded + failed}/${images.length}` })
  }
  return { downloaded, failed }
}

/** 引擎初始化：注册变更防抖 + 启动时同步 */
export function initSyncEngine(): void {
  if (devSyncBlocked()) {
    console.log('[sync] 开发模式下同步已禁用（VD_ALLOW_DEV_SYNC=1 可开启）')
    return
  }
  onLibraryChanged(() => {
    if (applying || running) return
    const cfg = getSyncConfig()
    if (!cfg.enabled || !cfg.autoSync) return
    if (debounceTimer) clearTimeout(debounceTimer)
    debounceTimer = setTimeout(() => {
      debounceTimer = null
      syncNow().catch(() => undefined)
    }, 30_000)
  })

  const cfg = getSyncConfig()
  if (cfg.enabled && cfg.autoSync && isConfigured()) {
    // 启动后 5 秒做首次同步（避开启动高峰）
    setTimeout(() => {
      syncNow().catch((err) => console.error('[sync] 启动同步失败:', err))
    }, 5_000)
  }
}

export function flushSyncEngine(): void {
  engineStore.flush()
}
