/**
 * 持久化偏好清洗（#7 状态持久化：筛选/排序/抽屉开关记忆）。
 * localStorage 快照可能缺字段（跨版本升级）或含非法值（手动篡改），
 * 恢复时在存储边界统一做类型校验与兜底，再交给各 store 的 persist merge。
 * 纯函数，断言见 tests/prefs.test.ts。
 */
import type { LibraryFilter } from '@shared/types'
import type { SortKey } from '../store/library'
import type { DrawerKey } from '../store/ui'

/** 合法排序键，与 store/library.ts 的 SortKey 联合保持一致（含批次3 的拍摄时间排序） */
const SORT_KEYS: readonly string[] = [
  'added-desc',
  'added-asc',
  'taken-desc',
  'taken-asc',
  'name-asc',
  'size-desc'
]
/** 合法抽屉键，与 store/ui.ts 的 DrawerKey 联合保持一致（null = 关闭，不在列） */
const DRAWER_KEYS: readonly string[] = ['slideshow', 'history', 'settings']

/** 校验排序键；非法值回落 fallback */
export function sanitizeSort(value: unknown, fallback: SortKey): SortKey {
  return typeof value === 'string' && SORT_KEYS.includes(value) ? (value as SortKey) : fallback
}

/** 校验抽屉键；null/非法值一律归 null（关闭态） */
export function sanitizeDrawer(value: unknown): DrawerKey {
  return typeof value === 'string' && DRAWER_KEYS.includes(value) ? (value as DrawerKey) : null
}

/**
 * 校验筛选快照：缺失/非法字段回落 fallback；
 * health（体检深链）为瞬态大快照，恢复时永远剥离为 null。
 */
export function sanitizeFilter(value: unknown, fallback: LibraryFilter): LibraryFilter {
  if (typeof value !== 'object' || value === null) return fallback
  const v = value as Partial<LibraryFilter>
  return {
    keyword: typeof v.keyword === 'string' ? v.keyword : fallback.keyword,
    categoryId:
      typeof v.categoryId === 'string' || v.categoryId === null
        ? v.categoryId
        : fallback.categoryId,
    tags: Array.isArray(v.tags)
      ? v.tags.filter((t): t is string => typeof t === 'string')
      : fallback.tags,
    albumId: typeof v.albumId === 'string' ? v.albumId : null,
    minWidth: pickNonNegativeNumber(v.minWidth, fallback.minWidth),
    minSizeMB: pickNonNegativeNumber(v.minSizeMB, fallback.minSizeMB),
    maxSizeMB: pickNonNegativeNumber(v.maxSizeMB, fallback.maxSizeMB),
    health: null
  }
}

/** 有限且非负的数值才可信，否则回落 fallback */
function pickNonNegativeNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback
}

/**
 * 持久化筛选引用实体的存在性校验（跨设备删除降级）：
 * 筛选可能指向另一设备已删除的分类/相册/标签——启动后命中不了任何图，
 * 表现为"空画廊 + 侧栏无高亮"的数据丢失假象。失效引用分别降级为
 * 全部分类 / 无相册 / 剔除标签。无变化时返回原引用（避免无谓重渲染）。
 */
export function reconcileFilter(
  filter: LibraryFilter,
  categories: readonly { id: string }[],
  albums: readonly { id: string }[],
  tags: readonly string[]
): { filter: LibraryFilter; changed: boolean } {
  const SPECIAL_CATEGORIES = new Set(['all', 'favorites', 'uncategorized'])
  let changed = false
  let categoryId = filter.categoryId
  let albumId = filter.albumId
  let filterTags = filter.tags

  if (
    typeof categoryId === 'string' &&
    !SPECIAL_CATEGORIES.has(categoryId) &&
    !categories.some((c) => c.id === categoryId)
  ) {
    categoryId = 'all'
    changed = true
  }
  if (albumId !== null && !albums.some((a) => a.id === albumId)) {
    albumId = null
    changed = true
  }
  if (filterTags.some((t) => !tags.includes(t))) {
    filterTags = filterTags.filter((t) => tags.includes(t))
    changed = true
  }
  return {
    filter: changed ? { ...filter, categoryId, albumId, tags: filterTags } : filter,
    changed
  }
}
