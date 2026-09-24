/** 删除确认弹窗：两个明确入口（所有设备删除 / 仅清理本地副本）+ 撤销提示（A1 自 GalleryGrid 拆分） */
import { useState } from 'react'
import { useLibraryStore } from '../../store/library'
import { useUIStore } from '../../store/ui'
import { Modal } from '../ui'

export function DeleteConfirmModal({ ids, onClose }: { ids: string[]; onClose: () => void }) {
  const toast = useUIStore((st) => st.toast)
  const clearSelection = useUIStore((st) => st.clearSelection)
  const [busy, setBusy] = useState(false)

  const doDelete = async (mode: 'all' | 'local'): Promise<void> => {
    setBusy(true)
    try {
      await window.api.deleteImages(ids, mode)
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
                    toast(
                      restored > 0 ? `已恢复 ${restored} 张` : '暂存区已清理，无法恢复',
                      restored > 0 ? 'success' : 'error'
                    )
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
          <div className="mt-0.5 text-xs text-neutral-400">
            移入废纸篓并同步删除到其他设备（本次会话内可撤销）
          </div>
        </button>
        <button
          className="w-full rounded-lg border border-neutral-300 p-3 text-left transition-colors hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-800"
          disabled={busy}
          onClick={() => void doDelete('local')}
        >
          <div className="text-sm font-medium">仅清理本地副本</div>
          <div className="mt-0.5 text-xs text-neutral-400">
            释放本机磁盘；记录与其他设备不受影响，需要时可重新下载
          </div>
        </button>
        <button className="btn-ghost w-full justify-center" disabled={busy} onClick={onClose}>
          取消
        </button>
      </div>
    </Modal>
  )
}
