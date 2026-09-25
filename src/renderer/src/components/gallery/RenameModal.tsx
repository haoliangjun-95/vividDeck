/** 右键菜单触发的重命名弹窗（A1 自 GalleryGrid 拆分） */
import { useState } from 'react'
import { useLibraryStore } from '../../store/library'
import { useUIStore } from '../../store/ui'
import { Modal } from '../ui'
import type { ImageItem } from '@shared/types'

export function RenameModal({ image, onClose }: { image: ImageItem; onClose: () => void }) {
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
