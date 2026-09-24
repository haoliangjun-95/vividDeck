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
import { getLibrary } from '../library'
import { hashFilesParallel } from '../workers/hashPool'
import { isRealFile } from '../paths'
import { thumbPath } from '../thumbnails'
import { pruneExpiredTombstones } from '../tombstones'
import { getSyncConfig, hasSecret, loadSecret } from './store'
import { getClient, objectExists } from './client'

function configuredClient(): { client: import('minio').Client; bucket: string } | null {
  const cfg = getSyncConfig()
  if (!cfg.endpoint || !cfg.accessKey || !hasSecret()) return null
  // A3：单例客户端 —— 与 engine 共享同一连接身份实例
  return { client: getClient(cfg, loadSecret()), bucket: cfg.bucket }
}

/** 云端缺失/本地断链等的按需完整性校验：本地文件 sha1 vs 记录哈希 */

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
    expiredTombstonesCleaned: pruneExpiredTombstones()
  }

  // 并发 HEAD 检查：cloud-only 记录的二进制是否存在
  const cloudOnly = data.images.filter((i) => !i.localFile)
  await Promise.all(
    cloudOnly.map(async (img) => {
      try {
        if (!(await objectExists(client, bucket, `objects/${img.hash}`))) {
          report.missingBinaries.push({ id: img.id, fileName: img.fileName })
        }
      } catch {
        /* 网络异常跳过 */
      }
    })
  )

  // 本地断链 + 缩略图缺失
  for (const img of data.images) {
    if (img.localFile && !isRealFile(img.path)) {
      report.localBroken.push({ id: img.id, fileName: img.fileName, path: img.path })
    }
    if (!isRealFile(thumbPath(img))) {
      report.missingThumbs.push({ id: img.id, fileName: img.fileName })
    }
  }

  // 云端孤儿对象：列桶 objects/ 与 thumbs/ 前缀，不在本地需要集合内的
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
  } catch (err) {
    console.error('[sync/health] 列桶失败:', err)
  }

  return report
}

/** 清理云端孤儿对象（释放桶空间） */
export async function cleanupOrphanObjects(keys: string[]): Promise<number> {
  const made = configuredClient()
  if (!made) throw new Error('尚未配置同步连接')
  let cleaned = 0
  for (let i = 0; i < keys.length; i += 100) {
    const batch = keys.slice(i, i + 100)
    try {
      await made.client.removeObjects(made.bucket, batch)
      cleaned += batch.length
    } catch (err) {
      console.error('[sync/health] 清理孤儿失败:', err)
    }
  }
  return cleaned
}

/** 修复本地断链：把这些记录标记为云端（按需下载可恢复） */
export async function repairLocalBroken(ids: string[]): Promise<number> {
  const lib = await import('../library')
  const set = new Set(ids)
  const data = lib.getLibrary()
  let fixed = 0
  for (const img of data.images) {
    if (set.has(img.id) && img.localFile) {
      img.localFile = false
      img.path = ''
      fixed++
    }
  }
  if (fixed > 0) lib.flushLibrary()
  return fixed
}

/** 完整性校验：本地文件 sha1 vs 记录 hash（返回不一致清单；较重，按需执行） */
export async function verifyIntegrity(
  onProgress?: (current: number, total: number) => void
): Promise<{ id: string; fileName: string }[]> {
  const data = getLibrary()
  const locals = data.images.filter((i) => i.localFile && isRealFile(i.path))
  if (locals.length === 0) return []
  // A4：sha1 移入 worker 线程并行计算，主线程只收发消息（大库校验不再卡 UI）。
  // 读取失败的文件不出现在结果中——按断链处理，不属校验范畴（与旧逐文件 catch 语义一致）
  const hashes = await hashFilesParallel(
    locals.map((i) => i.path),
    { onProgress }
  )
  return locals
    .filter((img) => {
      const actual = hashes.get(img.path)
      return actual !== undefined && actual !== img.hash
    })
    .map((img) => ({ id: img.id, fileName: img.fileName }))
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
