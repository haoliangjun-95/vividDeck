/**
 * 分类管理弹窗：新增 / 重命名 / 删除分类（删除不删图片，仅回到未分类）
 */
import React, { useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { Modal } from './ui'
import { useLibraryStore } from '../store/library'
import { useUIStore } from '../store/ui'

export function CategoryManager(): JSX.Element | null {
  const open = useUIStore((s) => s.categoryManagerOpen)
  const setOpen = useUIStore((s) => s.setCategoryManagerOpen)
  const toast = useUIStore((s) => s.toast)
  const categories = useLibraryStore((s) => s.categories)
  const images = useLibraryStore((s) => s.images)
  const addCategory = useLibraryStore((s) => s.addCategory)
  const renameCategory = useLibraryStore((s) => s.renameCategory)
  const deleteCategory = useLibraryStore((s) => s.deleteCategory)
  const filter = useLibraryStore((s) => s.filter)
  const setFilter = useLibraryStore((s) => s.setFilter)
  const [name, setName] = useState('')
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null)

  if (!open) return null

  const countOf = (id: string): number => images.filter((img) => img.categoryId === id).length

  return (
    <Modal title="管理分类" onClose={() => setOpen(false)}>
      <div className="space-y-4">
        {/* 新增 */}
        <div className="flex gap-2">
          <input
            className="field flex-1"
            placeholder="新分类名称，如「城市夜景」"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && name.trim()) {
                void addCategory(name.trim())
                setName('')
              }
            }}
          />
          <button
            className="btn-primary"
            disabled={!name.trim()}
            onClick={() => {
              void addCategory(name.trim())
              setName('')
            }}
          >
            <Plus size={15} />
            新增
          </button>
        </div>

        {/* 列表 */}
        <div className="space-y-2">
          {categories.map((cat) => (
            <div key={cat.id} className="card flex items-center gap-2 px-3 py-2">
              {editing?.id === cat.id ? (
                <>
                  <input
                    className="field flex-1"
                    value={editing.name}
                    autoFocus
                    onChange={(e) => setEditing({ id: cat.id, name: e.target.value })}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        void renameCategory(cat.id, editing.name)
                        setEditing(null)
                      } else if (e.key === 'Escape') setEditing(null)
                    }}
                  />
                  <button
                    className="btn-primary !px-2.5 !py-1 text-xs"
                    onClick={() => {
                      void renameCategory(cat.id, editing.name)
                      setEditing(null)
                    }}
                  >
                    保存
                  </button>
                </>
              ) : (
                <>
                  <button
                    className="min-w-0 flex-1 truncate text-left text-sm hover:text-indigo-600 dark:hover:text-indigo-400"
                    title="点击重命名"
                    onClick={() => setEditing({ id: cat.id, name: cat.name })}
                  >
                    {cat.name}
                  </button>
                  <span className="text-xs tabular-nums text-neutral-400">{countOf(cat.id)} 张</span>
                  <button
                    className="btn-danger !p-1.5"
                    title="删除分类（图片不会被删除）"
                    onClick={() => {
                      if (confirm(`删除分类「${cat.name}」？该分类下的图片将回到「未分类」。`)) {
                        void deleteCategory(cat.id)
                        if (filter.categoryId === cat.id) setFilter({ categoryId: 'all' })
                        toast('分类已删除', 'info')
                      }
                    }}
                  >
                    <Trash2 size={14} />
                  </button>
                </>
              )}
            </div>
          ))}
        </div>

        <p className="text-xs leading-relaxed text-neutral-400">
          小技巧：在画廊中按住图片卡片，直接拖到左侧栏的任意分类上即可完成归类。
        </p>
      </div>
    </Modal>
  )
}
