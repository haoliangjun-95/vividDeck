/** 通用 UI：模态弹窗、侧滑抽屉、轻提示 */
import React, { useEffect } from 'react'
import { X } from 'lucide-react'
import { useUIStore } from '../store/ui'

// ---------- 模态弹窗 ----------
export function Modal({
  title,
  onClose,
  children,
  width = 'max-w-lg'
}: {
  title: string
  onClose: () => void
  children: React.ReactNode
  width?: string
}) {
  // Esc 关闭
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-6" onMouseDown={onClose}>
      <div
        className={`card w-full ${width} max-h-[88vh] overflow-hidden flex flex-col`}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-neutral-200 px-5 py-3 dark:border-neutral-800">
          <h2 className="text-base font-semibold">{title}</h2>
          <button className="btn-ghost !p-1.5" onClick={onClose} aria-label="关闭">
            <X size={16} />
          </button>
        </div>
        <div className="overflow-y-auto px-5 py-4">{children}</div>
      </div>
    </div>
  )
}

// ---------- 侧滑抽屉 ----------
export function Drawer({
  title,
  onClose,
  children
}: {
  title: string
  onClose: () => void
  children: React.ReactNode
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/40" onMouseDown={onClose}>
      <aside
        className="flex h-full w-[400px] max-w-[90vw] flex-col bg-white shadow-2xl dark:bg-[#18181f]"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-neutral-200 px-4 py-3 dark:border-neutral-800">
          <h2 className="text-base font-semibold">{title}</h2>
          <button className="btn-ghost !p-1.5" onClick={onClose} aria-label="关闭">
            <X size={16} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-4">{children}</div>
      </aside>
    </div>
  )
}

// ---------- 轻提示堆栈 ----------
export function ToastHost(): JSX.Element {
  const toasts = useUIStore((s) => s.toasts)
  const dismiss = useUIStore((s) => s.dismissToast)
  return (
    <div className="pointer-events-none fixed bottom-6 left-1/2 z-[60] flex -translate-x-1/2 flex-col items-center gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`pointer-events-auto flex items-center gap-2 rounded-full px-4 py-2 text-sm text-white shadow-lg ${
            t.type === 'error' ? 'bg-red-600' : t.type === 'info' ? 'bg-neutral-700' : 'bg-emerald-600'
          }`}
        >
          <span>{t.message}</span>
          {t.action && (
            <button
              className="rounded-full bg-white/20 px-2.5 py-0.5 text-xs font-medium hover:bg-white/30"
              onClick={() => {
                t.action?.onClick()
                dismiss(t.id)
              }}
            >
              {t.action.label}
            </button>
          )}
        </div>
      ))}
    </div>
  )
}
