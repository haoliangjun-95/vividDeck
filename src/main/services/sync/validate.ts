/**
 * 云端数据入口校验（C1 修复）：
 * 远端 manifest 是不可信输入（桶可能被恶意共享端控制、useSSL:false 链路可注入），
 * 所有记录入库前必须经此模块净化 —— 非法记录丢弃并告警，合法数据原样通过。
 *
 * 字段约定（与本地 genId/sha1 产出兼容，合法数据不会被改写）：
 * - id: ^[0-9A-Za-z-]{1,64}$（本地 Date.now(36)+hex 为 ^[0-9a-z]+$ 子集；
 *   排除 `_` 是为了让派生文件名 `id_xxx` 的分隔符无歧义）
 * - hash: ^[0-9a-f]{40}$（sha1 hex）
 * - 时间戳/尺寸: epoch 毫秒 / 像素（有限数且 >= 0，Infinity 归 0）
 */
import type {
  Category,
  ImageFormat,
  SmartAlbum,
  SmartAlbumRules,
  SyncImageRecord,
  SyncManifest,
  SyncTombstone
} from '@shared/types'
import { sanitizeFileName } from '../../utils/fs'

/** 合法 id（含云端设备生成的变体；`_` 不允许 —— 派生文件名以 `_` 作分隔符） */
const ID_RE = /^[0-9A-Za-z-]{1,64}$/
/** 合法内容哈希（sha1 hex） */
const HASH_RE = /^[0-9a-f]{40}$/
/** 合法图片格式白名单 */
const FORMATS: ImageFormat[] = ['jpeg', 'png', 'webp', 'heic', 'avif', 'tiff', 'gif']

/** 记录级上限，防止畸形 manifest 撑爆内存/存储 */
const MAX_TAGS = 100
const MAX_TAG_LEN = 50
const MAX_NAME_LEN = 200
const MAX_ARRAY = 1_000_000

/** 可删除对象键白名单（H1：孤儿清理只允许碰这两类键；id 段与 ID_RE 一致不含 `_`） */
const OBJECT_KEY_RE = /^objects\/[0-9a-f]{40}$/
const THUMB_KEY_RE = /^thumbs\/[0-9A-Za-z-]{1,64}_[0-9a-f]{8}\.webp$/

function validId(v: unknown): v is string {
  return typeof v === 'string' && ID_RE.test(v)
}

/** epoch 毫秒：有限数且非负，取整；非法返回 fallback */
function validTime(v: unknown, fallback = 0): number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.round(v) : fallback
}

/** 尺寸类数值（宽高/字节）：有限数且非负，取整；NaN/Infinity/负数归 0 */
function validSize(v: unknown): number {
  const n = Number(v)
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : 0
}

function validStr(v: unknown, maxLen: number): string | null {
  return typeof v === 'string' ? v.slice(0, maxLen) : null
}

/** 净化标签数组：仅保留字符串、限长限量 */
function sanitizeTags(v: unknown): string[] {
  if (!Array.isArray(v)) return []
  return v
    .filter((t): t is string => typeof t === 'string')
    .map((t) => t.slice(0, MAX_TAG_LEN))
    .slice(0, MAX_TAGS)
}

/** 净化单条图片记录；id/hash 非法返回 null（调用方丢弃） */
function sanitizeRecord(raw: unknown, key: string): SyncImageRecord | null {
  if (typeof raw !== 'object' || raw === null) return null
  const r = raw as Record<string, unknown>
  if (!validId(r.id) || !HASH_RE.test(String(r.hash))) {
    console.warn(`[sync-validate] ${key}: 丢弃非法记录 id=${String(r.id).slice(0, 32)}`)
    return null
  }
  const format = FORMATS.includes(r.format as ImageFormat) ? (r.format as ImageFormat) : 'jpeg'
  return {
    id: r.id,
    hash: String(r.hash),
    fileName: sanitizeFileName(validStr(r.fileName, MAX_NAME_LEN) ?? 'image'),
    width: validSize(r.width),
    height: validSize(r.height),
    sizeBytes: validSize(r.sizeBytes),
    format,
    categoryId: validId(r.categoryId) ? r.categoryId : null,
    tags: sanitizeTags(r.tags),
    favorite: r.favorite === true,
    addedAt: validTime(r.addedAt),
    updatedAt: validTime(r.updatedAt),
    updatedBy: validStr(r.updatedBy, 64) ?? ''
  }
}

