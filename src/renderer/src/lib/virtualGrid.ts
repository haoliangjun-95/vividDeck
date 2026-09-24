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
