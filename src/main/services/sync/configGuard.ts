/**
 * SYNC_SET_CONFIG 入参校验（主进程边界，H3/#9）：
 * 渲染层传入的 patch 是不可信输入，endpoint/bucket 直接拼进 MinIO
 * 连接参数与对象 key，必须先做类型与格式白名单校验，非法即抛错。
 *
 * 独立纯函数模块（无 electron/服务依赖）—— #9 的 scope 字段曾被
 * 白名单漏掉导致选择性同步设置整体不可用，正是缺了这层单测；
 * 断言见 tests/sync-config-guard.test.ts。
 */
import type { SyncConfig, SyncScope } from '@shared/types'

/** 字段白名单：多余字段直接拒绝（updateSyncConfig 是浅合并持久化，不拒绝的话渲染端可写入任意字段） */
const SYNC_PATCH_KEYS = new Set([
  'endpoint',
  'port',
  'bucket',
  'accessKey',
  'useSSL',
  'enabled',
  'autoSync',
  'scope'
])

/** scope 结构校验：all 无需 ids；categories/albums 必须带字符串数组 ids */
function isValidScope(v: unknown): v is SyncScope {
  if (typeof v !== 'object' || v === null) return false
  const s = v as { type?: unknown; ids?: unknown }
  if (s.type === 'all') return true
  if (s.type !== 'categories' && s.type !== 'albums') return false
  return Array.isArray(s.ids) && s.ids.every((id) => typeof id === 'string')
}

export function assertValidSyncConfigPatch(patch: Partial<SyncConfig>): void {
  if (typeof patch !== 'object' || patch === null) throw new Error('参数错误：配置必须是对象')
  for (const key of Object.keys(patch)) {
    if (!SYNC_PATCH_KEYS.has(key)) throw new Error(`参数错误：不支持的配置字段「${key}」`)
  }
  if (patch.endpoint !== undefined) {
    if (typeof patch.endpoint !== 'string') throw new Error('参数错误：同步地址必须是字符串')
    // 与 createClient 相同的剥离逻辑：去掉协议前缀与尾斜杠后校验裸主机名
    const bare = patch.endpoint.replace(/^https?:\/\//, '').replace(/\/+$/, '')
    if (!/^[A-Za-z0-9.-]{1,253}$/.test(bare)) {
      throw new Error('同步地址不合法：仅允许字母、数字、点与连字符组成的主机名')
    }
  }
  if (patch.port !== undefined) {
    if (!Number.isInteger(patch.port) || patch.port < 1 || patch.port > 65535) {
      throw new Error('端口不合法：必须是 1-65535 的整数')
    }
  }
  if (patch.bucket !== undefined) {
    if (
      typeof patch.bucket !== 'string' ||
      !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(patch.bucket)
    ) {
      throw new Error('存储桶名不合法：3-63 位小写字母/数字/点/连字符，且以字母或数字开头结尾')
    }
  }
  if (patch.accessKey !== undefined) {
    if (typeof patch.accessKey !== 'string' || patch.accessKey.length > 128) {
      throw new Error('AccessKey 不合法')
    }
  }
  for (const key of ['useSSL', 'enabled', 'autoSync'] as const) {
    if (patch[key] !== undefined && typeof patch[key] !== 'boolean') {
      throw new Error(`参数错误：${key} 必须是布尔值`)
    }
  }
  if (patch.scope !== undefined && !isValidScope(patch.scope)) {
    throw new Error('同步范围不合法：type 必须是 all/categories/albums，且 ids 为字符串数组')
  }
}
