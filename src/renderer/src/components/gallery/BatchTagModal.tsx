/** 批量加标签弹窗（勾选已有标签 / 输入新标签，一次合并添加到全部选中）（A1 自 GalleryGrid 拆分） */
import { useState } from 'react'
import { useLibraryStore } from '../../store/library'
import { useUIStore } from '../../store/ui'
import { Modal } from '../ui'
import type { ImageItem } from '@shared/types'

export function BatchTagModal({ ids, onClose }: { ids: string[]; onClose: () => void }) {
  const images = useLibraryStore((s) => s.images)
  const allTags = useLibraryStore((s) => s.tags)
  const setTagsMany = useLibraryStore((s) => s.setTagsMany)
  const toast = useUIStore((s) => s.toast)
  const [picked, setPicked] = useState<string[]>([])
  const [newTags, setNewTags] = useState('')

  const apply = (): void => {
    const additions = Array.from(
      new Set([
        ...picked,
        ...newTags
          .split(/[,，\s]+/)
          .map((t) => t.trim())
          .filter(Boolean)
      ])
    )
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
                  onClick={() =>
                    setPicked(active ? picked.filter((t) => t !== tag) : [...picked, tag])
                  }
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
        <p className="text-xs text-neutral-400">
          批量添加为「并入」：选中图片已有的标签保留不覆盖。
        </p>
      </div>
    </Modal>
  )
}
