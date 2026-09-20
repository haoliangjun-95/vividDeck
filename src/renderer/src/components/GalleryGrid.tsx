/**
 * 画廊网格：缩略图卡片（含分类/标签信息栏）、懒加载分页、拖拽源、
 * 右键菜单、批量选择模式（批量设置分类 / 批量删除）
 */
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Check, CheckSquare, Crop, FolderInput, FolderOpen, Heart, ImageUp, Monitor, Pencil, Trash2, X } from 'lucide-react'
import { selectFilteredImages, useLibraryStore } from '../store/library'
import { useUIStore } from '../store/ui'
import { formatBytes, formatLabel, mediaUrl } from '../lib/utils'
import { Modal } from './ui'
import type { ImageItem } from '@shared/types'

const PAGE_SIZE = 60

/** 卡片信息栏：分类徽章 + 标签 chips */
function CardInfoFooter({ image }: { image: ImageItem }) {
  const category = useLibraryStore((s) => s.categories.find((c) => c.id === image.categoryId))
  const visibleTags = image.tags.slice(0, 2)
  const moreTags = image.tags.length - visibleTags.length

  return (
    <div className="flex min-h-[34px] flex-wrap items-center gap-1 px-2 py-1.5">
      {category ? (
        <span className="inline-flex max-w-full items-center gap-1 rounded-md bg-indigo-50 px-1.5 py-0.5 text-[11px] font-medium text-indigo-700 dark:bg-indigo-950/70 dark:text-indigo-300">
          <FolderOpen size={11} className="shrink-0" />
          <span className="truncate">{category.name}</span>
        </span>
      ) : (
        <span className="inline-flex items-center gap-1 rounded-md bg-neutral-100 px-1.5 py-0.5 text-[11px] text-neutral-400 dark:bg-neutral-800">
          <FolderOpen size={11} />
          未分类
        </span>
      )}
      {visibleTags.map((tag) => (
        <span
          key={tag}
          className="max-w-[72px] truncate rounded-md bg-neutral-100 px-1.5 py-0.5 text-[11px] text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400"
          title={tag}
        >
          #{tag}
        </span>
      ))}
      {moreTags > 0 && (
        <span className="rounded-md bg-neutral-100 px-1.5 py-0.5 text-[11px] text-neutral-400 dark:bg-neutral-800">
          +{moreTags}
        </span>
      )}
    </div>
  )
}

