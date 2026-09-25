/**
 * 持久化状态清洗纯函数 —— 清单 #7 状态持久化（筛选/排序/抽屉开关记忆）
 * sanitizeSort / sanitizeFilter / sanitizeDrawer：对 localStorage 恢复的快照
 * 做类型校验与兜底（跨版本缺字段、手动篡改、体检深链瞬态剥离）。
 */
import { describe, expect, it } from 'vitest'
import { sanitizeDrawer, sanitizeFilter, sanitizeSort } from '@renderer/lib/prefs'
import type { LibraryFilter } from '@shared/types'

const FALLBACK: LibraryFilter = {
  keyword: '',
  categoryId: 'all',
  tags: [],
  albumId: null,
  minWidth: 0,
  minSizeMB: 0,
  maxSizeMB: 0,
  health: null
}

describe('sanitizeSort 排序键校验', () => {
  it('合法排序键原样返回', () => {
    expect(sanitizeSort('added-desc', 'name-asc')).toBe('added-desc')
    expect(sanitizeSort('added-asc', 'name-asc')).toBe('added-asc')
    expect(sanitizeSort('name-asc', 'added-desc')).toBe('name-asc')
    expect(sanitizeSort('size-desc', 'added-desc')).toBe('size-desc')
  })

  it('非法值回落 fallback', () => {
    expect(sanitizeSort('bogus', 'added-desc')).toBe('added-desc')
    expect(sanitizeSort(42, 'added-desc')).toBe('added-desc')
    expect(sanitizeSort(undefined, 'name-asc')).toBe('name-asc')
    expect(sanitizeSort(null, 'name-asc')).toBe('name-asc')
  })
})

describe('sanitizeFilter 筛选快照校验', () => {
  it('非对象输入整体回落 fallback', () => {
    expect(sanitizeFilter(null, FALLBACK)).toEqual(FALLBACK)
    expect(sanitizeFilter('x', FALLBACK)).toEqual(FALLBACK)
    expect(sanitizeFilter(undefined, FALLBACK)).toEqual(FALLBACK)
  })

  it('部分快照：缺失字段用 fallback 补齐', () => {
    expect(sanitizeFilter({ keyword: '猫' }, FALLBACK)).toEqual({ ...FALLBACK, keyword: '猫' })
  })

  it('health 永远剥离（体检深链为瞬态快照，不落盘不恢复）', () => {
    const dirty = { ...FALLBACK, health: { label: '孤儿文件', ids: ['img-1', 'img-2'] } }
    expect(sanitizeFilter(dirty, FALLBACK).health).toBeNull()
  })

  it('tags 过滤非字符串成员', () => {
    expect(sanitizeFilter({ tags: ['a', 1, null, 'b'] }, FALLBACK).tags).toEqual(['a', 'b'])
    expect(sanitizeFilter({ tags: 'not-array' }, FALLBACK).tags).toEqual([])
  })

  it('负数/NaN 尺寸回落；合法值保留', () => {
    const r = sanitizeFilter({ minWidth: -5, minSizeMB: NaN, maxSizeMB: 12 }, FALLBACK)
    expect(r.minWidth).toBe(0)
    expect(r.minSizeMB).toBe(0)
    expect(r.maxSizeMB).toBe(12)
  })

  it('categoryId 允许字符串与 null，其余类型回落', () => {
    expect(sanitizeFilter({ categoryId: 'favorites' }, FALLBACK).categoryId).toBe('favorites')
    expect(sanitizeFilter({ categoryId: null }, FALLBACK).categoryId).toBeNull()
    expect(sanitizeFilter({ categoryId: 7 }, FALLBACK).categoryId).toBe('all')
  })

  it('albumId 非法类型归 null，字符串保留', () => {
    expect(sanitizeFilter({ albumId: 'al-1' }, FALLBACK).albumId).toBe('al-1')
    expect(sanitizeFilter({ albumId: 7 }, FALLBACK).albumId).toBeNull()
  })
})

describe('sanitizeDrawer 抽屉键校验', () => {
  it('合法抽屉键原样返回', () => {
    expect(sanitizeDrawer('slideshow')).toBe('slideshow')
    expect(sanitizeDrawer('history')).toBe('history')
    expect(sanitizeDrawer('settings')).toBe('settings')
  })

  it('null/非法值一律归 null（关闭态）', () => {
    expect(sanitizeDrawer(null)).toBeNull()
    expect(sanitizeDrawer(undefined)).toBeNull()
    expect(sanitizeDrawer('bogus')).toBeNull()
    expect(sanitizeDrawer(123)).toBeNull()
  })
})
