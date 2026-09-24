/**
 * 画廊键盘导航 hook（#6）：方向键移动活动卡片并滚动跟随，回车/空格委托宿主回调
 * （宿主接线：回车开灯箱、空格收藏；选择模式下均切换选中）。
 * 纯数学（索引移动、滚动跟随）在 lib/virtualGrid.ts，断言见 tests/gallery-keys.test.ts。
 * 本层只负责：keydown 监听、焦点守卫（输入态不劫持、按钮原生激活不双触发）、滚动容器同步。
 */
import { useEffect, useState } from 'react'
import type { RefObject } from 'react'
import { GRID_GAP, ensureRowVisible, moveActiveIndex } from '../lib/virtualGrid'
import type { NavKey } from '../lib/virtualGrid'

const NAV_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'])

export interface GalleryKeyboardInput {
  /** 弹窗/灯箱/右键菜单打开时由宿主置 false，整体禁用键盘导航 */
  enabled: boolean
  /** 筛选后列表长度（活动索引的定义域） */
  itemCount: number
  /** 当前列数（决定上下键跨行步长） */
  cols: number
  /** 单行高度 px（滚动跟随用） */
  rowH: number
  /** 画廊滚动容器 */
  scrollRef: RefObject<HTMLDivElement>
  /** 回车：打开灯箱（选择模式下切换选中） */
  onEnter: (index: number) => void
  /** 空格：切换收藏（选择模式下切换选中） */
  onSpace: (index: number) => void
}

/** 返回 [activeIndex, setActiveIndex]，activeIndex 为筛选后列表索引；null = 尚无活动卡片 */
export function useGalleryKeyboard({
  enabled,
  itemCount,
  cols,
  rowH,
  scrollRef,
  onEnter,
  onSpace
}: GalleryKeyboardInput): [number | null, (value: number | null) => void] {
  const [activeIndex, setActiveIndex] = useState<number | null>(null)

  // 列表缩小（筛选/删除）后钳制活动索引，避免指向不存在的卡片
  useEffect(() => {
    setActiveIndex((prev) =>
      prev !== null && prev >= itemCount ? Math.max(0, itemCount - 1) : prev
    )
  }, [itemCount])

  useEffect(() => {
    if (!enabled || itemCount === 0) return
    const onKeyDown = (e: KeyboardEvent): void => {
      const el = document.activeElement
      if (el instanceof HTMLElement) {
        // 输入框/文本域/下拉/富文本聚焦时不劫持任何按键
        if (
          el.isContentEditable ||
          el instanceof HTMLInputElement ||
          el instanceof HTMLTextAreaElement ||
          el instanceof HTMLSelectElement
        ) {
          return
        }
        // 回车/空格落在已聚焦按钮或链接上时属于原生激活，避免双触发
        if (
          (el.tagName === 'BUTTON' || el.tagName === 'A') &&
          (e.key === 'Enter' || e.key === ' ')
        ) {
          return
        }
      }

      const isNav = NAV_KEYS.has(e.key)
      const isEnter = e.key === 'Enter'
      const isSpace = e.key === ' '
      if (!isNav && !isEnter && !isSpace) return
      // 空格默认滚动页面、方向键滚动容器，都要拦截，滚动跟随由 ensureRowVisible 接管
      e.preventDefault()

      if (isNav) {
        const next = moveActiveIndex(activeIndex, e.key as NavKey, cols, itemCount)
        if (next === null) return
        setActiveIndex(next)
        const scroller = scrollRef.current
        if (scroller) {
          const top = ensureRowVisible({
            index: next,
            cols,
            rowStep: rowH + GRID_GAP,
            rowH,
            viewportH: scroller.clientHeight,
            scrollTop: scroller.scrollTop
          })
          if (top !== scroller.scrollTop) scroller.scrollTop = top
        }
        return
      }
      if (activeIndex === null || activeIndex >= itemCount) return
      if (isEnter) onEnter(activeIndex)
      else onSpace(activeIndex)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [enabled, itemCount, cols, rowH, activeIndex, scrollRef, onEnter, onSpace])

  return [activeIndex, setActiveIndex]
}