function ImageCard({ image, onContextMenu }: { image: ImageItem; onContextMenu: (e: React.MouseEvent, image: ImageItem) => void }) {
  const toggleFavorite = useLibraryStore((s) => s.toggleFavorite)
  const openLightbox = useUIStore((s) => s.openLightbox)
  const openWallpaperDialog = useUIStore((s) => s.openWallpaperDialog)
  const selectionMode = useUIStore((s) => s.selectionMode)
  const selected = useUIStore((s) => s.selectedIds.includes(image.id))
  const toggleSelected = useUIStore((s) => s.toggleSelected)

  return (
    <div
      className={`group relative cursor-pointer overflow-hidden rounded-xl bg-neutral-100 shadow-sm ring-1 transition-shadow hover:shadow-lg dark:bg-neutral-900 ${
        selectionMode && selected
          ? 'ring-2 ring-indigo-500'
          : 'ring-black/5 dark:ring-white/5'
      }`}
      draggable={!selectionMode}
      onDragStart={(e) => {
        if (selectionMode) return
        // 拖拽到侧栏分类即可归类
        e.dataTransfer.setData('application/x-vd-image', image.id)
        e.dataTransfer.effectAllowed = 'move'
      }}
      onClick={() => {
        if (selectionMode) {
          toggleSelected(image.id)
          return
        }
        openLightbox(image.id)
      }}
      onDoubleClick={() => {
        if (!selectionMode) openWallpaperDialog(image.id)
      }}
      onContextMenu={(e) => onContextMenu(e, image)}
      title={selectionMode ? undefined : `${image.fileName}（双击设为壁纸，右键更多操作）`}
    >
      {/* 图片区（悬停渐变与操作） */}
      <figure className="relative overflow-hidden bg-neutral-200 dark:bg-neutral-800" style={{ aspectRatio: '4 / 3' }}>
        <img
          src={mediaUrl('thumb', image.id)}
          alt={image.fileName}
          loading="lazy"
          className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
          onError={(e) => {
            // 缩略图尚未生成：1.2s 后重试一次（导入大文件夹时常见）
            const el = e.currentTarget
            if (!el.dataset.retried) {
              el.dataset.retried = '1'
              setTimeout(() => {
                el.src = `${mediaUrl('thumb', image.id)}?r=${Date.now()}`
              }, 1200)
            }
          }}
        />
        <div className="pointer-events-none absolute inset-x-0 top-0 bg-gradient-to-b from-black/60 to-transparent p-2 opacity-0 transition-opacity group-hover:opacity-100">
          <div className="truncate text-xs font-medium text-white">{image.fileName}</div>
          <div className="mt-0.5 flex items-center gap-2 text-[11px] text-white/70">
            <span>
              {image.width}×{image.height}
            </span>
            <span>{formatBytes(image.sizeBytes)}</span>
            <span>{formatLabel(image.format)}</span>
          </div>
        </div>

        {/* 云端图片角标 */}
        {!image.localFile && (
          <span
            className="absolute bottom-2 right-2 flex items-center gap-1 rounded-full bg-black/50 px-1.5 py-0.5 text-[10px] text-white/90 backdrop-blur"
            title="云端图片：打开或设为壁纸时自动下载"
          >
            ☁ 云端
          </span>
        )}

        {/* 收藏星标 */}
        {!selectionMode && (
          <button
            className={`absolute right-2 top-2 rounded-full p-1.5 backdrop-blur transition-opacity ${
              image.favorite ? 'text-amber-400 opacity-100' : 'text-white/80 opacity-0 group-hover:opacity-100'
            }`}
            onClick={(e) => {
              e.stopPropagation()
              void toggleFavorite(image.id)
            }}
            title={image.favorite ? '取消收藏' : '收藏'}
          >
            <Heart size={15} fill={image.favorite ? 'currentColor' : 'none'} />
          </button>
        )}

        {/* 一键设壁纸 */}
        {!selectionMode && (
          <button
            className="absolute left-2 top-2 rounded-full bg-black/40 p-1.5 text-white opacity-0 backdrop-blur transition-opacity hover:bg-indigo-600 group-hover:opacity-100"
            onClick={(e) => {
              e.stopPropagation()
              openWallpaperDialog(image.id)
            }}
            title="设为壁纸"
          >
            <Monitor size={15} />
          </button>
        )}

        {/* 选择模式勾选框 */}
        {selectionMode && (
          <span
            className={`absolute left-2 top-2 flex h-6 w-6 items-center justify-center rounded-full border-2 transition-colors ${
              selected ? 'border-indigo-500 bg-indigo-500 text-white' : 'border-white/80 bg-black/30 text-transparent backdrop-blur'
            }`}
          >
            <Check size={14} strokeWidth={3} />
          </span>
        )}
      </figure>

      {/* 分类 + 标签信息栏 */}
      <CardInfoFooter image={image} />
    </div>
  )
}

