/**
 * 同步健康检查（只读体检 + 修复动作）
 * 三方对账：本地库记录 vs 桶内 objects/thumbs vs manifest。
 * - 云端孤儿对象：桶里有、本地库不需要（可清理释放空间）
 * - 缺失二进制：cloud-only 记录在桶中无 objects/<hash>（其他设备也未上传）
 * - 本地断链：localFile=true 但磁盘文件丢失（可重下载或标记云端）
 * - 缩略图缺失：本地无缩略图且桶中也无（影响画廊首屏）
 * - 过期墓碑：顺带执行 90 天 TTL 清理（此前无调用方）
 */
import type { SyncHealthReport } from '@shared/types'
import { getLibrary, markCloudOnly } from '../library'
import { hashFile } from '../../utils/fs'
import { isRealFile } from '../paths'
import { thumbPath } from '../thumbnails'
import { pruneExpiredTombstones } from '../tombstones'
import { runPool } from '../../utils/concurrency'
import { getSyncConfig, hasSecret, loadSecret } from './store'
import { createClient, fetchManifests } from './client'
import { isDeletableObjectKey } from './validate'

function configuredClient(): { client: import('minio').Client; bucket: string } | null {
  const cfg = getSyncConfig()
  if (!cfg.endpoint || !cfg.accessKey || !hasSecret()) return null
  return { client: createClient(cfg, loadSecret()), bucket: cfg.bucket }
}

/** HEAD 检查并发上限（旧实现无上限 Promise.all，大库瞬时打满连接） */
const HEAD_CHECK_CONCURRENCY = 12
/** 完整性校验并发上限（sha1 为 CPU/IO 混合负载，保守并发） */
const VERIFY_CONCURRENCY = 4
/** 单次孤儿清理上限（防渲染端传入超长数组打爆批处理循环） */
const CLEANUP_KEY_LIMIT = 10_000

/**
 * H10：上次体检确认的孤儿 key 白名单（进程内存）。
 * cleanupOrphanObjects 只允许删除这里存在的 key —— 渲染进程传入的
 * keys 是不可信输入，直接透传等于把桶内任意对象的删除权交给前端。
 */
let lastOrphanKeys: Set<string> | null = null

/** 判断 statObject 错误是否为"对象确实不存在"（网络错误不算，避免误报缺失） */
function isNotFoundError(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false
  const code = (err as { code?: string }).code
  if (code === 'NotFound' || code === 'NoSuchKey') return true
  const status = (err as { statusCode?: number }).statusCode
  return status === 404
}

export async function runHealthCheck(): Promise<SyncHealthReport> {
  const made = configuredClient()
  if (!made) throw new Error('尚未配置同步连接')
  const { client, bucket } = made

  const data = getLibrary()
  const knownHashes = new Set(data.images.map((i) => i.hash))
  const report: SyncHealthReport = {
    checkedAt: Date.now(),
    cloudOrphanObjects: [],
    missingBinaries: [],
    localBroken: [],
    missingThumbs: [],
    expiredTombstonesCleaned: pruneExpiredTombstones(),
  }

  // H1：并发 HEAD 检查（runPool 限流替代无上限 Promise.all）；
  // 仅 NotFound 类错误判定缺失，网络异常跳过（旧实现 objectExists 吞掉
  // 所有异常返回 false，断网时全库误报 missingBinaries）
  const cloudOnly = data.images.filter((i) => !i.localFile)
  await runPool(cloudOnly, HEAD_CHECK_CONCURRENCY, async (img) => {
    try {
      await client.statObject(bucket, `objects/${img.hash}`)
    } catch (err) {
      if (isNotFoundError(err)) {
        report.missingBinaries.push({ id: img.id, fileName: img.fileName })
      }
      /* 网络等其他异常：跳过，不误报 */
    }
  })

  // 本地断链 + 缩略图缺失
  for (const img of data.images) {
    if (img.localFile && !isRealFile(img.path)) {
      report.localBroken.push({ id: img.id, fileName: img.fileName, path: img.path })
    }
    if (!isRealFile(thumbPath(img))) {
      report.missingThumbs.push({ id: img.id, fileName: img.fileName })
    }
  }

  // 云端孤儿对象：列桶 objects/ 前缀，不在本地需要集合内的。
  // 扫描结果缓存为白名单（H10）：cleanupOrphanObjects 只允许删这些 key
  try {
    const stream = client.listObjectsV2(bucket, 'objects/', true)
    const objectKeys: string[] = await new Promise((resolve, reject) => {
      const keys: string[] = []
      stream.on('data', (o) => o.name && keys.push(o.name))
      stream.on('end', () => resolve(keys))
      stream.on('error', reject)
    })
    for (const key of objectKeys) {
      const hash = key.split('/').pop() ?? ''
      if (hash && !knownHashes.has(hash)) {
        report.cloudOrphanObjects.push(key)
      }
    }
    lastOrphanKeys = new Set(report.cloudOrphanObjects)
  } catch (err) {
    console.error('[sync/health] 列桶失败:', err)
    lastOrphanKeys = null
  }

  return report
}

