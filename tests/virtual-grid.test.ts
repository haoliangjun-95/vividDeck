/**
 * renderer lib/virtualGrid.ts —— 虚拟滚动行数学（清单 #12）
 * 关键数值手工推导：viewport.w=1280 → cols=5，colW=(1280-32-48)/5=240，
 * rowH=240*3/4+34+1=215，行步进 rowH+GAP=227。
 */
import { describe, expect, it } from 'vitest'
import {
  CARD_FOOTER,
  GRID_GAP,
  GRID_PAD,
  OVERSCAN_ROWS,
  columnsForWidth,
  computeVirtualWindow
} from '@renderer/lib/virtualGrid'

function win(scrollTop: number, itemCount: number, w = 1280, h = 800) {
  return computeVirtualWindow({ viewport: { w, h }, scrollTop, itemCount })
}

describe('columnsForWidth 断点', () => {
  it('与 CSS grid-cols-2/3/4/5/6 断点一致', () => {
    expect(columnsForWidth(320)).toBe(2)
    expect(columnsForWidth(639)).toBe(2)
    expect(columnsForWidth(640)).toBe(3)
    expect(columnsForWidth(1023)).toBe(3)
    expect(columnsForWidth(1024)).toBe(4)
    expect(columnsForWidth(1279)).toBe(4)
    expect(columnsForWidth(1280)).toBe(5)
    expect(columnsForWidth(1535)).toBe(5)
    expect(columnsForWidth(1536)).toBe(6)
    expect(columnsForWidth(2560)).toBe(6)
  })
})

describe('行几何', () => {
  it('colW/rowH 公式（1280 宽 → 5 列，colW=240，rowH=215）', () => {
    const r = win(0, 100)
    expect(r.cols).toBe(5)
    expect(r.colW).toBe(240)
    expect(r.rowH).toBe((240 * 3) / 4 + CARD_FOOTER + 1)
    expect(r.rowH).toBe(215)
  })

  it('totalRows 向上取整', () => {
    expect(win(0, 1000).totalRows).toBe(200)
    expect(win(0, 11).totalRows).toBe(3)
    expect(win(0, 5).totalRows).toBe(1)
  })
})

describe('窗口计算', () => {
  it('顶部：firstRow 钳制为 0，含 overscan 的尾部行', () => {
    const r = win(0, 1000)
    expect(r.firstRow).toBe(0)
    // ceil((0+800-16)/227)+2 = 4+2 = 6
    expect(r.lastRow).toBe(6)
    expect(r.startIndex).toBe(0)
    expect(r.endIndex).toBe(35)
    expect(r.spacerTop).toBe(0)
    expect(r.spacerBottom).toBe((200 - 6 - 1) * 227)
  })

  it('中部滚动：上下各带 overscan，占位高度撑住滚动条', () => {
    const r = win(2270, 1000) // 恰好滚过 10 行
    // floor((2270-16)/227)-2 = 9-2 = 7
    expect(r.firstRow).toBe(7)
    // ceil((2270+800-16)/227)+2 = 14+2 = 16
    expect(r.lastRow).toBe(16)
    expect(r.spacerTop).toBe(7 * 227)
    expect(r.endIndex).toBe(85)
    expect(r.spacerBottom).toBe((200 - 16 - 1) * 227)
  })

  it('底部钳制：lastRow 不超过 totalRows-1，spacerBottom 为 0', () => {
    const r = win(999999, 1000)
    expect(r.lastRow).toBe(199)
    expect(r.spacerBottom).toBe(0)
    expect(r.endIndex).toBe(1000)
  })

  it('overscan 保证视口外预渲染行', () => {
    expect(OVERSCAN_ROWS).toBe(2)
    const r = win(0, 1000)
    const visibleLast = Math.ceil((0 + 800 - GRID_PAD) / (r.rowH + GRID_GAP)) - 1
    expect(r.lastRow).toBeGreaterThan(visibleLast)
  })
})

describe('边界输入', () => {
  it('空列表：totalRows=0、lastRow=-1、切片索引安全', () => {
    const r = win(0, 0)
    expect(r.totalRows).toBe(0)
    expect(r.firstRow).toBe(0)
    expect(r.lastRow).toBe(-1)
    expect(r.startIndex).toBe(0)
    expect(r.endIndex).toBe(0)
    expect(r.spacerTop).toBe(0)
    expect(r.spacerBottom).toBe(0)
  })

  it('小列表：endIndex 可超出 itemCount（slice 天然安全）', () => {
    const r = win(0, 3)
    expect(r.totalRows).toBe(1)
    expect(r.lastRow).toBe(0)
    expect(r.endIndex).toBe(5)
    expect([1, 2, 3].slice(r.startIndex, r.endIndex)).toEqual([1, 2, 3])
  })

  it('极端 scrollTop 不产生 NaN/负数占位', () => {
    const r = win(Number.MAX_SAFE_INTEGER / 2, 10)
    expect(Number.isFinite(r.spacerTop)).toBe(true)
    expect(r.spacerTop).toBeGreaterThanOrEqual(0)
    expect(r.spacerBottom).toBe(0)
  })

  it('常量与实现一致（防止悄悄改动布局口径）', () => {
    expect(GRID_GAP).toBe(12)
    expect(GRID_PAD).toBe(16)
    expect(CARD_FOOTER).toBe(34)
  })
})
