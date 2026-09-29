/**
 * shared/timeScope.ts —— 时段轮播范围解析
 * 覆盖：HH:mm 解析、窗口匹配（含跨午夜）、优先级与容错
 */
import { describe, expect, it } from 'vitest'
import { inTimeWindow, parseHHmm, resolveTimeScope } from '@shared/timeScope'
import type { SlideshowScope, TimeScope } from '@shared/types'

const all: SlideshowScope = { type: 'all' }
const work: SlideshowScope = { type: 'category', categoryId: 'work' }
const night: SlideshowScope = { type: 'album', albumId: 'night' }

describe('parseHHmm', () => {
  it('标准与单位数小时形态；越界/畸形拒绝', () => {
    expect(parseHHmm('09:30')).toBe(9 * 60 + 30)
    expect(parseHHmm('9:30')).toBe(9 * 60 + 30)
    expect(parseHHmm('23:59')).toBe(23 * 60 + 59)
    expect(parseHHmm('24:00')).toBeNull()
    expect(parseHHmm('12:60')).toBeNull()
    expect(parseHHmm('abc')).toBeNull()
    expect(parseHHmm('')).toBeNull()
  })
})

describe('inTimeWindow', () => {
  it('普通窗口闭区间', () => {
    expect(inTimeWindow(9 * 60, 18 * 60, 9 * 60)).toBe(true)
    expect(inTimeWindow(9 * 60, 18 * 60, 18 * 60)).toBe(true)
    expect(inTimeWindow(9 * 60, 18 * 60, 8 * 60 + 59)).toBe(false)
    expect(inTimeWindow(9 * 60, 18 * 60, 18 * 60 + 1)).toBe(false)
  })

  it('跨午夜窗口（22:00~06:00）', () => {
    expect(inTimeWindow(22 * 60, 6 * 60, 23 * 60)).toBe(true)
    expect(inTimeWindow(22 * 60, 6 * 60, 3 * 60)).toBe(true)
    expect(inTimeWindow(22 * 60, 6 * 60, 6 * 60)).toBe(true)
    expect(inTimeWindow(22 * 60, 6 * 60, 12 * 60)).toBe(false)
    expect(inTimeWindow(22 * 60, 6 * 60, 21 * 60 + 59)).toBe(false)
  })
})

describe('resolveTimeScope', () => {
  const scopes: TimeScope[] = [
    { from: '09:00', to: '18:00', scope: work },
    { from: '22:00', to: '06:00', scope: night }
  ]
  const at = (h: number, m = 0): Date => new Date(2026, 8, 29, h, m)

  it('命中工作时段 / 夜间跨午夜 / 未命中回退全局', () => {
    expect(resolveTimeScope(scopes, at(10, 30), all)).toEqual(work)
    expect(resolveTimeScope(scopes, at(23, 0), all)).toEqual(night)
    expect(resolveTimeScope(scopes, at(20, 0), all)).toEqual(all)
  })

  it('空/未配置直接返回 fallback；首个命中优先', () => {
    expect(resolveTimeScope(undefined, at(10), all)).toEqual(all)
    expect(resolveTimeScope([], at(10), all)).toEqual(all)
    const overlap: TimeScope[] = [
      { from: '00:00', to: '23:59', scope: all },
      { from: '09:00', to: '18:00', scope: work }
    ]
    expect(resolveTimeScope(overlap, at(10), night)).toEqual(all)
  })

  it('畸形条目跳过，不让轮播崩掉', () => {
    const bad: TimeScope[] = [
      { from: '25:00', to: '26:00', scope: work },
      { from: '09:00', to: '', scope: work },
      { from: '10:00', to: '12:00', scope: night }
    ]
    expect(resolveTimeScope(bad, at(9), all)).toEqual(all) // 前两条跳过，未命中回退
    expect(resolveTimeScope(bad, at(11), all)).toEqual(night)
  })
})
