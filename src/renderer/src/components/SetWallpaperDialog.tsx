/**
 * 设壁纸对话框：选择目标显示器（支持多选/单屏独立）+ 填充模式
 */
import React, { useEffect, useState } from 'react'
import { Monitor, MonitorSmartphone } from 'lucide-react'
import { Modal } from './ui'
import { useUIStore } from '../store/ui'
import { useLibraryStore } from '../store/library'
import { FILL_MODE_LABELS, type FillMode, type MonitorInfo } from '@shared/types'

/** 填充模式示意图（纯 CSS 绘制的缩略示意） */
function FillModeDiagram({ mode, active }: { mode: FillMode; active: boolean }): JSX.Element {
  const box = 'absolute bg-indigo-500 transition-all'
  return (
    <div
      className={`relative h-10 w-16 overflow-hidden rounded border-2 ${
        active ? 'border-indigo-500 bg-indigo-500/10' : 'border-neutral-300 dark:border-neutral-600'
      }`}
    >
      {mode === 'fill' && <div className={`${box} inset-0`} />}
      {mode === 'stretch' && (
        <div className={`${box} inset-0 [clip-path:polygon(10%_25%,90%_10%,90%_80%,10%_70%)]`} />
      )}
      {mode === 'center' && (
        <div className={`${box} left-1/2 top-1/2 h-4 w-8 -translate-x-1/2 -translate-y-1/2`} />
      )}
      {mode === 'fit' && <div className={`${box} inset-x-1 top-1/2 h-5 -translate-y-1/2`} />}
    </div>
  )
}

const MODE_HINTS: Record<FillMode, string> = {
  fill: '等比缩放覆盖全屏，多余部分裁掉',
  stretch: '拉伸至屏幕尺寸（可能变形）',
  center: '原尺寸居中显示',
  fit: '完整显示整张图，不足处留黑边'
}

export function SetWallpaperDialog(): JSX.Element | null {
  const imageId = useUIStore((s) => s.wallpaperImageId)
  const close = useUIStore((s) => s.closeWallpaperDialog)
  const toast = useUIStore((s) => s.toast)
  const image = useLibraryStore((s) => s.images.find((img) => img.id === imageId))
  const [monitors, setMonitors] = useState<MonitorInfo[]>([])
  const [selected, setSelected] = useState<string[]>([])
  const [fillMode, setFillMode] = useState<FillMode>('fill')
  /** 是否将本次选择的填充模式保存为默认（设置页同步可见） */
  const [rememberDefault, setRememberDefault] = useState(true)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!imageId) return
    // 初始填充模式 = 设置中的默认填充模式
    void window.api
      .getState()
      .then((state) => setFillMode(state.settings.defaultFillMode))
      .catch(() => undefined)
    void window.api
      .listMonitors()
      .then((list) => {
        setMonitors(list)
        setSelected(list.map((m) => m.id)) // 默认全部显示器
      })
      .catch((err) => toast(`获取显示器信息失败：${err.message}`, 'error'))
  }, [imageId, toast])

  if (!imageId || !image) return null

  const apply = async (): Promise<void> => {
    setBusy(true)
    try {
      const result = await window.api.applyWallpaper(image.id, selected, fillMode)
      if (rememberDefault) await window.api.setDefaultFillMode(fillMode).catch(() => undefined)
      toast(`已设置 ${result.applied.length} 台显示器的壁纸`)
      close()
    } catch (err) {
      toast(`设置失败：${err instanceof Error ? err.message : String(err)}`, 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title="设为桌面壁纸" onClose={close} width="max-w-xl">
      <div className="space-y-5">
        {/* 预览 */}
        <div className="flex items-center gap-4">
          <img
            src={`media://thumb/${image.id}`}
            alt=""
            className="h-20 w-28 rounded-lg object-cover shadow"
          />
          <div className="min-w-0">
            <div className="truncate text-sm font-medium">{image.fileName}</div>
            <div className="text-xs text-neutral-400">
              {image.width} × {image.height}
            </div>
          </div>
        </div>

        {/* 显示器选择 */}
        <section>
          <div className="mb-2 text-sm font-medium">目标显示器（可为每台显示器单独设置）</div>
          {monitors.length === 0 && <div className="text-xs text-neutral-400">正在识别显示器…</div>}
          <div className="grid grid-cols-2 gap-2">
            {monitors.map((m) => {
              const active = selected.includes(m.id)
              return (
                <button
                  key={m.id}
                  className={`flex items-center gap-2.5 rounded-lg border p-2.5 text-left transition-colors ${
                    active
                      ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-950/50'
                      : 'border-neutral-300 hover:border-neutral-400 dark:border-neutral-700'
                  }`}
                  onClick={() =>
                    setSelected((prev) =>
                      prev.includes(m.id) ? prev.filter((id) => id !== m.id) : [...prev, m.id]
                    )
                  }
                >
                  {m.scaleFactor > 1.5 ? <MonitorSmartphone size={18} /> : <Monitor size={18} />}
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm">{m.label}</div>
                    <div className="text-xs text-neutral-400">
                      {m.width} × {m.height}
                      {m.isMain ? ' · 主屏' : ''}
                    </div>
                  </div>
                  <span
                    className={`h-4 w-4 shrink-0 rounded-full border-2 ${
                      active
                        ? 'border-indigo-500 bg-indigo-500'
                        : 'border-neutral-300 dark:border-neutral-600'
                    }`}
                  />
                </button>
              )
            })}
          </div>
        </section>

        {/* 填充模式 */}
        <section>
          <div className="mb-2 text-sm font-medium">填充模式</div>
          <div className="grid grid-cols-4 gap-2">
            {(Object.keys(FILL_MODE_LABELS) as FillMode[]).map((mode) => (
              <button
                key={mode}
                className={`flex flex-col items-center gap-1.5 rounded-lg border p-2 transition-colors ${
                  fillMode === mode
                    ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-950/50'
                    : 'border-neutral-300 hover:border-neutral-400 dark:border-neutral-700'
                }`}
                onClick={() => setFillMode(mode)}
              >
                <FillModeDiagram mode={mode} active={fillMode === mode} />
                <span className="text-xs font-medium">{FILL_MODE_LABELS[mode]}</span>
              </button>
            ))}
          </div>
          <p className="mt-2 text-xs text-neutral-400">
            {MODE_HINTS[fillMode]}（自动适配所选显示器的物理分辨率）
          </p>
          <label className="mt-2 flex cursor-pointer select-none items-center gap-2 text-xs text-neutral-500 dark:text-neutral-400">
            <input
              type="checkbox"
              className="h-3.5 w-3.5 accent-indigo-600"
              checked={rememberDefault}
              onChange={(e) => setRememberDefault(e.target.checked)}
            />
            将此模式保存为默认填充模式（下次自动选用，可在设置中修改）
          </label>
        </section>

        <div className="flex justify-end gap-2 border-t border-neutral-200 pt-3 dark:border-neutral-800">
          <button className="btn-ghost" onClick={close}>
            取消
          </button>
          <button
            className="btn-primary"
            disabled={busy || selected.length === 0}
            onClick={() => void apply()}
          >
            {busy ? '设置中…' : '设为壁纸'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
