/**
 * MinIO 客户端封装（minio-js）
 * 桶布局：
 *   manifests/<deviceId>-<ts>.json   每设备清单快照（CRDT，并发安全）
 *   manifests/base-<ts>.json         压缩合并基线（旧快照清理后）
 *   thumbs/<id>_<hash8>.webp         缩略图（全量同步，新设备画廊秒开）
 *   objects/<hash>                   图片二进制（内容寻址，天然去重）
 */
import * as Minio from 'minio'
import type { SyncConfig, SyncManifest } from '@shared/types'
import { runPool } from '../../utils/concurrency'
import { sanitizeManifest } from './validate'

/** manifest 并发拉取上限（旧实现串行，多设备时同步启动慢；也不应无上限） */
const MANIFEST_FETCH_CONCURRENCY = 4

export interface RemoteManifestObject {
  key: string
  manifest: SyncManifest
}

export function createClient(cfg: SyncConfig, secretKey: string): Minio.Client {
  return new Minio.Client({
    endPoint: cfg.endpoint.replace(/^https?:\/\//, '').replace(/\/$/, ''),
    port: cfg.port,
    useSSL: cfg.useSSL,
    accessKey: cfg.accessKey,
    secretKey
  })
}

/** 连接测试：bucket 列表权限；bucket 不存在时自动创建 */
export async function testAndPrepareBucket(client: Minio.Client, bucket: string): Promise<{ bucketCreated: boolean }> {
  const exists = await client.bucketExists(bucket)
  if (exists) return { bucketCreated: false }
  await client.makeBucket(bucket, '')
  return { bucketCreated: true }
}

/** 拉取全部清单快照（含 base 基线） */
export async function fetchManifests(client: Minio.Client, bucket: string): Promise<RemoteManifestObject[]> {
  const keys: string[] = []
  const stream = client.listObjectsV2(bucket, 'manifests/', true)
  await new Promise<void>((resolve, reject) => {
    stream.on('data', (obj) => {
      if (obj.name?.endsWith('.json')) keys.push(obj.name)
    })
    stream.on('end', resolve)
    stream.on('error', reject)
  })

  // C1：远端 manifest 是不可信输入，入库前必须过 sanitizeManifest
  // （version/images 结构校验 + 逐记录 id/hash/文件名净化，非法记录丢弃）；
  // 并发拉取（runPool）替代旧串行循环
  const results: RemoteManifestObject[] = []
  await runPool(keys, MANIFEST_FETCH_CONCURRENCY, async (key) => {
    try {
      const raw = await getObjectJson<unknown>(client, bucket, key)
      const manifest = raw === null ? null : sanitizeManifest(raw, key)
      if (manifest) results.push({ key, manifest })
    } catch (err) {
      console.error(`[sync/client] 清单读取失败 ${key}:`, err)
    }
  })
  return results
}

async function getObjectJson<T>(client: Minio.Client, bucket: string, key: string): Promise<T | null> {
  const stream = await client.getObject(bucket, key)
  const chunks: Buffer[] = []
  await new Promise<void>((resolve, reject) => {
    stream.on('data', (c) => chunks.push(c as Buffer))
    stream.on('end', resolve)
    stream.on('error', reject)
  })
  if (chunks.length === 0) return null
  return JSON.parse(Buffer.concat(chunks).toString('utf-8')) as T
}

export { getObjectJson }

export async function putObjectJson(
  client: Minio.Client,
  bucket: string,
  key: string,
  data: unknown
): Promise<void> {
  const body = Buffer.from(JSON.stringify(data), 'utf-8')
  await client.putObject(bucket, key, body, body.length, { 'Content-Type': 'application/json' })
}

/** 对象是否存在（HEAD） */
export async function objectExists(client: Minio.Client, bucket: string, key: string): Promise<boolean> {
  try {
    await client.statObject(bucket, key)
    return true
  } catch {
    return false
  }
}

export async function uploadFile(client: Minio.Client, bucket: string, key: string, filePath: string, contentType: string): Promise<void> {
  await client.fPutObject(bucket, key, filePath, { 'Content-Type': contentType })
}

export async function downloadFile(client: Minio.Client, bucket: string, key: string, targetPath: string): Promise<void> {
  await client.fGetObject(bucket, key, targetPath)
}

/**
 * 压缩清单：快照数超过阈值时，把全部现有快照合并写为 base-<ts>.json，
 * 然后删除参与压缩的旧快照（base 保留）。并发场景下最坏结果是多写一份 base，幂等无害。
 */
export async function compactManifests(
  client: Minio.Client,
  bucket: string,
  manifests: RemoteManifestObject[],
  merged: SyncManifest,
  threshold = 8
): Promise<void> {
  const snapshots = manifests.filter((m) => !m.key.startsWith('manifests/base-'))
  const bases = manifests.filter((m) => m.key.startsWith('manifests/base-'))
  if (snapshots.length < threshold) return

  const ts = Date.now()
  await putObjectJson(client, bucket, `manifests/base-${ts}.json`, merged)
  // 删除旧 base 与全部快照（新 base 已包含其全部内容）
  const obsolete = [...snapshots.map((m) => m.key), ...bases.map((m) => m.key)]
  if (obsolete.length > 0) {
    await client.removeObjects(bucket, obsolete)
  }
}
