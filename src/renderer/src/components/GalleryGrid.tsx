/**
 * 画廊网格：缩略图卡片（含分类/标签信息栏）、懒加载分页、拖拽源、
 * 右键菜单、批量选择模式（批量设置分类 / 批量删除）
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Check, CheckSquare, CloudDownload, Crop, FolderInput, FolderOpen, Heart, ImageUp, Monitor, Pencil, Tag as TagIcon, Trash2, X } from 'lucide-react'
import { selectFilteredImages, useLibraryStore } from '../store/library'
import { useUIStore } from '../store/ui'
import { formatBytes, formatLabel, mediaUrl } from '../lib/utils'
import { Modal } from './ui'
import type { ImageItem } from '@shared/types'

/** 缩略图加载失败后的重试延迟（导入大文件夹时缩略图可能尚未生成） */
const THUMBNAIL_RETRY_DELAY_MS = 1200

/** 卡片信息栏：分类徽章 + 标签 chips（memo：父卡片重渲染时按 image 引用跳过） */
const CardInfoFooter = React.memo(function CardInfoFooter({ image }: { image: ImageItem }) {
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
})

/** 缩略图卡片（memo：虚拟滚动下 scrollTop 每帧变化，仅 image/回调引用变化时才重渲染） */
const ImageCard = React.memo(function ImageCard({ image, onContextMenu }: { image: ImageItem; onContextMenu: (e: React.MouseEvent, image: ImageItem) => void }) {
  const toggleFavorite = useLibraryStore((s) => s.toggleFavorite)
  const openLightbox = useUIStore((s) => s.openLightbox)
  const openWallpaperDialog = useUIStore((s) => s.openWallpaperDialog)
  const selectionMode = useUIStore((s) => s.selectionMode)
  const selected = useUIStore((s) => s.selectedIds.includes(image.id))
  const toggleSelected = useUIStore((s) => s.toggleSelected)
  // 缩略图重试定时器：虚拟化下卡片频繁卸载，需清理避免定时器泄漏
  const retryTimerRef = useRef<number | null>(null)
  useEffect(
    () => () => {
      if (retryTimerRef.current !== null) window.clearTimeout(retryTimerRef.current)
    },
    []
  )

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
      <figure className="relative overflow-hidden bg-neutral-200 dark:bg-neutral-800" style={{ aspectRatio: '4 / 3' }}>
        <img
          src={mediaUrl('thumb', image.id)}
          alt={image.fileName}
          loading="lazy"
          className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
          onError={(e) => {
            // 缩略图尚未生成：延迟后重试一次（导入大文件夹时常见）
            const el = e.currentTarget
            if (!el.dataset.retried) {
              el.dataset.retried = '1'
              retryTimerRef.current = window.setTimeout(() => {
                retryTimerRef.current = null
                el.src = `${mediaUrl('thumb', image.id)}?r=${Date.now()}`
              }, THUMBNAIL_RETRY_DELAY_MS)
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
})

/** 图片右键菜单（设为壁纸 / 收藏 / 裁剪 / 重命名 / 删除 / 归类 / 标签）
 *  批量选择模式下右键"已选中"的图片时，分类 / 标签 / 删除 / 收藏对整个选中集生效 */
function CardContextMenu({
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
    selectionMode && selectedIds.includes(image.id) && selectedIds.length > 0 ? [...selectedIds] : null
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
            {batchIds && <span className="rounded bg-indigo-100 px-1 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300">已选 {N} 张</span>}
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
            {batchIds && <span className="rounded bg-indigo-100 px-1 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300">已选 {N} 张</span>}
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
            {allTags.length === 0 && <span className="px-1 text-[11px] text-neutral-400">暂无标签</span>}
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
            <button className="btn-ghost !px-2 !py-1 text-[11px]" onClick={addNewTag} disabled={!newTag.trim()}>
              添加
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
function BatchActionBar({
  onOpenCategoryPicker,
  onOpenTagPicker,
  onDownloadSelected,
  downloading,
  cloudCount,
  onDeleteRequest
}: {
  onOpenCategoryPicker: () => void
  onOpenTagPicker: () => void
  onDownloadSelected: () => void
  downloading: boolean
  cloudCount: number
  onDeleteRequest: () => void
}) {
  const selectedIds = useUIStore((s) => s.selectedIds)
  const setSelectedIds = useUIStore((s) => s.setSelectedIds)
  const setSelectionMode = useUIStore((s) => s.setSelectionMode)
  const images = useLibraryStore(selectFilteredImages)
  const toast = useUIStore((s) => s.toast)

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
      {cloudCount > 0 && (
        <button className="btn-ghost !py-1 text-xs" onClick={onDownloadSelected} title={`下载选中图片的原图到本地（${cloudCount} 张云端）`}>
          <CloudDownload size={13} />
          {downloading ? '下载中…' : `下载原图(${cloudCount})`}
        </button>
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

/** 批量加标签弹窗（勾选已有标签 / 输入新标签，一次合并添加到全部选中） */
function BatchTagModal({ ids, onClose }: { ids: string[]; onClose: () => void }) {
  const images = useLibraryStore((s) => s.images)
  const allTags = useLibraryStore((s) => s.tags)
  const setTagsMany = useLibraryStore((s) => s.setTagsMany)
  const toast = useUIStore((s) => s.toast)
  const pushUndo = useUIStore((s) => s.pushUndo)
  const [picked, setPicked] = useState<string[]>([])
  const [newTags, setNewTags] = useState('')

  const apply = (): void => {
    const additions = Array.from(new Set([...picked, ...newTags.split(/[,，\s]+/).map((t) => t.trim()).filter(Boolean)]))
    if (additions.length === 0) return
    const before = ids
      .map((id) => images.find((i) => i.id === id))
      .filter((i): i is ImageItem => Boolean(i))
      .map((i) => ({ id: i.id, patch: { tags: i.tags } }))
    const entries = ids
      .map((id) => images.find((i) => i.id === id))
      .filter((i): i is ImageItem => Boolean(i))
      .map((i) => ({ id: i.id, tags: Array.from(new Set([...i.tags, ...additions])) }))
    void setTagsMany(entries).then(() => {
      // 入撤销栈：Cmd/Ctrl+Z 可重放（与 toast「撤销」按钮共用同一 before 快照；
      // 键盘路径由快捷键处理器统一提示并刷新库数据）
      pushUndo(`标签修改（${ids.length} 张）`, async () => {
        await window.api.applyEntries(before)
      })
      toast(`已为 ${ids.length} 张添加 ${additions.length} 个标签`, 'success', {
        duration: 8000,
        action: {
          label: '撤销',
          onClick: () => {
            void window.api.applyEntries(before).then(() => {
              toast('已撤销标签修改', 'info')
              void useLibraryStore.getState().load()
            })
          }
        }
      })
      onClose()
    })
  }

  return (
    <Modal title={`批量加标签（${ids.length} 张）`} onClose={onClose} width="max-w-md">
      <div className="space-y-3">
        {allTags.length > 0 && (
          <div className="flex max-h-36 flex-wrap gap-1.5 overflow-y-auto">
            {allTags.map((tag) => {
              const active = picked.includes(tag)
              return (
                <button
                  key={tag}
                  className={`rounded-full px-2 py-0.5 text-xs transition-colors ${
                    active
                      ? 'bg-indigo-600 text-white'
                      : 'bg-neutral-100 text-neutral-600 hover:bg-indigo-100 hover:text-indigo-700 dark:bg-neutral-800 dark:text-neutral-300'
                  }`}
                  onClick={() => setPicked(active ? picked.filter((t) => t !== tag) : [...picked, tag])}
                >
                  {active ? '✓ ' : '+ '}
                  {tag}
                </button>
              )
            })}
          </div>
        )}
        <input
          className="field w-full"
          placeholder="新标签（可用逗号/空格分隔多个）"
          value={newTags}
          onChange={(e) => setNewTags(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') apply()
          }}
        />
        <div className="flex justify-end gap-2 border-t border-neutral-200 pt-3 dark:border-neutral-800">
          <button className="btn-ghost" onClick={onClose}>
            取消
          </button>
          <button
            className="btn-primary"
            disabled={picked.length === 0 && newTags.trim() === ''}
            onClick={apply}
          >
            添加到 {ids.length} 张
          </button>
        </div>
        <p className="text-xs text-neutral-400">批量添加为「并入」：选中图片已有的标签保留不覆盖。</p>
      </div>
    </Modal>
  )
}

/** 删除确认弹窗：两个明确入口（所有设备删除 / 仅清理本地副本）+ 撤销提示 */
function DeleteConfirmModal({ ids, onClose }: { ids: string[]; onClose: () => void }) {
  const toast = useUIStore((st) => st.toast)
  const pushUndo = useUIStore((st) => st.pushUndo)
  const clearSelection = useUIStore((st) => st.clearSelection)
  const [busy, setBusy] = useState(false)

  const doDelete = async (mode: 'all' | 'local'): Promise<void> => {
    setBusy(true)
    try {
      await window.api.deleteImages(ids, mode)
      if (mode === 'all') {
        // 入撤销栈：Cmd/Ctrl+Z 可从废纸篓恢复（与 toast「撤销」按钮共用同一 restoreImages；
        // 键盘路径由快捷键处理器统一提示并刷新库数据）
        pushUndo(`删除 ${ids.length} 张图片`, async () => {
          await window.api.restoreImages(ids)
        })
      }
      toast(
        mode === 'all' ? `已从所有设备删除 ${ids.length} 张` : `已清理 ${ids.length} 张本地副本`,
        'info',
        mode === 'all'
          ? {
              duration: 8000,
              action: {
                label: '撤销',
                onClick: () => {
                  void window.api.restoreImages(ids).then(({ restored }) => {
                    toast(restored > 0 ? `已恢复 ${restored} 张` : '暂存区已清理，无法恢复', restored > 0 ? 'success' : 'error')
                    void useLibraryStore.getState().load()
                  })
                }
              }
            }
          : undefined
      )
      clearSelection()
      onClose()
      void useLibraryStore.getState().load()
    } catch (err) {
      toast(`删除失败：${err instanceof Error ? err.message : String(err)}`, 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title={`删除 ${ids.length} 张图片`} onClose={onClose} width="max-w-md">
      <div className="space-y-3">
        <button
          className="w-full rounded-lg border border-red-300 p-3 text-left transition-colors hover:bg-red-50 dark:border-red-800 dark:hover:bg-red-950/40"
          disabled={busy}
          onClick={() => void doDelete('all')}
        >
          <div className="text-sm font-medium text-red-600 dark:text-red-400">从所有设备删除</div>
          <div className="mt-0.5 text-xs text-neutral-400">移入废纸篓并同步删除到其他设备（本次会话内可撤销）</div>
        </button>
        <button
          className="w-full rounded-lg border border-neutral-300 p-3 text-left transition-colors hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-800"
          disabled={busy}
          onClick={() => void doDelete('local')}
        >
          <div className="text-sm font-medium">仅清理本地副本</div>
          <div className="mt-0.5 text-xs text-neutral-400">释放本机磁盘；记录与其他设备不受影响，需要时可重新下载</div>
        </button>
        <button className="btn-ghost w-full justify-center" disabled={busy} onClick={onClose}>
          取消
        </button>
      </div>
    </Modal>
  )
}

/** 批量设置分类弹窗 */
function BatchCategoryModal({ ids, onClose }: { ids: string[]; onClose: () => void }) {
  const categories = useLibraryStore((s) => s.categories)
  const images = useLibraryStore((s) => s.images)
  const assignCategoryMany = useLibraryStore((s) => s.assignCategoryMany)
  const toast = useUIStore((s) => s.toast)
  const pushUndo = useUIStore((s) => s.pushUndo)
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
                // 撤销快照：记录每张的旧分类
                const before = ids
                  .map((id) => images.find((i) => i.id === id))
                  .filter((i): i is ImageItem => Boolean(i))
                  .map((i) => ({ id: i.id, patch: { categoryId: i.categoryId } }))
                void assignCategoryMany(ids, cat.id).then(() => {
                  // 入撤销栈：Cmd/Ctrl+Z 可重放（与 toast「撤销」按钮共用同一 before 快照）
                  pushUndo(`移入「${cat.name}」（${ids.length} 张）`, async () => {
                    await window.api.applyEntries(before)
                  })
                  toast(`已将 ${ids.length} 张移入「${cat.name}」`, 'success', {
                    duration: 8000,
                    action: {
                      label: '撤销',
                      onClick: () => {
                        void window.api.applyEntries(before).then(() => {
                          toast('已撤销分类修改', 'info')
                          void useLibraryStore.getState().load()
                        })
                      }
                    }
                  })
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
              const before = ids
                .map((id) => images.find((i) => i.id === id))
                .filter((i): i is ImageItem => Boolean(i))
                .map((i) => ({ id: i.id, patch: { categoryId: i.categoryId } }))
              void assignCategoryMany(ids, null).then(() => {
                // 入撤销栈：Cmd/Ctrl+Z 可重放（与 toast「撤销」按钮共用同一 before 快照）
                pushUndo(`移出分类（${ids.length} 张）`, async () => {
                  await window.api.applyEntries(before)
                })
                toast(`已将 ${ids.length} 张移出分类`, 'info', {
                  duration: 8000,
                  action: {
                    label: '撤销',
                    onClick: () => {
                      void window.api.applyEntries(before).then(() => {
                        toast('已撤销分类修改', 'info')
                        void useLibraryStore.getState().load()
                      })
                    }
                  }
                })
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
  const allImages = useLibraryStore((s) => s.images)
  // useMemo + Map：仅在选中集/图片列表变化时计算一次，
  // 替代原选择器内 O(选中数 × 全部图片) 的 .find（语义不变：查不到记录同样视为云端）
  const cloudCount = useMemo(() => {
    const localFileById = new Map(allImages.map((img) => [img.id, img.localFile] as const))
    return selectedIds.filter((id) => !localFileById.get(id)).length
  }, [allImages, selectedIds])

  /** 批量下载选中图片的云端原图（支持取消） */
  const downloadSelected = async (): Promise<void> => {
    const ids = useUIStore.getState().selectedIds.filter((id) => !allImages.find((i) => i.id === id)?.localFile)
    if (ids.length === 0) return
    setBulkDownloading(true)
    let done = 0
    let failed = 0
    for (const id of ids) {
      try {
        await window.api.syncEnsureLocal(id)
        done++
      } catch {
        failed++
      }
    }
    setBulkDownloading(false)
    if (failed > 0) toast(`下载完成 ${done} 张，失败 ${failed} 张`, 'info')
    else toast(`已下载 ${done} 张到本地`)
    void useLibraryStore.getState().load()
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
      if (e.key === 'Escape' && selectionMode && !categoryPickerOpen && !tagPickerOpen && !deleteConfirmOpen) {
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

  // useCallback 稳定引用：配合 React.memo 的 ImageCard，滚动时不触发全部卡片重渲染
  const openMenu = useCallback((e: React.MouseEvent, image: ImageItem): void => {
    e.preventDefault()
    e.stopPropagation()
    setMenu({ x: e.clientX, y: e.clientY, image })
  }, [])

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
          if (paths.length) void importPaths(paths).then((r) => r.added > 0 && toast(`导入 ${r.added} 张图片`))
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

  // 窗口化计算：列数与卡片行高（与 CSS 断点保持一致）
  const GAP = 12
  const PAD = 16
  const cols = viewport.w >= 1536 ? 6 : viewport.w >= 1280 ? 5 : viewport.w >= 1024 ? 4 : viewport.w >= 640 ? 3 : 2
  const colW = (viewport.w - PAD * 2 - GAP * (cols - 1)) / cols
  const FOOTER = 34
  const rowH = (colW * 3) / 4 + FOOTER + 1 /* ring 边距 */
  const totalRows = Math.ceil(images.length / cols)
  const firstRow = Math.max(0, Math.floor((scrollTop - PAD) / (rowH + GAP)) - 2)
  const lastRow = Math.min(totalRows - 1, Math.ceil((scrollTop + viewport.h - PAD) / (rowH + GAP)) + 2)
  const shown = images.slice(firstRow * cols, (lastRow + 1) * cols)

  return (
    <div ref={scrollRef} className="h-full overflow-y-auto p-4 pb-24">
      {/* 上下 spacer 撑起总高度，保持滚动条与位置稳定 */}
      <div style={{ height: Math.max(0, firstRow) * (rowH + GAP) }} />
      {/* 列数由内联 gridTemplateColumns 按容器实测宽度计算（与上方 cols 断点一致），无需响应式类 */}
      <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
        {shown.map((image) => (
          <ImageCard key={image.id} image={image} onContextMenu={openMenu} />
        ))}
      </div>
      <div style={{ height: Math.max(0, totalRows - lastRow - 1) * (rowH + GAP) }} />

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
