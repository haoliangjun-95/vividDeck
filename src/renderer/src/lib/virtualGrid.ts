/**
 * 画廊虚拟滚动纯数学（自 GalleryGrid 提取，清单 #12 可单测）
 * 列数断点与 CSS grid（grid-cols-2/3/4/5/6）保持一致。
 * 所有函数无副作用，输入输出均为普通数值，可直接断言。
 */

/** 卡片间距（px），与 Tailwind gap-3 一致 */
export const GRID_GAP = 12
/** 网格内边距（px），与容器 p-4 一致 */
export const GRID_PAD = 16
/** 卡片底部信息栏高度（px） */
export const CARD_FOOTER = 34
/** 视口上下额外渲染的行数（overscan），减少快速滚动白闪 */
export const OVERSCAN_ROWS = 2

export interface ViewportSize {
  w: number
  h: number
}

export interface VirtualWindowInput {
  viewport: ViewportSize
  scrollTop: number
  itemCount: number
}

export interface VirtualWindowResult {
  /** 当前视口宽度对应的列数 */
  cols: number
  /** 单列宽度（px） */
  colW: number
  /** 单行高度（px，3:4 缩略图 + 信息栏 + ring 边距） */
  rowH: number
  /** 总行数 */
  totalRows: number
  /** 渲染起始行（含，已做 overscan 与下界钳制；空列表时为 0） */
  firstRow: number
  /** 渲染结束行（含；空列表时为 -1） */
  lastRow: number
  /** items.slice(startIndex, endIndex) 即为可见窗口 */
  startIndex: number
  endIndex: number
  /** 上/下占位高度，撑起滚动条并保持位置稳定 */
  spacerTop: number
  spacerBottom: number
}

/** 视口宽度 → 列数（断点与 CSS sm/lg/xl/2xl 对应） */
export function columnsForWidth(viewportW: number): number {
  return viewportW >= 1536
    ? 6
    : viewportW >= 1280
      ? 5
      : viewportW >= 1024
        ? 4
        : viewportW >= 640
          ? 3
          : 2
}

/** 计算虚拟滚动窗口（行范围、切片索引、占位高度） */
export function computeVirtualWindow({
  viewport,
  scrollTop,
  itemCount
}: VirtualWindowInput): VirtualWindowResult {
  const cols = columnsForWidth(viewport.w)
  const colW = (viewport.w - GRID_PAD * 2 - GRID_GAP * (cols - 1)) / cols
  const rowH = (colW * 3) / 4 + CARD_FOOTER + 1 /* ring 边距 */
  const totalRows = Math.ceil(itemCount / cols)
  const firstRow = Math.max(
    0,
    Math.floor((scrollTop - GRID_PAD) / (rowH + GRID_GAP)) - OVERSCAN_ROWS
  )
  const lastRow = Math.min(
    totalRows - 1,
    Math.ceil((scrollTop + viewport.h - GRID_PAD) / (rowH + GRID_GAP)) + OVERSCAN_ROWS
  )
  return {
    cols,
    colW,
    rowH,
    totalRows,
    firstRow,
    lastRow,
    startIndex: firstRow * cols,
    endIndex: (lastRow + 1) * cols,
    spacerTop: Math.max(0, firstRow) * (rowH + GRID_GAP),
    spacerBottom: Math.max(0, totalRows - lastRow - 1) * (rowH + GRID_GAP)
  }
}

/** 键盘导航（#6）支持的方向键 */
export type NavKey = 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown'

/**
 * 方向键移动活动卡片索引（#6 键盘驱动画廊）。
 * 无活动项时任意方向键激活第一张；current 越界先钳制再移动；空列表返回 null。
 */
export function moveActiveIndex(
  current: number | null,
  key: NavKey,
  cols: number,
  itemCount: number
): number | null {
  if (itemCount <= 0) return null
  const max = itemCount - 1
  if (current === null) return 0
  const base = Math.min(Math.max(current, 0), max)
  let delta: number
  if (key === 'ArrowLeft') delta = -1
  else if (key === 'ArrowRight') delta = 1
  else if (key === 'ArrowUp') delta = -cols
  else delta = cols
  return Math.min(Math.max(base + delta, 0), max)
}

export interface EnsureRowVisibleInput {
  /** 目标卡片在列表中的索引 */
  index: number
  cols: number
  /** 行步进 = rowH + GRID_GAP */
  rowStep: number
  rowH: number
  /** 滚动容器可视高度（px） */
  viewportH: number
  scrollTop: number
}

/**
 * 计算让 index 所在行完整可见的 scrollTop（#6 键盘导航滚动跟随）。
 * 已可见时返回原 scrollTop；行高于视口对齐行顶，低于视口对齐行底；结果不为负。
 */
export function ensureRowVisible({
  index,
  cols,
  rowStep,
  rowH,
  viewportH,
  scrollTop
}: EnsureRowVisibleInput): number {
  const row = Math.floor(index / Math.max(1, cols))
  const rowTop = GRID_PAD + row * rowStep
  const rowBottom = rowTop + rowH
  if (rowTop < scrollTop) return Math.max(0, rowTop - GRID_PAD)
  if (rowBottom > scrollTop + viewportH) return Math.max(0, rowBottom + GRID_PAD - viewportH)
  return scrollTop
}
