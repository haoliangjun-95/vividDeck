/**
 * 画廊网格（编排层，A1 拆分）：虚拟滚动窗口 + 空态导入引导 +
 * 右键菜单 / 重命名 / 批量操作栏与批量弹窗的组合。
 * 子组件见 ./gallery/：ImageCard（含 CardInfoFooter）、CardContextMenu、RenameModal、
 * BatchActionBar、BatchTagModal、BatchCategoryModal、DeleteConfirmModal。
 */
import React, { useEffect, useRef, useState } from 'react'
import { CloudDownload } from 'lucide-react'
import { selectFilteredImages, useLibraryStore } from '../store/library'
import { useUIStore } from '../store/ui'
import { computeVirtualWindow } from '../lib/virtualGrid'
import { ImageCard } from './gallery/ImageCard'
import { CardContextMenu } from './gallery/CardContextMenu'
import { RenameModal } from './gallery/RenameModal'
import { BatchActionBar } from './gallery/BatchActionBar'
import { BatchTagModal } from './gallery/BatchTagModal'
import { BatchCategoryModal } from './gallery/BatchCategoryModal'
import { DeleteConfirmModal } from './gallery/DeleteConfirmModal'
import type { ImageItem, SyncProgress } from '@shared/types'

export function GalleryGrid(): JSX.Element {
  const images = useLibraryStore(selectFilteredImages)
  const loaded = useLibraryStore((s) => s.loaded)
  const importPaths = useLibraryStore((s) => s.importFiles)
  const toast = useUIStore((s) => s.toast)
  const openDrawer = useUIStore((s) => s.openDrawer)
  const selectionMode = useUIStore((s) => s.selectionMode)
  const selectedIds = useUIStore((s) => s.selectedIds)
  const setSelectionMode = useUIStore((s) => s.setSelectionMode)
  const scrollRef = useRef<HTMLDivElement>(null)
  const [menu, setMenu] = useState<{ x: number; y: number; image: ImageItem } | null>(null)
  const [renaming, setRenaming] = useState<ImageItem | null>(null)
  const [categoryPickerOpen, setCategoryPickerOpen] = useState(false)
  const [tagPickerOpen, setTagPickerOpen] = useState(false)
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const [deleteRequestIds, setDeleteRequestIds] = useState<string[] | null>(null)
  const [bulkDownloading, setBulkDownloading] = useState(false)
  const [dlProgress, setDlProgress] = useState<SyncProgress | null>(null)
  /** 下载后仍未成功的 id（操作栏提供重试入口） */
  const [retryIds, setRetryIds] = useState<string[] | null>(null)
  const allImages = useLibraryStore((s) => s.images)
  const cloudCount = useUIStore(
    (s) => s.selectedIds.filter((id) => !allImages.find((i) => i.id === id)?.localFile).length
  )

  // 批量下载进度（主进程 downloadScope 以 downloading 阶段广播）
  useEffect(() => {
    if (!bulkDownloading) return
    const off = window.api.onSyncProgress((p) => {
      if (p.phase === 'downloading') setDlProgress(p)
    })
    return off
  }, [bulkDownloading])

  /** 批量下载图片的云端原图（主进程并发 3、可取消；失败/取消后可重试） */
  const downloadSelected = async (ids?: string[]): Promise<void> => {
    const known = useLibraryStore.getState().images
    const targets = (ids ?? useUIStore.getState().selectedIds).filter(
      (id) => !known.find((i) => i.id === id)?.localFile
    )
    if (targets.length === 0) return
    setBulkDownloading(true)
    setRetryIds(null)
    setDlProgress(null)
    try {
      const r = await window.api.syncDownload({ type: 'ids', ids: targets })
      await useLibraryStore.getState().load()
      // 下载后仍是云端 = 未成功，留给重试入口
      const now = useLibraryStore.getState().images
      const stillMissing = targets.filter((id) => !now.find((i) => i.id === id)?.localFile)
      setRetryIds(stillMissing.length > 0 ? stillMissing : null)
      if (r.cancelled) toast(`下载已取消：完成 ${r.downloaded} 张`, 'info')
      else if (r.failed > 0)
        toast(`下载完成 ${r.downloaded} 张，失败 ${r.failed} 张，可在操作栏重试`, 'info')
      else toast(`已下载 ${r.downloaded} 张到本地`)
    } catch (err) {
      setRetryIds(targets)
      toast(`下载失败：${err instanceof Error ? err.message : String(err)}`, 'error')
    } finally {
      setBulkDownloading(false)
      setDlProgress(null)
    }
  }

  // 虚拟化状态：滚动偏移 + 容器尺寸（rAF 节流更新，避免每像素 setState）
  const [scrollTop, setScrollTop] = useState(0)
  const [viewport, setViewport] = useState({ w: 1200, h: 800 })

  // 仅筛选/排序变化时回到顶部；元数据刷新不打断浏览位置（虚拟化天然保留 scrollTop）
  const filterSig = useLibraryStore((s) => JSON.stringify(s.filter) + '|' + s.sort)
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0
    setScrollTop(0)
  }, [filterSig])

  // Esc 退出批量选择（无弹窗时）；Cmd/Ctrl+Z 撤销最近批量操作（无输入焦点时）
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const el = document.activeElement
      const typing = el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement
      if (
        e.key === 'Escape' &&
        selectionMode &&
        !categoryPickerOpen &&
        !tagPickerOpen &&
        !deleteConfirmOpen
      ) {
        setSelectionMode(false)
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z' && !typing) {
        const last = useUIStore.getState().popUndo()
        if (last) {
          e.preventDefault()
          void last.undo().then(() => {
            useUIStore.getState().toast(`已撤销：${last.label}`, 'info')
            void useLibraryStore.getState().load()
          })
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selectionMode, categoryPickerOpen, tagPickerOpen, deleteConfirmOpen, setSelectionMode])

  // 虚拟滚动：滚动/尺寸变化时更新渲染窗口（rAF 节流）
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    let raf = 0
    const onScroll = (): void => {
      if (raf) return
      raf = requestAnimationFrame(() => {
        raf = 0
        setScrollTop(el.scrollTop)
      })
    }
    const ro = new ResizeObserver(() => {
      setViewport({ w: el.clientWidth, h: el.clientHeight })
    })
    el.addEventListener('scroll', onScroll, { passive: true })
    ro.observe(el)
    setViewport({ w: el.clientWidth, h: el.clientHeight })
    return () => {
      el.removeEventListener('scroll', onScroll)
      if (raf) cancelAnimationFrame(raf)
      ro.disconnect()
    }
  }, [])

  const openMenu = (e: React.MouseEvent, image: ImageItem): void => {
    e.preventDefault()
    e.stopPropagation()
    setMenu({ x: e.clientX, y: e.clientY, image })
  }

  if (loaded && images.length === 0) {
    return (
      <div
        className="flex h-full flex-col items-center justify-center gap-3 text-neutral-400"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault()
          // 阻止冒泡：App 级窗口 drop 监听也会导入，双导入会产生重复记录
          e.stopPropagation()
          const paths = Array.from(e.dataTransfer.files).map((f) => window.api.filePathOf(f))
          if (paths.length)
            void importPaths(paths).then((r) => r.added > 0 && toast(`导入 ${r.added} 张图片`))
        }}
      >
        <div className="text-5xl">🖼️</div>
        <div className="text-sm">还没有图片，点击上方「导入图片」或把图片/文件夹拖到这里</div>
        <button
          className="btn-ghost mt-1 gap-1.5 border border-neutral-300 text-xs dark:border-neutral-700"
          onClick={() => openDrawer('settings')}
        >
          <CloudDownload size={14} />
          已有云端壁纸库？去「设置 → 多设备同步」拉取到本地
        </button>
      </div>
    )
  }

  // 窗口化计算：列数与卡片行高（数学已提取到 lib/virtualGrid.ts，行为断言见 tests/virtual-grid.test.ts）
  const win = computeVirtualWindow({ viewport, scrollTop, itemCount: images.length })
  const shown = images.slice(win.startIndex, win.endIndex)

  return (
    <div ref={scrollRef} className="h-full overflow-y-auto p-4 pb-24">
      {/* 上下 spacer 撑起总高度，保持滚动条与位置稳定 */}
      <div style={{ height: win.spacerTop }} />
      <div
        className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6"
        style={{ gridTemplateColumns: `repeat(${win.cols}, minmax(0, 1fr))` }}
      >
        {shown.map((image) => (
          <ImageCard key={image.id} image={image} onContextMenu={openMenu} />
        ))}
      </div>
      <div style={{ height: win.spacerBottom }} />

      {menu && (
        <CardContextMenu
          image={menu.image}
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          onRename={(img) => setRenaming(img)}
          onDeleteRequest={(ids) => setDeleteRequestIds(ids)}
        />
      )}
      {renaming && <RenameModal image={renaming} onClose={() => setRenaming(null)} />}

      {/* 批量操作栏与分类选择弹窗 */}
      <BatchActionBar
        onOpenCategoryPicker={() => setCategoryPickerOpen(true)}
        onOpenTagPicker={() => setTagPickerOpen(true)}
        onDownloadSelected={() => void downloadSelected()}
        downloading={bulkDownloading}
        progress={dlProgress}
        onCancelDownload={() => {
          void window.api
            .syncCancelDownload()
            .then(() => toast('已发送取消信号，正在停止下载…', 'info'))
        }}
        retryCount={retryIds?.length ?? 0}
        onRetry={() => void downloadSelected(retryIds ?? undefined)}
        cloudCount={cloudCount}
        onDeleteRequest={() => setDeleteConfirmOpen(true)}
      />
      {categoryPickerOpen && selectedIds.length > 0 && (
        <BatchCategoryModal ids={[...selectedIds]} onClose={() => setCategoryPickerOpen(false)} />
      )}
      {tagPickerOpen && selectedIds.length > 0 && (
        <BatchTagModal ids={[...selectedIds]} onClose={() => setTagPickerOpen(false)} />
      )}
      {deleteConfirmOpen && selectedIds.length > 0 && (
        <DeleteConfirmModal ids={[...selectedIds]} onClose={() => setDeleteConfirmOpen(false)} />
      )}
      {deleteRequestIds && (
        <DeleteConfirmModal ids={deleteRequestIds} onClose={() => setDeleteRequestIds(null)} />
      )}
    </div>
  )
}