/** 图片右键菜单（设为壁纸 / 收藏 / 裁剪 / 重命名 / 删除 / 归类） */
function CardContextMenu({
  image,
  x,
  y,
  onClose,
  onRename
}: {
  image: ImageItem
  x: number
  y: number
  onClose: () => void
  onRename: (image: ImageItem) => void
}) {
  const toggleFavorite = useLibraryStore((s) => s.toggleFavorite)
  const assignCategory = useLibraryStore((s) => s.assignCategory)
  const remove = useLibraryStore((s) => s.remove)
  const categories = useLibraryStore((s) => s.categories)
  const openWallpaperDialog = useUIStore((s) => s.openWallpaperDialog)
  const openCrop = useUIStore((s) => s.openCrop)
  const openLightbox = useUIStore((s) => s.openLightbox)
  const toast = useUIStore((s) => s.toast)
  const [confirmDelete, setConfirmDelete] = useState(false)

  // 菜单尺寸估计，避免贴边溢出屏幕
  const W = 208
  const H = 330
  const left = Math.min(x, window.innerWidth - W - 8)
  const top = Math.min(y, window.innerHeight - H - 8)

  const item =
    'flex w-full items-center gap-2.5 rounded-md px-3 py-1.5 text-left text-[13px] hover:bg-neutral-100 dark:hover:bg-neutral-700/70'

  return (
    <div className="fixed inset-0 z-50" onMouseDown={onClose} onContextMenu={(e) => { e.preventDefault(); onClose() }}>
      <div
        className="card fixed w-52 overflow-hidden py-1 shadow-xl"
        style={{ left, top }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <button
          className={`${item} font-medium !text-indigo-600 dark:!text-indigo-400`}
          onClick={() => {
            openWallpaperDialog(image.id)
            onClose()
          }}
        >
          <Monitor size={15} />
          设为壁纸…
        </button>
        <button
          className={item}
          onClick={() => {
            void toggleFavorite(image.id)
            onClose()
          }}
        >
          <Heart size={15} fill={image.favorite ? 'currentColor' : 'none'} />
          {image.favorite ? '取消收藏' : '收藏'}
        </button>
        <button
          className={item}
          onClick={() => {
            openCrop(image.id)
            onClose()
          }}
        >
          <Crop size={15} />
          裁剪…
        </button>
        <button
          className={item}
          onClick={() => {
            openLightbox(image.id)
            onClose()
          }}
        >
          <ImageUp size={15} />
          放大查看
        </button>
        <button
          className={item}
          onClick={() => {
            onRename(image)
            onClose()
          }}
        >
          <Pencil size={15} />
          重命名…
        </button>
        <button
          className={`${item} !text-red-600 dark:!text-red-400`}
          onClick={() => {
            if (!confirmDelete) {
              setConfirmDelete(true)
              return
            }
            void remove(image.id)
            toast('已删除', 'info')
            onClose()
          }}
        >
          <Trash2 size={15} />
          {confirmDelete ? '再点一次确认删除' : '删除'}
        </button>

        {/* 归类快捷区 */}
        <div className="mt-1 border-t border-neutral-200 px-2 pb-2 pt-1.5 dark:border-neutral-800">
          <div className="flex items-center gap-1.5 px-1 pb-1.5 text-[11px] font-semibold uppercase tracking-wide text-neutral-400">
            <FolderInput size={12} />
            移动到分类
          </div>
          <div className="max-h-36 overflow-y-auto pr-0.5">
            {categories.map((cat) => (
              <button
                key={cat.id}
                className={`${item} !py-1 !text-xs ${image.categoryId === cat.id ? '!text-indigo-600 dark:!text-indigo-400' : ''}`}
                onClick={() => {
                  void assignCategory(image.id, cat.id)
                  toast(`已移入「${cat.name}」`, 'info')
                  onClose()
                }}
              >
                {image.categoryId === cat.id ? '✓ ' : ''}
                {cat.name}
              </button>
            ))}
            <button
              className={`${item} !py-1 !text-xs`}
              onClick={() => {
                void assignCategory(image.id, null)
                toast('已移出分类', 'info')
                onClose()
              }}
            >
              未分类
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

/** 右键菜单触发的重命名弹窗 */
function RenameModal({ image, onClose }: { image: ImageItem; onClose: () => void }) {
  const rename = useLibraryStore((s) => s.rename)
  const toast = useUIStore((s) => s.toast)
  const [name, setName] = useState(image.fileName)
  return (
    <Modal title="重命名" onClose={onClose} width="max-w-md">
      <div className="space-y-3">
        <input
          className="field w-full"
          value={name}
          autoFocus
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && name.trim()) {
              void rename(image.id, name.trim())
              toast('已重命名')
              onClose()
            }
          }}
        />
        <div className="flex justify-end gap-2">
          <button className="btn-ghost" onClick={onClose}>
            取消
          </button>
          <button
            className="btn-primary"
            disabled={!name.trim()}
            onClick={() => {
              void rename(image.id, name.trim())
              toast('已重命名')
              onClose()
            }}
          >
            保存
          </button>
        </div>
      </div>
    </Modal>
  )
}

