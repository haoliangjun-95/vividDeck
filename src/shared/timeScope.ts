/**
 * 时段范围解析（时段轮播）：按当前时间从 timeScopes 中选出生效的轮播范围。
 * 纯函数（主进程 slideshow 每次切换时调用），断言见 tests/time-scope.test.ts。
 * 优先级：时段命中 > 全局 scope；单屏自定义 scope 在 slideshow.ts 侧优先于时段。
 */
import type { SlideshowScope, TimeScope } from './types'

/** "HH:mm" → 当天分钟数；非法返回 null */
export function parseHHmm(v: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(v.trim())
  if (!m) return null
  const h = Number(m[1])
  const min = Number(m[2])
  if (h > 23 || min > 59) return null
  return h * 60 + min
}

/** nowMin 是否落在 [fromMin, toMin] 窗口内；from > to 表示跨午夜（闭区间端点） */
export function inTimeWindow(fromMin: number, toMin: number, nowMin: number): boolean {
  if (fromMin <= toMin) return nowMin >= fromMin && nowMin <= toMin
  return nowMin >= fromMin || nowMin <= toMin
}

/**
 * 解析当前生效的范围：首个命中的时段胜出；无时段/全部未命中/时间字段畸形时
 * 返回 fallback（通常为全局 scope）。畸形条目安全跳过，绝不让轮播崩掉。
 */
export function resolveTimeScope(
  timeScopes: TimeScope[] | undefined,
  now: Date,
  fallback: SlideshowScope | undefined
): SlideshowScope | undefined {
  if (!timeScopes || timeScopes.length === 0) return fallback
  const nowMin = now.getHours() * 60 + now.getMinutes()
  for (const ts of timeScopes) {
    const from = parseHHmm(ts.from)
    const to = parseHHmm(ts.to)
    if (from === null || to === null) continue
    if (!ts.scope || typeof ts.scope.type !== 'string') continue
    if (inTimeWindow(from, to, nowMin)) return ts.scope
  }
  return fallback
}
