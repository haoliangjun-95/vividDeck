/**
 * 图片右键菜单（设为壁纸 / 收藏 / 裁剪 / 重命名 / 删除 / 归类 / 标签）（A1 自 GalleryGrid 拆分）
 * 批量选择模式下右键"已选中"的图片时，分类 / 标签 / 删除 / 收藏对整个选中集生效
 */
import { useState } from 'react'
import {
  Crop,
  FolderInput,
  Heart,
  ImageUp,
  Monitor,
  Pencil,
  Tag as TagIcon,
  Trash2
} from 'lucide-react'
import { useLibraryStore } from '../../store/library'
import { useUIStore } from '../../store/ui'
import type { ImageItem } from '@shared/types'

export function CardContextMenu({
  image,
  x,
  y,
  onClose,
  onRename,
  onDeleteRequest
}: {
  image: ImageItem
  x: number
  y: number
  onClose: () => void
  onRename: (image: ImageItem) => void
  onDeleteRequest: (ids: string[]) => void
}) {
  const toggleFavorite = useLibraryStore((s) => s.toggleFavorite)
  const assignCategory = useLibraryStore((s) => s.assignCategory)
  const assignCategoryMany = useLibraryStore((s) => s.assignCategoryMany)
  const setTags = useLibraryStore((s) => s.setTags)
  const setTagsMany = useLibraryStore((s) => s.setTagsMany)
  const images = useLibraryStore((s) => s.images)
  const categories = useLibraryStore((s) => s.categories)
  const allTags = useLibraryStore((s) => s.tags)
  const openWallpaperDialog = useUIStore((s) => s.openWallpaperDialog)
  const openCrop = useUIStore((s) => s.openCrop)
  const openLightbox = useUIStore((s) => s.openLightbox)
  const toast = useUIStore((s) => s.toast)
  const selectionMode = useUIStore((s) => s.selectionMode)
  const selectedIds = useUIStore((s) => s.selectedIds)
  const [newTag, setNewTag] = useState('')

  // 右键的图片在选中集合内 → 分类/标签/删除/收藏批量作用于全部选中
  const batchIds =
    selectionMode && selectedIds.includes(image.id) && selectedIds.length > 0
      ? [...selectedIds]
      : null
  const N = batchIds?.length ?? 1

  /** 切换标签：单张直接换；批量时以被右键图片的状态为准，对选中集统一加/删 */
  const toggleTag = (tag: string): void => {
    const has = image.tags.includes(tag)
    if (batchIds) {
      const entries = batchIds
        .map((id) => images.find((i) => i.id === id))
        .filter((i): i is ImageItem => Boolean(i))
        .map((i) => ({
          id: i.id,
          tags: has ? i.tags.filter((t) => t !== tag) : Array.from(new Set([...i.tags, tag]))
        }))
      void setTagsMany(entries)
      toast(`已${has ? '移除' : '添加'}标签「${tag}」（${N} 张）`, 'info')
    } else {
      void setTags(image.id, has ? image.tags.filter((t) => t !== tag) : [...image.tags, tag])
      toast(`已${has ? '移除' : '添加'}标签「${tag}」`, 'info')
    }
    onClose()
  }

  const addNewTag = (): void => {
    const name = newTag.trim()
    if (!name) return
    if (batchIds) {
      const entries = batchIds
        .map((id) => images.find((i) => i.id === id))
        .filter((i): i is ImageItem => Boolean(i))
        .map((i) => ({ id: i.id, tags: Array.from(new Set([...i.tags, name])) }))
      void setTagsMany(entries)
      toast(`已添加标签「${name}」（${N} 张）`)
    } else {
      void setTags(image.id, Array.from(new Set([...image.tags, name])))
      toast(`已添加标签「${name}」`)
    }
    onClose()
  }

  // 菜单尺寸估计，避免贴边溢出屏幕
  const W = 208
  const H = 430
  const left = Math.min(x, window.innerWidth - W - 8)
  const top = Math.min(y, window.innerHeight - H - 8)

  const item =
    'flex w-full items-center gap-2.5 rounded-md px-3 py-1.5 text-left text-[13px] hover:bg-neutral-100 dark:hover:bg-neutral-700/70'

  return (
    <div
      className="fixed inset-0 z-50"
      onMouseDown={onClose}
      onContextMenu={(e) => {
        e.preventDefault()
        onClose()
      }}
    >
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
            if (batchIds) {
              void window.api.updateImages(batchIds, { favorite: !image.favorite }).then((data) => {
                useLibraryStore.getState().applyData(data)
              })
              toast(`已${image.favorite ? '取消收藏' : '收藏'} ${N} 张`, 'info')
            } else {
              void toggleFavorite(image.id)
            }
            onClose()
          }}
        >
          <Heart size={15} fill={image.favorite ? 'currentColor' : 'none'} />
          {image.favorite ? '取消收藏' : '收藏'}
          {batchIds ? `（${N} 张）` : ''}
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
            onDeleteRequest(batchIds ?? [image.id])
            onClose()
          }}
        >
          <Trash2 size={15} />
          删除{batchIds ? `已选 ${N} 张` : ''}…
        </button>

        {/* 归类快捷区（批量选择时作用于全部选中） */}
        <div className="mt-1 border-t border-neutral-200 px-2 pb-2 pt-1.5 dark:border-neutral-800">
          <div className="flex items-center gap-1.5 px-1 pb-1.5 text-[11px] font-semibold uppercase tracking-wide text-neutral-400">
            <FolderInput size={12} />
            移动到分类
            {batchIds && (
              <span className="rounded bg-indigo-100 px-1 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300">
                已选 {N} 张
              </span>
            )}
          </div>
          <div className="max-h-36 overflow-y-auto pr-0.5">
            {categories.map((cat) => (
              <button
                key={cat.id}
                className={`${item} !py-1 !text-xs ${image.categoryId === cat.id ? '!text-indigo-600 dark:!text-indigo-400' : ''}`}
                onClick={() => {
                  if (batchIds) {
                    void assignCategoryMany(batchIds, cat.id).then(() => {
                      toast(`已将 ${N} 张移入「${cat.name}」`)
                    })
                  } else {
                    void assignCategory(image.id, cat.id)
                    toast(`已移入「${cat.name}」`, 'info')
                  }
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
                if (batchIds) {
                  void assignCategoryMany(batchIds, null).then(() => {
                    toast(`已将 ${N} 张移出分类`, 'info')
                  })
                } else {
                  void assignCategory(image.id, null)
                  toast('已移出分类', 'info')
                }
                onClose()
              }}
            >
              未分类
            </button>
          </div>
        </div>

        {/* 标签快捷区（点击切换加/删；批量时作用于全部选中） */}
        <div className="mt-1 border-t border-neutral-200 px-2 pb-2 pt-1.5 dark:border-neutral-800">
          <div className="flex items-center gap-1.5 px-1 pb-1.5 text-[11px] font-semibold uppercase tracking-wide text-neutral-400">
            <TagIcon size={12} />
            标签
            {batchIds && (
              <span className="rounded bg-indigo-100 px-1 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300">
                已选 {N} 张
              </span>
            )}
          </div>
          <div className="flex max-h-24 flex-wrap gap-1 overflow-y-auto px-1 pb-1.5">
            {allTags.map((tag) => {
              const has = image.tags.includes(tag)
              return (
                <button
                  key={tag}
                  className={`rounded-full px-1.5 py-0.5 text-[11px] transition-colors ${
                    has
                      ? 'bg-indigo-600 text-white'
                      : 'bg-neutral-100 text-neutral-500 hover:bg-indigo-100 hover:text-indigo-700 dark:bg-neutral-800 dark:text-neutral-400'
                  }`}
                  title={has ? '点击移除该标签' : '点击添加该标签'}
                  onClick={() => toggleTag(tag)}
                >
                  {has ? '✓ ' : '+ '}
                  {tag}
                </button>
              )
            })}
            {allTags.length === 0 && (
              <span className="px-1 text-[11px] text-neutral-400">暂无标签</span>
            )}
          </div>
          <div className="flex gap-1 px-1">
            <input
              className="field flex-1 !px-2 !py-1 text-[11px]"
              placeholder="新标签，回车添加"
              value={newTag}
              onChange={(e) => setNewTag(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') addNewTag()
              }}
            />
            <button
              className="btn-ghost !px-2 !py-1 text-[11px]"
              onClick={addNewTag}
              disabled={!newTag.trim()}
            >
              添加
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