/** 批量操作栏（选择模式下有选中时显示） */
function BatchActionBar({ onCloseCategoryPicker }: { onCloseCategoryPicker: () => void }) {
  const selectedIds = useUIStore((s) => s.selectedIds)
  const setSelectedIds = useUIStore((s) => s.setSelectedIds)
  const setSelectionMode = useUIStore((s) => s.setSelectionMode)
  const clearSelection = useUIStore((s) => s.clearSelection)
  const images = useLibraryStore(selectFilteredImages)
  const removeMany = useLibraryStore((s) => s.removeMany)
  const toast = useUIStore((s) => s.toast)
  const [confirmDelete, setConfirmDelete] = useState(false)

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
      <button
        className="btn-ghost !py-1 text-xs"
        onClick={() => {
          onCloseCategoryPicker()
          setConfirmDelete(false)
        }}
      >
        <FolderInput size={13} />
        设置分类…
      </button>
      <button
        className={`btn !py-1 text-xs ${confirmDelete ? '!bg-red-600 !text-white hover:!bg-red-500' : 'btn-danger'}`}
        onBlur={() => setConfirmDelete(false)}
        onClick={() => {
          if (!confirmDelete) {
            setConfirmDelete(true)
            return
          }
          const ids = [...selectedIds]
          void removeMany(ids).then(() => {
            toast(`已删除 ${ids.length} 张`, 'info')
            clearSelection()
          })
        }}
      >
        <Trash2 size={13} />
        {confirmDelete ? `确认删除 ${selectedIds.length} 张` : '删除'}
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

/** 批量设置分类弹窗 */
function BatchCategoryModal({ ids, onClose }: { ids: string[]; onClose: () => void }) {
  const categories = useLibraryStore((s) => s.categories)
  const assignCategoryMany = useLibraryStore((s) => s.assignCategoryMany)
  const toast = useUIStore((s) => s.toast)
  const clearSelection = useUIStore((s) => s.clearSelection)

  return (
    <Modal title={`设置分类（${ids.length} 张）`} onClose={onClose} width="max-w-md">
      <div className="space-y-3">
        <div className="max-h-72 space-y-1.5 overflow-y-auto">
          {categories.map((cat) => (
            <button
              key={cat.id}
              className="flex w-full items-center gap-2 rounded-lg border border-neutral-300 px-3 py-2 text-left text-sm transition-colors hover:border-indigo-400 hover:bg-indigo-50 dark:border-neutral-700 dark:hover:bg-indigo-950/50"
              onClick={() => {
                void assignCategoryMany(ids, cat.id).then(() => {
                  toast(`已将 ${ids.length} 张移入「${cat.name}」`)
                  clearSelection()
                  onClose()
                })
              }}
            >
              <FolderOpen size={15} className="text-indigo-500" />
              {cat.name}
            </button>
          ))}
          <button
            className="flex w-full items-center gap-2 rounded-lg border border-dashed border-neutral-300 px-3 py-2 text-left text-sm text-neutral-500 transition-colors hover:border-red-400 hover:text-red-500 dark:border-neutral-700"
            onClick={() => {
              void assignCategoryMany(ids, null).then(() => {
                toast(`已将 ${ids.length} 张移出分类`, 'info')
                clearSelection()
                onClose()
              })
            }}
          >
            <X size={15} />
            移出分类（设为未分类）
          </button>
        </div>
        <p className="text-xs text-neutral-400">批量修改会同步刷新修改时间，经 MinIO 同步自动传播到其他设备。</p>
      </div>
    </Modal>
  )
}

export function GalleryGrid(): JSX.Element {
  const images = useLibraryStore(selectFilteredImages)
  const loaded = useLibraryStore((s) => s.loaded)
  const importPaths = useLibraryStore((s) => s.importFiles)
  const toast = useUIStore((s) => s.toast)
  const selectionMode = useUIStore((s) => s.selectionMode)
  const selectedIds = useUIStore((s) => s.selectedIds)
  const setSelectionMode = useUIStore((s) => s.setSelectionMode)
  const [visible, setVisible] = useState(PAGE_SIZE)
  const sentinelRef = useRef<HTMLDivElement>(null)
  const [menu, setMenu] = useState<{ x: number; y: number; image: ImageItem } | null>(null)
  const [renaming, setRenaming] = useState<ImageItem | null>(null)
  const [categoryPickerOpen, setCategoryPickerOpen] = useState(false)

  // 筛选条件变化时重置分页
  useEffect(() => setVisible(PAGE_SIZE), [images])

  // Esc 退出批量选择（无弹窗时）
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && selectionMode && !categoryPickerOpen) setSelectionMode(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selectionMode, categoryPickerOpen, setSelectionMode])

  // 滚动触底加载更多（懒分页，数千张不卡顿）
  useEffect(() => {
    const el = sentinelRef.current
    if (!el) return
    const observer = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting) setVisible((v) => v + PAGE_SIZE)
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [images])

  const shown = useMemo(() => images.slice(0, visible), [images, visible])

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
          const paths = Array.from(e.dataTransfer.files).map((f) => window.api.filePathOf(f))
          if (paths.length) void importPaths(paths).then((r) => r.added > 0 && toast(`导入 ${r.added} 张图片`))
        }}
      >
        <div className="text-5xl">🖼️</div>
        <div className="text-sm">还没有图片，点击上方「导入图片」或把图片/文件夹拖到这里</div>
      </div>
    )
  }

  return (
    <div className="h-full overflow-y-auto p-4 pb-24">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
        {shown.map((image) => (
          <ImageCard key={image.id} image={image} onContextMenu={openMenu} />
        ))}
      </div>
      <div ref={sentinelRef} className="h-8" />

      {menu && <CardContextMenu image={menu.image} x={menu.x} y={menu.y} onClose={() => setMenu(null)} onRename={(img) => setRenaming(img)} />}
      {renaming && <RenameModal image={renaming} onClose={() => setRenaming(null)} />}

      {/* 批量操作栏与分类选择弹窗 */}
      <BatchActionBar onCloseCategoryPicker={() => setCategoryPickerOpen(true)} />
      {categoryPickerOpen && selectedIds.length > 0 && (
        <BatchCategoryModal ids={[...selectedIds]} onClose={() => setCategoryPickerOpen(false)} />
      )}
    </div>
  )
}
