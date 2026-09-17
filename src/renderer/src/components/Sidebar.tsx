/**
 * 侧边栏：视图切换（全部/收藏）、分类列表（拖拽归类目标 + 管理）、标签云、功能入口
 */
import React from 'react'
import { FolderOpen, Heart, History, Images, Layers, Monitor, Settings, Tag, Pencil } from 'lucide-react'
import { useLibraryStore } from '../store/library'
import { useUIStore } from '../store/ui'

function NavItem({
  active,
  icon,
  label,
  count,
  onClick,
  onDrop,
  dropLabel
}: {
  active: boolean
  icon: React.ReactNode
  label: string
  count?: number
  onClick: () => void
  /** 作为拖拽归类目标 */
  onDrop?: (imageId: string) => void
  dropLabel?: string
}) {
  const [dragOver, setDragOver] = React.useState(false)
  return (
    <button
      className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm transition-colors ${
        dragOver
          ? 'bg-indigo-100 text-indigo-700 ring-1 ring-indigo-400 dark:bg-indigo-950 dark:text-indigo-300'
          : active
            ? 'bg-neutral-200/80 font-medium dark:bg-neutral-700/70'
            : 'text-neutral-600 hover:bg-neutral-200/50 dark:text-neutral-300 dark:hover:bg-neutral-700/40'
      }`}
      onClick={onClick}
      onDragOver={(e) => {
        if (!onDrop) return
        e.preventDefault()
        setDragOver(true)
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        setDragOver(false)
        if (!onDrop) return
        e.preventDefault()
        const imageId = e.dataTransfer.getData('application/x-vd-image')
        if (imageId) onDrop(imageId)
      }}
      title={dragOver ? dropLabel : undefined}
    >
      <span className="shrink-0 opacity-70">{icon}</span>
      <span className="flex-1 truncate">{dragOver && dropLabel ? dropLabel : label}</span>
      {count !== undefined && <span className="text-xs tabular-nums opacity-50">{count}</span>}
    </button>
  )
}

export function Sidebar(): JSX.Element {
  const images = useLibraryStore((s) => s.images)
  const categories = useLibraryStore((s) => s.categories)
  const tags = useLibraryStore((s) => s.tags)
  const filter = useLibraryStore((s) => s.filter)
  const setFilter = useLibraryStore((s) => s.setFilter)
  const assignCategory = useLibraryStore((s) => s.assignCategory)
  const drawer = useUIStore((s) => s.drawer)
  const openDrawer = useUIStore((s) => s.openDrawer)
  const setCategoryManagerOpen = useUIStore((s) => s.setCategoryManagerOpen)

  const countOf = (categoryId: string | null | 'favorites' | 'all' | 'uncategorized'): number =>
    images.filter((img) => {
      if (categoryId === 'all') return true
      if (categoryId === 'favorites') return img.favorite
      if (categoryId === 'uncategorized') return img.categoryId === null
      return img.categoryId === categoryId
    }).length

  return (
    <nav className="flex h-full w-60 shrink-0 flex-col border-r border-neutral-200 bg-neutral-50/80 dark:border-neutral-800 dark:bg-[#15151c]">
      <div className="flex items-center gap-2 px-4 py-4">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 to-fuchsia-500 text-white shadow">
          <Layers size={18} />
        </div>
        <div>
          <div className="text-sm font-bold leading-tight">vividDeck</div>
          <div className="text-[11px] leading-tight text-neutral-400">壁纸管理</div>
        </div>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto px-2.5 pb-2">
        {/* 视图 */}
        <section>
          <NavItem
            active={filter.categoryId === 'all' && !filter.tag}
            icon={<Images size={16} />}
            label="全部图片"
            count={countOf('all')}
            onClick={() => setFilter({ categoryId: 'all', tag: null })}
          />
          <NavItem
            active={filter.categoryId === 'favorites'}
            icon={<Heart size={16} />}
            label="收藏"
            count={countOf('favorites')}
            onClick={() => setFilter({ categoryId: 'favorites', tag: null })}
          />
        </section>

        {/* 分类（拖拽图片到分类即可归类） */}
        <section>
          <div className="mb-1 flex items-center justify-between px-2.5">
            <span className="text-xs font-semibold uppercase tracking-wider text-neutral-400">分类</span>
            <button
              className="btn-ghost !p-1"
              title="管理分类"
              onClick={() => setCategoryManagerOpen(true)}
            >
              <Pencil size={12} />
            </button>
          </div>
          {categories.map((cat) => (
            <NavItem
              key={cat.id}
              active={filter.categoryId === cat.id && !filter.tag}
              icon={<FolderOpen size={16} />}
              label={cat.name}
              count={countOf(cat.id)}
              onClick={() => setFilter({ categoryId: cat.id, tag: null })}
              onDrop={(imageId) => void assignCategory(imageId, cat.id)}
              dropLabel={`移入「${cat.name}」`}
            />
          ))}
          <NavItem
            active={filter.categoryId === 'uncategorized'}
            icon={<FolderOpen size={16} />}
            label="未分类"
            count={countOf('uncategorized')}
            onClick={() => setFilter({ categoryId: 'uncategorized', tag: null })}
            onDrop={(imageId) => void assignCategory(imageId, null)}
            dropLabel="移出分类"
          />
        </section>

        {/* 标签 */}
        {tags.length > 0 && (
          <section>
            <div className="mb-1.5 px-2.5 text-xs font-semibold uppercase tracking-wider text-neutral-400">
              标签
            </div>
            <div className="flex flex-wrap gap-1.5 px-2">
              {tags.map((tag) => (
                <button
                  key={tag}
                  className={`rounded-full px-2 py-0.5 text-xs transition-colors ${
                    filter.tag === tag
                      ? 'bg-indigo-600 text-white'
                      : 'bg-neutral-200/80 text-neutral-600 hover:bg-neutral-300/80 dark:bg-neutral-700/60 dark:text-neutral-300'
                  }`}
                  onClick={() => setFilter({ tag: filter.tag === tag ? null : tag })}
                >
                  <Tag size={10} className="mr-0.5 inline align-baseline" />
                  {tag}
                </button>
              ))}
            </div>
          </section>
        )}
      </div>

      {/* 功能入口 */}
      <div className="space-y-0.5 border-t border-neutral-200 p-2.5 dark:border-neutral-800">
        <NavItem
          active={drawer === 'slideshow'}
          icon={<Monitor size={16} />}
          label="轮播计划"
          onClick={() => openDrawer('slideshow')}
        />
        <NavItem
          active={drawer === 'history'}
          icon={<History size={16} />}
          label="壁纸历史"
          onClick={() => openDrawer('history')}
        />
        <NavItem
          active={drawer === 'settings'}
          icon={<Settings size={16} />}
          label="设置"
          onClick={() => openDrawer('settings')}
        />
      </div>
    </nav>
  )
}
