/**
 * 持久化偏好清洗（#7 状态持久化：筛选/排序/抽屉开关记忆）。
 * localStorage 快照可能缺字段（跨版本升级）或含非法值（手动篡改），
 * 恢复时在存储边界统一做类型校验与兜底，再交给各 store 的 persist merge。
 * 纯函数，断言见 tests/prefs.test.ts。
 */
import type { LibraryFilter } from '@shared/types'
import type { SortKey } from '../store/library'
import type { DrawerKey } from '../store/ui'

/** 合法排序键，与 store/library.ts 的 SortKey 联合保持一致 */
const SORT_KEYS: readonly string[] = ['added-desc', 'added-asc', 'name-asc', 'size-desc']
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
