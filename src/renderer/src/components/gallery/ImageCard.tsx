/**
 * 画廊缩略图卡片（A1 自 GalleryGrid 拆分）：
 * 懒加载缩略图（失败 1.2s 重试一次）、悬停元信息、收藏/设壁纸按钮、
 * 云端角标、选择模式勾选、拖拽源（拖到侧栏分类即归类）
 */
import React from 'react'
import { Check, Heart, Monitor } from 'lucide-react'
import { useLibraryStore } from '../../store/library'
import { useUIStore } from '../../store/ui'
import { formatBytes, formatLabel, mediaUrl } from '../../lib/utils'
import { CardInfoFooter } from './CardInfoFooter'
import type { ImageItem } from '@shared/types'

export function ImageCard({
  image,
  onContextMenu
}: {
  image: ImageItem
  onContextMenu: (e: React.MouseEvent, image: ImageItem) => void
}) {
  const toggleFavorite = useLibraryStore((s) => s.toggleFavorite)
  const openLightbox = useUIStore((s) => s.openLightbox)
  const openWallpaperDialog = useUIStore((s) => s.openWallpaperDialog)
  const selectionMode = useUIStore((s) => s.selectionMode)
  const selected = useUIStore((s) => s.selectedIds.includes(image.id))
  const toggleSelected = useUIStore((s) => s.toggleSelected)

  return (
    <div
      className={`group relative cursor-pointer overflow-hidden rounded-xl bg-neutral-100 shadow-sm ring-1 transition-shadow hover:shadow-lg dark:bg-neutral-900 ${
        selectionMode && selected ? 'ring-2 ring-indigo-500' : 'ring-black/5 dark:ring-white/5'
      }`}
      draggable={!selectionMode}
      onDragStart={(e) => {
        if (selectionMode) return
        // 拖拽到侧栏分类即可归类
        e.dataTransfer.setData('application/x-vd-image', image.id)
        e.dataTransfer.effectAllowed = 'move'
      }}
      onClick={(e) => {
        if (selectionMode) {
          // 忽略连点的第二次及以后（e.detail>1）：兼容"双击设壁纸"的肌肉记忆，
          // 双击只算选中一次，不会把刚选中的又取消掉
          if (e.detail === 1) toggleSelected(image.id)
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
      <figure
        className="relative overflow-hidden bg-neutral-200 dark:bg-neutral-800"
        style={{ aspectRatio: '4 / 3' }}
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
              image.favorite
                ? 'text-amber-400 opacity-100'
                : 'text-white/80 opacity-0 group-hover:opacity-100'
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
              selected
                ? 'border-indigo-500 bg-indigo-500 text-white'
                : 'border-white/80 bg-black/30 text-transparent backdrop-blur'
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
