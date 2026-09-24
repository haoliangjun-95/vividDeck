/** 批量操作栏（选择模式下有选中时显示）（A1 自 GalleryGrid 拆分） */
import {
  CheckSquare,
  CloudDownload,
  FolderInput,
  Loader2,
  RefreshCw,
  Tag as TagIcon,
  Trash2,
  X
} from 'lucide-react'
import { selectFilteredImages, useLibraryStore } from '../../store/library'
import { useUIStore } from '../../store/ui'
import type { SyncProgress } from '@shared/types'

export function BatchActionBar({
  onOpenCategoryPicker,
  onOpenTagPicker,
  onDownloadSelected,
  downloading,
  progress,
  onCancelDownload,
  retryCount,
  onRetry,
  cloudCount,
  onDeleteRequest
}: {
  onOpenCategoryPicker: () => void
  onOpenTagPicker: () => void
  onDownloadSelected: () => void
  downloading: boolean
  /** 批量下载进度（downloading 阶段广播） */
  progress: SyncProgress | null
  onCancelDownload: () => void
  /** 上次下载失败/取消后剩余可重试数量 */
  retryCount: number
  onRetry: () => void
  cloudCount: number
  onDeleteRequest: () => void
}) {
  const selectedIds = useUIStore((s) => s.selectedIds)
  const setSelectedIds = useUIStore((s) => s.setSelectedIds)
  const setSelectionMode = useUIStore((s) => s.setSelectionMode)
  const images = useLibraryStore(selectFilteredImages)

  if (selectedIds.length === 0) return null

  const allFilteredSelected = images.length > 0 && selectedIds.length >= images.length

  return (
    <div className="fixed bottom-6 left-1/2 z-40 flex -translate-x-1/2 items-center gap-2 rounded-2xl bg-white/95 px-4 py-2.5 shadow-2xl ring-1 ring-black/5 backdrop-blur dark:bg-neutral-800/95 dark:ring-white/10">
      <span className="mr-1 text-sm font-semibold tabular-nums">已选 {selectedIds.length} 张</span>
      <button
        className="btn-ghost !py-1 text-xs"
        onClick={() => setSelectedIds(allFilteredSelected ? [] : images.map((i) => i.id))}
      >
        <CheckSquare size={13} />
        {allFilteredSelected ? '取消全选' : '全选当前筛选'}
      </button>
      <span className="h-4 w-px bg-neutral-200 dark:bg-neutral-700" />
      <button className="btn-ghost !py-1 text-xs" onClick={onOpenCategoryPicker}>
        <FolderInput size={13} />
        设置分类…
      </button>
      <button className="btn-ghost !py-1 text-xs" onClick={onOpenTagPicker}>
        <TagIcon size={13} />
        加标签…
      </button>
      {downloading ? (
        <span className="flex items-center gap-2 text-xs text-neutral-500 dark:text-neutral-300">
          <Loader2 size={13} className="animate-spin" />
          {progress && progress.total > 0
            ? `下载中 ${progress.current}/${progress.total}`
            : '下载中…'}
          <button
            className="rounded-full border border-neutral-300 px-2 py-0.5 text-[11px] hover:border-red-400 hover:text-red-500 dark:border-neutral-600"
            onClick={onCancelDownload}
          >
            取消
          </button>
        </span>
      ) : (
        <>
          {cloudCount > 0 && (
            <button
              className="btn-ghost !py-1 text-xs"
              onClick={onDownloadSelected}
              title={`下载选中图片的原图到本地（${cloudCount} 张云端）`}
            >
              <CloudDownload size={13} />
              下载原图({cloudCount})
            </button>
          )}
          {retryCount > 0 && (
            <button
              className="btn-ghost !py-1 text-xs !text-amber-600 dark:!text-amber-400"
              onClick={onRetry}
              title="重试上次失败/取消的下载"
            >
              <RefreshCw size={13} />
              重试失败({retryCount})
            </button>
          )}
        </>
      )}
      <button className="btn-danger !py-1 text-xs" onClick={onDeleteRequest}>
        <Trash2 size={13} />
        删除…
      </button>
      <span className="h-4 w-px bg-neutral-200 dark:bg-neutral-700" />
      <button
        className="btn-ghost !py-1 text-xs"
        onClick={() => setSelectionMode(false)}
        title="退出批量选择（Esc）"
      >
        <X size={13} />
        完成
      </button>
    </div>
  )
}
