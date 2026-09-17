/**
 * 灯箱：大图预览（滚轮缩放、拖拽平移、左右切换）、信息面板、快捷操作
 */
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Crop, Heart, Info, Monitor, Pencil, Trash2, X, ZoomIn, ZoomOut } from 'lucide-react'
import { selectFilteredImages, useLibraryStore } from '../store/library'
import { useUIStore } from '../store/ui'
import { formatBytes, formatLabel, formatResolution, formatTime, mediaUrl } from '../lib/utils'

/** 灯箱主体 */
function Viewer({ imageId, onNav }: { imageId: string; onNav: (delta: number) => void }) {
  const [scale, setScale] = useState(1)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const [loading, setLoading] = useState(true)
  /** 预览图加载失败（如超大片生成异常）时回退原图 */
  const [fallbackOriginal, setFallbackOriginal] = useState(false)
  const dragRef = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null)

  useEffect(() => {
    setScale(1)
    setOffset({ x: 0, y: 0 })
    setLoading(true)
    setFallbackOriginal(false)
  }, [imageId])

  const onWheel = (e: React.WheelEvent): void => {
    e.preventDefault()
    setScale((s) => Math.min(6, Math.max(0.2, s * (e.deltaY < 0 ? 1.12 : 0.89))))
  }

  return (
    <div
      className="relative flex-1 overflow-hidden"
      onWheel={onWheel}
      onMouseDown={(e) => {
        dragRef.current = { x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y }
      }}
      onMouseMove={(e) => {
        if (!dragRef.current) return
        setOffset({
          x: dragRef.current.ox + (e.clientX - dragRef.current.x),
          y: dragRef.current.oy + (e.clientY - dragRef.current.y)
        })
      }}
      onMouseUp={() => (dragRef.current = null)}
      onMouseLeave={() => (dragRef.current = null)}
      onDoubleClick={() => setScale((s) => (s > 1.05 ? 1 : 2))}
    >
      {/* 首次点击大图需现场生成预览（超大图约 1~2 秒），期间显示加载提示 */}
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="flex flex-col items-center gap-2 text-white/60">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-white/30 border-t-white/80" />
            <span className="text-xs">加载预览…</span>
          </div>
        </div>
      )}
      <img
        key={imageId}
        src={fallbackOriginal ? `media://original/${imageId}` : `media://preview/${imageId}`}
        alt="预览"
        draggable={false}
        onLoad={() => setLoading(false)}
        onError={() => {
          // 预览不可用：先尝试原图兜底；原图也失败则提示
          if (!fallbackOriginal) {
            setFallbackOriginal(true)
            setLoading(true)
          } else {
            setLoading(false)
          }
        }}
        className={`absolute left-1/2 top-1/2 max-h-[85%] max-w-[85%] select-none rounded-lg shadow-2xl transition-opacity ${
          loading ? 'opacity-0' : 'opacity-100'
        }`}
        style={{
          transform: `translate(-50%, -50%) translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
          cursor: scale > 1.05 ? 'grab' : 'default',
          transition: dragRef.current ? 'none' : 'transform 0.15s ease-out'
        }}
      />
      {loading && fallbackOriginal && (
        <div className="absolute inset-x-0 bottom-14 text-center text-xs text-amber-300/90">
          预览生成失败，正在尝试加载原图…
        </div>
      )}

      {/* 左右切换 */}
      <button className="btn absolute left-3 top-1/2 -translate-y-1/2 !rounded-full !bg-black/40 !p-2.5 !text-white hover:!bg-black/60" onClick={() => onNav(-1)} aria-label="上一张">
        <ChevronLeft size={20} />
      </button>
      <button className="btn absolute right-3 top-1/2 -translate-y-1/2 !rounded-full !bg-black/40 !p-2.5 !text-white hover:!bg-black/60" onClick={() => onNav(1)} aria-label="下一张">
        <ChevronRight size={20} />
      </button>

      {/* 缩放指示 */}
      <div className="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-full bg-black/50 px-3 py-1 text-xs text-white">
        <button onClick={() => setScale((s) => Math.max(0.2, s / 1.25))} aria-label="缩小">
          <ZoomOut size={14} />
        </button>
        <span className="tabular-nums">{Math.round(scale * 100)}%</span>
        <button onClick={() => setScale((s) => Math.min(6, s * 1.25))} aria-label="放大">
          <ZoomIn size={14} />
        </button>
        <button
          onClick={() => {
            setScale(1)
            setOffset({ x: 0, y: 0 })
          }}
        >
          重置
        </button>
      </div>
    </div>
  )
}

/** 信息面板：图片详情 + 标签编辑 */
function InfoPanel({ imageId }: { imageId: string }) {
  const images = useLibraryStore((s) => s.images)
  const categories = useLibraryStore((s) => s.categories)
  const tags = useLibraryStore((s) => s.tags)
  const setTags = useLibraryStore((s) => s.setTags)
  const image = images.find((img) => img.id === imageId)
  const [input, setInput] = useState('')

  if (!image) return <div />

  const addTag = (): void => {
    const name = input.trim()
    if (!name || image.tags.includes(name)) return
    void setTags(imageId, [...image.tags, name])
    setInput('')
  }

  return (
    <aside className="flex w-72 shrink-0 flex-col gap-4 overflow-y-auto border-l border-neutral-200 bg-neutral-50 p-4 dark:border-neutral-800 dark:bg-[#15151c]">
      <div>
        <div className="break-all text-sm font-medium">{image.fileName}</div>
        <div className="mt-0.5 text-xs text-neutral-400">入库于 {formatTime(image.addedAt)}</div>
      </div>

      <dl className="space-y-1.5 text-xs">
        {[
          ['分辨率', formatResolution(image)],
          ['文件大小', formatBytes(image.sizeBytes)],
          ['格式', formatLabel(image.format)],
          ['分类', image.categoryId ? (categories.find((c) => c.id === image.categoryId)?.name ?? '—') : '未分类'],
          ['原始路径', image.sourcePath]
        ].map(([k, v]) => (
          <div key={k} className="flex gap-2">
            <dt className="w-14 shrink-0 text-neutral-400">{k}</dt>
            <dd className="break-all" title={v}>
              {v}
            </dd>
          </div>
        ))}
      </dl>

      <div>
        <div className="mb-1.5 text-xs font-semibold text-neutral-400">标签</div>
        <div className="flex flex-wrap gap-1.5">
          {image.tags.map((tag) => (
            <button
              key={tag}
              className="rounded-full bg-indigo-100 px-2 py-0.5 text-xs text-indigo-700 hover:line-through dark:bg-indigo-950 dark:text-indigo-300"
              title="点击移除"
              onClick={() => void setTags(imageId, image.tags.filter((t) => t !== tag))}
            >
              {tag}
            </button>
          ))}
        </div>
        <div className="mt-2 flex gap-1.5">
          <input
            className="field flex-1 text-xs"
            placeholder="添加标签后回车"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addTag()}
          />
          <button className="btn-ghost !px-2 text-xs" onClick={addTag}>
            添加
          </button>
        </div>
        {tags.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {tags
              .filter((t) => !image.tags.includes(t))
              .slice(0, 8)
              .map((t) => (
                <button
                  key={t}
                  className="rounded-full border border-dashed border-neutral-300 px-1.5 py-0.5 text-[11px] text-neutral-400 hover:border-indigo-400 hover:text-indigo-500 dark:border-neutral-700"
                  onClick={() => void setTags(imageId, [...image.tags, t])}
                >
                  + {t}
                </button>
              ))}
          </div>
        )}
      </div>
    </aside>
  )
}

/** 灯箱外壳（含顶部操作条） */
export function Lightbox(): JSX.Element | null {
  const imageId = useUIStore((s) => s.lightboxImageId)
  const close = useUIStore((s) => s.closeLightbox)
  const openWallpaperDialog = useUIStore((s) => s.openWallpaperDialog)
  const openCrop = useUIStore((s) => s.openCrop)
  const toggleFavorite = useLibraryStore((s) => s.toggleFavorite)
  const rename = useLibraryStore((s) => s.rename)
  const remove = useLibraryStore((s) => s.remove)
  const images = useLibraryStore(selectFilteredImages)
  const allImages = useLibraryStore((s) => s.images)
  const toast = useUIStore((s) => s.toast)
  const [showInfo, setShowInfo] = useState(true)
  const [renaming, setRenaming] = useState(false)
  const [nameDraft, setNameDraft] = useState('')

  const image = (allImages.find((img) => img.id === imageId) ?? null)

  const nav = useCallback(
    (delta: number) => {
      if (!imageId) return
      const list = images.length > 0 ? images : allImages
      const idx = list.findIndex((img) => img.id === imageId)
      if (idx === -1) return
      const next = list[(idx + delta + list.length) % list.length]
      useUIStore.getState().openLightbox(next.id)
    },
    [imageId, images, allImages]
  )

  // 键盘快捷键：← → 切换，Esc 关闭
  useEffect(() => {
    if (!imageId) return
    const onKey = (e: KeyboardEvent): void => {
      if (renaming) return
      if (e.key === 'ArrowLeft') nav(-1)
      else if (e.key === 'ArrowRight') nav(1)
      else if (e.key === 'Escape') close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [imageId, nav, close, renaming])

  if (!imageId || !image) return null

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black/90">
      {/* 顶部操作条 */}
      <div className="flex items-center gap-1 px-3 py-2 text-white">
        <span className="mr-2 max-w-[40%] truncate text-sm text-white/70">{image.fileName}</span>
        <button
          className={`btn !p-2 ${image.favorite ? '!text-amber-400' : '!text-white/80'}`}
          title="收藏"
          onClick={() => void toggleFavorite(image.id)}
        >
          <Heart size={17} fill={image.favorite ? 'currentColor' : 'none'} />
        </button>
        <button className="btn !p-2 !text-white/80 hover:!bg-white/15" title="设为壁纸" onClick={() => openWallpaperDialog(image.id)}>
          <Monitor size={17} />
        </button>
        <button className="btn !p-2 !text-white/80 hover:!bg-white/15" title="裁剪" onClick={() => openCrop(image.id)}>
          <Crop size={17} />
        </button>
        <button
          className="btn !p-2 !text-white/80 hover:!bg-white/15"
          title="重命名"
          onClick={() => {
            setRenaming(true)
            setNameDraft(image.fileName)
          }}
        >
          <Pencil size={17} />
        </button>
        <button
          className="btn !p-2 !text-white/80 hover:!bg-red-500/60"
          title="删除（移入废纸篓）"
          onClick={() => {
            if (confirm(`确定删除「${image.fileName}」吗？（复制入库的文件将移入系统废纸篓）`)) {
              void remove(image.id)
              close()
              toast('已删除')
            }
          }}
        >
          <Trash2 size={17} />
        </button>

        <div className="ml-auto flex items-center gap-2">
          <button
            className="btn bg-indigo-600 !px-3.5 !py-1.5 text-sm font-semibold text-white shadow hover:bg-indigo-500"
            title="将当前图片设为桌面壁纸"
            onClick={() => openWallpaperDialog(image.id)}
          >
            <Monitor size={16} />
            设为壁纸
          </button>
          <button
            className={`btn !p-2 ${showInfo ? '!bg-white/20 !text-white' : '!text-white/80'}`}
            title="信息面板"
            onClick={() => setShowInfo((v) => !v)}
          >
            <Info size={17} />
          </button>
          <button className="btn !p-2 !text-white/80 hover:!bg-white/15" title="关闭" onClick={close}>
            <X size={18} />
          </button>
        </div>
      </div>

      {/* 重命名行内输入 */}
      {renaming && (
        <div className="flex items-center gap-2 bg-black/60 px-3 py-2">
          <input
            className="field flex-1"
            value={nameDraft}
            autoFocus
            onChange={(e) => setNameDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                void rename(image.id, nameDraft)
                setRenaming(false)
              } else if (e.key === 'Escape') setRenaming(false)
            }}
          />
          <button
            className="btn-primary"
            onClick={() => {
              void rename(image.id, nameDraft)
              setRenaming(false)
            }}
          >
            保存
          </button>
          <button className="btn-ghost !text-white/70" onClick={() => setRenaming(false)}>
            取消
          </button>
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        <Viewer imageId={image.id} onNav={nav} />
        {showInfo && <InfoPanel imageId={image.id} />}
      </div>
    </div>
  )
}
