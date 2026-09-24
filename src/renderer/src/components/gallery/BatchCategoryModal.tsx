/** 批量设置分类弹窗（A1 自 GalleryGrid 拆分） */
import { FolderOpen, X } from 'lucide-react'
import { useLibraryStore } from '../../store/library'
import { useUIStore } from '../../store/ui'
import { Modal } from '../ui'
import type { ImageItem } from '@shared/types'

export function BatchCategoryModal({ ids, onClose }: { ids: string[]; onClose: () => void }) {
  const categories = useLibraryStore((s) => s.categories)
  const images = useLibraryStore((s) => s.images)
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
                // 撤销快照：记录每张的旧分类
                const before = ids
                  .map((id) => images.find((i) => i.id === id))
                  .filter((i): i is ImageItem => Boolean(i))
                  .map((i) => ({ id: i.id, patch: { categoryId: i.categoryId } }))
                void assignCategoryMany(ids, cat.id).then(() => {
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
        <p className="text-xs text-neutral-400">
          批量修改会同步刷新修改时间，经 MinIO 同步自动传播到其他设备。
        </p>
      </div>
    </Modal>
  )
}
