/**
 * MinIO 客户端封装（minio-js）
 * 桶布局：
 *   manifests/<deviceId>-<ts>.json   每设备清单快照（CRDT，并发安全）
 *   manifests/base-<ts>.json         压缩合并基线（旧快照清理后）
 *   thumbs/<id>_<hash8>.webp         缩略图（全量同步，新设备画廊秒开）
 *   objects/<hash>                   图片二进制（内容寻址，天然去重）
 * A3：getClient 按连接身份缓存单例（避免每次同步重建连接池）；
 *     全部幂等操作经 withRetry 包裹（网络抖动/服务端 5xx 自动指数退避重试）。
 */
import { createHash } from 'node:crypto'
import * as Minio from 'minio'
import type { SyncConfig, SyncManifest } from '@shared/types'
import { withRetry } from './retry'

export interface RemoteManifestObject {
  key: string
  manifest: SyncManifest
}

/** 去掉协议前缀与尾部斜杠（Minio.Client 的 endPoint 要求裸主机名） */
function normalizeEndpoint(endpoint: string): string {
  return endpoint.replace(/^https?:\/\//, '').replace(/\/$/, '')
}

export function createClient(cfg: SyncConfig, secretKey: string): Minio.Client {
  return new Minio.Client({
    endPoint: normalizeEndpoint(cfg.endpoint),
    port: cfg.port,
    useSSL: cfg.useSSL,
    accessKey: cfg.accessKey,
    secretKey
  })
}

// ---------- A3 单例缓存 ----------

/** 缓存的客户端与其连接身份（地址/端口/SSL/账号/密钥指纹） */
let cached: { identity: string; client: Minio.Client } | null = null

function identityOf(cfg: SyncConfig, secretKey: string): string {
  // 密钥只取 sha1 指纹参与身份比较，不在缓存中长期持有明文副本、也绝不进日志
  const fingerprint = createHash('sha1').update(secretKey).digest('hex').slice(0, 12)
  return [normalizeEndpoint(cfg.endpoint), cfg.port, cfg.useSSL, cfg.accessKey, fingerprint].join(
    '|'
  )
}

/**
 * 按连接身份获取客户端：同一身份复用同一实例（省去重复握手/连接池重建）；
 * 配置或密钥轮换后身份不匹配，自动重建。
 */
export function getClient(cfg: SyncConfig, secretKey: string): Minio.Client {
  const identity = identityOf(cfg, secretKey)
  if (cached && cached.identity === identity) return cached.client
  const client = createClient(cfg, secretKey)
  cached = { identity, client }
  return client
}

/** 清空单例缓存（测试用） */
export function resetClientCache(): void {
  cached = null
}

/** 连接测试：bucket 列表权限；bucket 不存在时自动创建 */
export async function testAndPrepareBucket(
  client: Minio.Client,
  bucket: string
): Promise<{ bucketCreated: boolean }> {
  const exists = await withRetry(() => client.bucketExists(bucket), { label: 'bucketExists' })
  if (exists) return { bucketCreated: false }
  await withRetry(() => client.makeBucket(bucket, ''), { label: 'makeBucket' })
  return { bucketCreated: true }
}

/** 收集对象流为 .json key 列表（重试时整段重新建流） */
function listManifestKeys(client: Minio.Client, bucket: string): Promise<string[]> {
  return withRetry(
    () =>
      new Promise<string[]>((resolve, reject) => {
        const keys: string[] = []
        const stream = client.listObjectsV2(bucket, 'manifests/', true)
        stream.on('data', (obj) => {
          if (obj.name?.endsWith('.json')) keys.push(obj.name)
        })
        stream.on('end', () => resolve(keys))
        stream.on('error', reject)
      }),
    { label: 'listManifests' }
  )
}

/** 拉取全部清单快照（含 base 基线） */
export async function fetchManifests(
  client: Minio.Client,
  bucket: string
): Promise<RemoteManifestObject[]> {
  const keys = await listManifestKeys(client, bucket)

  const results: RemoteManifestObject[] = []
  for (const key of keys) {
    try {
      const manifest = await getObjectJson<SyncManifest>(client, bucket, key)
      if (manifest && manifest.version === 1) results.push({ key, manifest })
    } catch (err) {
      console.error(`[sync/client] 清单读取失败 ${key}:`, err)
    }
  }
  return results
}

async function getObjectJson<T>(
  client: Minio.Client,
  bucket: string,
  key: string
): Promise<T | null> {
  // 重试时整段重新拉流；JSON 解析失败（SyntaxError）属永久错误，不会被重试
  return withRetry(
    async () => {
      const stream = await client.getObject(bucket, key)
      const chunks: Buffer[] = []
      await new Promise<void>((resolve, reject) => {
        stream.on('data', (c) => chunks.push(c as Buffer))
        stream.on('end', resolve)
        stream.on('error', reject)
      })
      if (chunks.length === 0) return null
      return JSON.parse(Buffer.concat(chunks).toString('utf-8')) as T
    },
    { label: `getObject ${key}` }
  )
}

export { getObjectJson }

export async function putObjectJson(
  client: Minio.Client,
  bucket: string,
  key: string,
  data: unknown
): Promise<void> {
  const body = Buffer.from(JSON.stringify(data), 'utf-8')
  await withRetry(
    () => client.putObject(bucket, key, body, body.length, { 'Content-Type': 'application/json' }),
    { label: `putObject ${key}` }
  )
}

/** 对象是否存在（HEAD）；瞬时错误重试耗尽后与永久错误一样视为不存在 */
export async function objectExists(
  client: Minio.Client,
  bucket: string,
  key: string
): Promise<boolean> {
  try {
    await withRetry(() => client.statObject(bucket, key), { label: `statObject ${key}` })
    return true
  } catch {
    return false
  }
}

export async function uploadFile(
  client: Minio.Client,
  bucket: string,
  key: string,
  filePath: string,
  contentType: string
): Promise<void> {
  await withRetry(() => client.fPutObject(bucket, key, filePath, { 'Content-Type': contentType }), {
    label: `uploadFile ${key}`
  })
}

export async function downloadFile(
  client: Minio.Client,
  bucket: string,
  key: string,
  targetPath: string
): Promise<void> {
  await withRetry(() => client.fGetObject(bucket, key, targetPath), {
    label: `downloadFile ${key}`
  })
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
    await withRetry(() => client.removeObjects(bucket, obsolete), { label: 'removeObjects' })
  }
}
