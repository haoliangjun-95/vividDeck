/**
 * 卡片信息栏：分类徽章 + 标签 chips（A1 自 GalleryGrid 拆分；
 * memo：父卡片重渲染时按 image 引用跳过）
 */
import React from 'react'
import { FolderOpen } from 'lucide-react'
import { useLibraryStore } from '../../store/library'
import type { ImageItem } from '@shared/types'

export const CardInfoFooter = React.memo(function CardInfoFooter({ image }: { image: ImageItem }) {
  const category = useLibraryStore((s) => s.categories.find((c) => c.id === image.categoryId))
  const visibleTags = image.tags.slice(0, 2)
  const moreTags = image.tags.length - visibleTags.length

  return (
    // 严格单行：virtualGrid 的 CARD_FOOTER=34px 行高假设依赖此约束，
    // 多余 chip 裁剪显示而非折行——折行会导致行高漂移、滚动位置随深度累积偏移
    <div className="flex min-h-[34px] flex-nowrap items-center gap-1 overflow-hidden px-2 py-1.5">
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
