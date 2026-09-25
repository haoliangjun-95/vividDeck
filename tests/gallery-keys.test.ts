/**
 * 键盘导航纯函数 —— 清单 #6 键盘驱动画廊（方向键导航/回车打开/空格收藏）
 * moveActiveIndex：方向键索引移动 + 边界钳制；ensureRowVisible：活动行滚动跟随。
 * 基准几何与 virtual-grid.test.ts 一致：w=1280 → cols 5、rowH 215、行步进 227。
 */
import { describe, expect, it } from 'vitest'
import { GRID_GAP, ensureRowVisible, moveActiveIndex } from '@renderer/lib/virtualGrid'

const COLS = 5
const ROW_H = 215
const ROW_STEP = ROW_H + GRID_GAP // 227
const VIEWPORT_H = 800

describe('moveActiveIndex 方向键移动', () => {
  it('空列表返回 null', () => {
    expect(moveActiveIndex(null, 'ArrowDown', COLS, 0)).toBeNull()
    expect(moveActiveIndex(3, 'ArrowDown', COLS, 0)).toBeNull()
  })

  it('无活动项时任意方向键激活第一张', () => {
    expect(moveActiveIndex(null, 'ArrowRight', COLS, 10)).toBe(0)
    expect(moveActiveIndex(null, 'ArrowUp', COLS, 10)).toBe(0)
  })

  it('左右移动 1 并钳制在 [0, itemCount-1]', () => {
    expect(moveActiveIndex(0, 'ArrowRight', COLS, 10)).toBe(1)
    expect(moveActiveIndex(9, 'ArrowRight', COLS, 10)).toBe(9)
    expect(moveActiveIndex(5, 'ArrowLeft', COLS, 10)).toBe(4)
    expect(moveActiveIndex(0, 'ArrowLeft', COLS, 10)).toBe(0)
  })

  it('上下移动一行（±cols）并钳制', () => {
    expect(moveActiveIndex(0, 'ArrowDown', COLS, 10)).toBe(5)
    expect(moveActiveIndex(7, 'ArrowDown', COLS, 10)).toBe(9) // 12 → 钳制 9
    expect(moveActiveIndex(7, 'ArrowUp', COLS, 10)).toBe(2)
    expect(moveActiveIndex(2, 'ArrowUp', COLS, 10)).toBe(0) // -3 → 钳制 0
  })

  it('current 越界时先钳制再移动（筛选缩小列表后的兜底）', () => {
    expect(moveActiveIndex(20, 'ArrowLeft', COLS, 10)).toBe(8)
  })
})

describe('ensureRowVisible 活动行滚动跟随', () => {
  const args = (index: number, scrollTop: number, viewportH = VIEWPORT_H) => ({
    index,
    cols: COLS,
    rowStep: ROW_STEP,
    rowH: ROW_H,
    viewportH,
    scrollTop
  })

  it('活动行完整可见时返回原 scrollTop', () => {
    // 第 1 行：top = 16 + 227 = 243，bottom = 458；可视区 [227, 1027]
    expect(ensureRowVisible(args(5, 227))).toBe(227)
  })

  it('行在视口上方时回滚到行顶', () => {
    expect(ensureRowVisible(args(5, 1000))).toBe(227) // 243 - 16
  })

  it('行在视口下方时前滚到行底', () => {
    // 第 5 行：top = 16 + 5*227 = 1151，bottom = 1366 → 1366 + 16 - 800
    expect(ensureRowVisible(args(25, 0))).toBe(582)
  })

  it('滚动结果不会为负', () => {
    expect(ensureRowVisible(args(0, 500))).toBe(0) // 第 0 行 top=16 → max(0, 16-16)
  })

  it('视口高度不足一行时按行底对齐', () => {
    // 第 0 行：bottom = 231 → 231 + 16 - 100
    expect(ensureRowVisible(args(0, 0, 100))).toBe(147)
  })
})