/**
 * 清理云端孤儿对象（释放桶空间）。
 * H10：keys 来自渲染进程（不可信），逐条校验 ——
 * 1) 必须是本次进程内最近一次体检确认过的孤儿（lastOrphanKeys 白名单）
 * 2) 必须匹配 objects/<40位hex> 格式（isDeletableObjectKey），
 *    杜绝借道删除 manifests/、thumbs/ 或构造的越权 key
 * 去重并限长后按 100/批调用 removeObjects；minio 8.x Quiet 模式下
 * 返回数组仅含失败项（{ Error: {...} }），据此计算实际清理数。
 */
export async function cleanupOrphanObjects(keys: string[]): Promise<number> {
  if (!Array.isArray(keys)) throw new Error('参数错误：keys 必须是数组')
  if (lastOrphanKeys === null) throw new Error('请先运行体检后再清理孤儿对象')
  const made = configuredClient()
  if (!made) throw new Error('尚未配置同步连接')

  const allowed = [...new Set(keys)].filter(
    (k): k is string => typeof k === 'string' && isDeletableObjectKey(k) && lastOrphanKeys!.has(k)
  ).slice(0, CLEANUP_KEY_LIMIT)

  let cleaned = 0
  for (let i = 0; i < allowed.length; i += 100) {
    const batch = allowed.slice(i, i + 100)
    try {
      const results = await made.client.removeObjects(made.bucket, batch)
      const failedKeys = new Set<string>()
      for (const r of results ?? []) {
        const errKey = r?.Error?.Key
        if (errKey) failedKeys.add(errKey)
      }
      cleaned += batch.length - failedKeys.size
      for (const k of batch) {
        if (!failedKeys.has(k)) lastOrphanKeys!.delete(k)
      }
    } catch (err) {
      console.error('[sync/health] 清理孤儿失败:', err)
    }
  }
  return cleaned
}

/**
 * 修复本地断链：把这些记录标记为云端（按需下载可恢复）。
 * H10：ids 来自渲染进程，先在主进程校验"确实断链"
 * （id 存在 && localFile=true && 磁盘文件缺失）才修，
 * 并走 markCloudOnly 提交（不可变更新 + 统一落盘），不再就地改写库对象。
 */
export async function repairLocalBroken(ids: string[]): Promise<number> {
  if (!Array.isArray(ids)) throw new Error('参数错误：ids 必须是数组')
  const data = getLibrary()
  const idSet = new Set(ids.filter((id): id is string => typeof id === 'string'))
  const validIds = data.images
    .filter((img) => idSet.has(img.id) && img.localFile && !isRealFile(img.path))
    .map((img) => img.id)
  if (validIds.length === 0) return 0
  markCloudOnly(validIds)
  return validIds.length
}

/** 完整性校验：本地文件 sha1 vs 记录 hash（返回不一致清单；较重，按需执行） */
export async function verifyIntegrity(
  onProgress?: (current: number, total: number) => void
): Promise<{ id: string; fileName: string }[]> {
  const data = getLibrary()
  const locals = data.images.filter((i) => i.localFile && isRealFile(i.path))
  const bad: { id: string; fileName: string }[] = []
  // 串行改为限流并发（H1）；done 计数驱动进度回调
  let done = 0
  await runPool(locals, VERIFY_CONCURRENCY, async (img) => {
    try {
      const actual = await hashFile(img.path)
      if (actual !== img.hash) bad.push({ id: img.id, fileName: img.fileName })
    } catch {
      /* 读取失败按断链处理，不属校验范畴 */
    } finally {
      done++
      onProgress?.(done, locals.length)
    }
  })
  return bad
}

/** 下载容量预估（scope 内云端图的数量与总字节） */
export async function estimateDownload(): Promise<{ count: number; sizeBytes: number }> {
  const data = getLibrary()
  const cloudOnly = data.images.filter((i) => !i.localFile)
  return {
    count: cloudOnly.length,
    sizeBytes: cloudOnly.reduce((s, i) => s + i.sizeBytes, 0)
  }
}