/** 净化分类；id 非法返回 null */
function sanitizeCategory(raw: unknown): Category | null {
  if (typeof raw !== 'object' || raw === null) return null
  const r = raw as Record<string, unknown>
  if (!validId(r.id)) return null
  const name = sanitizeFileName(validStr(r.name, MAX_NAME_LEN) ?? '分类')
  return {
    id: r.id,
    name,
    createdAt: validTime(r.createdAt),
    updatedAt: validTime(r.updatedAt),
    ...(typeof r.order === 'number' && Number.isFinite(r.order) ? { order: Math.round(r.order) } : {})
  }
}

/** 净化智能相册规则（逐字段校验，非法字段丢弃） */
function sanitizeRules(raw: unknown): SmartAlbumRules {
  if (typeof raw !== 'object' || raw === null) return {}
  const r = raw as Record<string, unknown>
  const rules: SmartAlbumRules = {}
  const tagsAll = sanitizeTags(r.tagsAll)
  const tagsAny = sanitizeTags(r.tagsAny)
  if (tagsAll.length > 0) rules.tagsAll = tagsAll
  if (tagsAny.length > 0) rules.tagsAny = tagsAny
  if (r.orientation === 'landscape' || r.orientation === 'portrait') rules.orientation = r.orientation
  if (typeof r.minAspect === 'number' && Number.isFinite(r.minAspect)) rules.minAspect = r.minAspect
  if (typeof r.maxAspect === 'number' && Number.isFinite(r.maxAspect)) rules.maxAspect = r.maxAspect
  if (typeof r.minWidth === 'number' && Number.isFinite(r.minWidth) && r.minWidth >= 0) {
    rules.minWidth = Math.round(r.minWidth)
  }
  if (Array.isArray(r.categoryIds)) {
    const ids = r.categoryIds.filter(validId)
    if (ids.length > 0) rules.categoryIds = ids
  }
  if (r.favoriteOnly === true) rules.favoriteOnly = true
  return rules
}

/** 净化智能相册；id 非法返回 null */
function sanitizeAlbum(raw: unknown): SmartAlbum | null {
  if (typeof raw !== 'object' || raw === null) return null
  const r = raw as Record<string, unknown>
  if (!validId(r.id)) return null
  return {
    id: r.id,
    name: sanitizeFileName(validStr(r.name, MAX_NAME_LEN) ?? '相册'),
    rules: sanitizeRules(r.rules),
    createdAt: validTime(r.createdAt),
    updatedAt: validTime(r.updatedAt)
  }
}

/** 净化墓碑；id 非法返回 null */
function sanitizeTombstone(raw: unknown): SyncTombstone | null {
  if (typeof raw !== 'object' || raw === null) return null
  const r = raw as Record<string, unknown>
  if (!validId(r.id)) return null
  return {
    id: r.id,
    kind: r.kind === 'category' ? 'category' : 'image',
    deletedAt: validTime(r.deletedAt),
    deletedBy: validStr(r.deletedBy, 64) ?? ''
  }
}

function sanitizeArray<T>(raw: unknown, fn: (item: unknown) => T | null): T[] {
  if (!Array.isArray(raw)) return []
  const out: T[] = []
  for (const item of raw.slice(0, MAX_ARRAY)) {
    const v = fn(item)
    if (v !== null) out.push(v)
  }
  return out
}

/**
 * 校验并净化整份远端 manifest。
 * 结构性非法（非对象 / version 不符 / images 非数组）返回 null，整份丢弃。
 */
export function sanitizeManifest(raw: unknown, key: string): SyncManifest | null {
  if (typeof raw !== 'object' || raw === null) {
    console.warn(`[sync-validate] ${key}: manifest 非对象，已丢弃`)
    return null
  }
  const m = raw as Record<string, unknown>
  if (m.version !== 1 || !Array.isArray(m.images)) {
    console.warn(`[sync-validate] ${key}: version/images 非法（version=${String(m.version)}），已丢弃`)
    return null
  }
  const before = m.images.length
  const images = sanitizeArray<SyncImageRecord>(m.images, (item) => sanitizeRecord(item, key))
  const dropped = before - images.length
  if (dropped > 0) console.warn(`[sync-validate] ${key}: 丢弃 ${dropped}/${before} 条非法图片记录`)
  return {
    version: 1,
    updatedAt: validTime(m.updatedAt),
    updatedBy: validStr(m.updatedBy, 64) ?? '',
    images,
    categories: sanitizeArray<Category>(m.categories, sanitizeCategory),
    albums: sanitizeArray<SmartAlbum>(m.albums, sanitizeAlbum),
    tombstones: sanitizeArray<SyncTombstone>(m.tombstones, sanitizeTombstone)
  }
}

/** H1：仅允许删除桶内 objects/ 与 thumbs/ 白名单形态的键 */
export function isDeletableObjectKey(key: unknown): key is string {
  return typeof key === 'string' && (OBJECT_KEY_RE.test(key) || THUMB_KEY_RE.test(key))
}
