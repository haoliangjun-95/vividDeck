/**
 * 画廊网格：缩略图网格、懒加载分页、拖拽源、右键菜单（设为壁纸等快捷操作）
 */
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Cloud, Crop, FolderInput, Heart, ImageUp, Monitor, Pencil, Trash2 } from 'lucide-react'
import { selectFilteredImages, useLibraryStore } from '../store/library'
import { useUIStore } from '../store/ui'
import { formatBytes, formatLabel, mediaUrl } from '../lib/utils'
import { Modal } from './ui'
import type { ImageItem } from '@shared/types'

const PAGE_SIZE = 60

function ImageCard({ image, onContextMenu }: { image: ImageItem; onContextMenu: (e: React.MouseEvent, image: ImageItem) => void }) {
  const toggleFavorite = useLibraryStore((s) => s.toggleFavorite)
  const openLightbox = useUIStore((s) => s.openLightbox)
  const openWallpaperDialog = useUIStore((s) => s.openWallpaperDialog)

  return (
    <figure
      className="group relative cursor-pointer overflow-hidden rounded-xl bg-neutral-200 shadow-sm ring-1 ring-black/5 transition-shadow hover:shadow-lg dark:bg-neutral-800 dark:ring-white/5"
      style={{ aspectRatio: '4 / 3' }}
      draggable
      onDragStart={(e) => {
        // 拖拽到侧栏分类即可归类
        e.dataTransfer.setData('application/x-vd-image', image.id)
        e.dataTransfer.effectAllowed = 'move'
      }}
      onClick={() => openLightbox(image.id)}
      onDoubleClick={() => openWallpaperDialog(image.id)}
      onContextMenu={(e) => onContextMenu(e, image)}
      title={`${image.fileName}（双击设为壁纸，右键更多操作）`}
    >
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

      {/* 悬停渐变与文件信息 */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent p-2 opacity-0 transition-opacity group-hover:opacity-100">
        <div className="truncate text-xs font-medium text-white">{image.fileName}</div>
        <div className="mt-0.5 flex items-center gap-2 text-[11px] text-white/70">
          <span>
            {image.width}×{image.height}
          </span>
          <span>{formatBytes(image.sizeBytes)}</span>
          <span>{formatLabel(image.format)}</span>
        </div>
      </div>

      {/* 云端图片角标（本地无文件，查看/设壁纸时按需下载） */}
      {!image.localFile && (
        <span
          className="absolute bottom-2 right-2 flex items-center gap-1 rounded-full bg-black/50 px-1.5 py-0.5 text-[10px] text-white/90 backdrop-blur"
          title="云端图片：打开或设为壁纸时自动下载"
        >
          <Cloud size={10} />
          云端
        </span>
      )}

      {/* 收藏星标 */}
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

      {/* 一键设壁纸 */}
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
    </figure>
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

export function GalleryGrid(): JSX.Element {
  const images = useLibraryStore(selectFilteredImages)
  const loaded = useLibraryStore((s) => s.loaded)
  const importPaths = useLibraryStore((s) => s.importFiles)
  const toast = useUIStore((s) => s.toast)
  const [visible, setVisible] = useState(PAGE_SIZE)
  const sentinelRef = useRef<HTMLDivElement>(null)
  const [menu, setMenu] = useState<{ x: number; y: number; image: ImageItem } | null>(null)
  const [renaming, setRenaming] = useState<ImageItem | null>(null)

  // 筛选条件变化时重置分页
  useEffect(() => setVisible(PAGE_SIZE), [images])

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
    <div className="h-full overflow-y-auto p-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
        {shown.map((image) => (
          <ImageCard key={image.id} image={image} onContextMenu={openMenu} />
        ))}
      </div>
      <div ref={sentinelRef} className="h-8" />

      {menu && (
        <CardContextMenu
          image={menu.image}
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          onRename={(img) => setRenaming(img)}
        />
      )}
      {renaming && <RenameModal image={renaming} onClose={() => setRenaming(null)} />}
    </div>
  )
}
