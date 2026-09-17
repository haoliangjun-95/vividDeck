/**
 * 设置面板：外观主题、默认填充模式、导入模式、存储位置（可整体迁移）、同步占位
 */
import React, { useEffect, useState } from 'react'
import { FolderOpen, HardDrive, Loader2 } from 'lucide-react'
import { useUIStore } from '../store/ui'
import { formatBytes } from '../lib/utils'
import { FILL_MODE_LABELS, type AppSettings, type FillMode } from '@shared/types'
import { SyncSection } from './SyncSection'

const FILL_HINTS: Record<FillMode, string> = {
  fill: '覆盖全屏，裁掉多余',
  stretch: '拉伸铺满，可能变形',
  center: '原尺寸居中',
  fit: '完整显示，黑边补齐'
}

export function SettingsPanel(): JSX.Element {
  const toast = useUIStore((s) => s.toast)
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [version, setVersion] = useState('')
  const [storage, setStorage] = useState<{ root: string; custom: boolean; sizeBytes: number } | null>(null)
  const [migrating, setMigrating] = useState(false)

  const reloadStorage = (): void => {
    void window.api.getStorageInfo().then(setStorage).catch(() => undefined)
  }

  useEffect(() => {
    void window.api.getState().then((s) => {
      setSettings(s.settings)
      setVersion(s.version)
    })
    reloadStorage()
  }, [])

  if (!settings) return <div className="text-sm text-neutral-400">加载中…</div>

  const update = async (patch: Partial<AppSettings>): Promise<void> => {
    if (patch.theme !== undefined) setSettings(await window.api.setTheme(patch.theme))
    if (patch.importMode !== undefined) setSettings(await window.api.setImportMode(patch.importMode))
    if (patch.defaultFillMode !== undefined) {
      setSettings(await window.api.setDefaultFillMode(patch.defaultFillMode))
    }
  }

  /** 更换存储目录：确认 → 主进程弹目录框并整体迁移 → 自动重启 */
  const changeStorage = async (): Promise<void> => {
    if (!storage) return
    const sizeText = formatBytes(storage.sizeBytes)
    if (!confirm(`将把全部素材与数据（约 ${sizeText}）复制到新位置并自动重启应用。\n大素材库迁移可能耗时数分钟，期间请勿关机。继续？`)) return
    setMigrating(true)
    try {
      const result = await window.api.changeStorageDir()
      if (result.canceled) {
        setMigrating(false)
        return
      }
      // 主进程 1.5s 后自动重启；此处仅展示提示
      toast('迁移完成，应用即将自动重启…')
    } catch (err) {
      setMigrating(false)
      toast(`迁移失败：${err instanceof Error ? err.message : String(err)}`, 'error')
    }
  }

  return (
    <div className="space-y-6 text-sm">
      {/* 外观 */}
      <section className="space-y-2">
        <div className="font-medium">外观</div>
        <div className="flex gap-2">
          {(
            [
              { value: 'system', label: '跟随系统' },
              { value: 'light', label: '亮色' },
              { value: 'dark', label: '暗色' }
            ] as { value: AppSettings['theme']; label: string }[]
          ).map((o) => (
            <button
              key={o.value}
              className={`flex-1 rounded-lg border px-2 py-2 transition-colors ${
                settings.theme === o.value
                  ? 'border-indigo-500 bg-indigo-50 font-medium text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300'
                  : 'border-neutral-300 dark:border-neutral-700'
              }`}
              onClick={() => void update({ theme: o.value })}
            >
              {o.label}
            </button>
          ))}
        </div>
      </section>

      {/* 默认填充模式 */}
      <section className="space-y-2">
        <div className="font-medium">默认填充模式</div>
        <div className="grid grid-cols-2 gap-2">
          {(Object.keys(FILL_MODE_LABELS) as FillMode[]).map((mode) => (
            <button
              key={mode}
              className={`rounded-lg border p-2.5 text-left transition-colors ${
                settings.defaultFillMode === mode
                  ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-950/60'
                  : 'border-neutral-300 hover:border-neutral-400 dark:border-neutral-700'
              }`}
              onClick={() => void update({ defaultFillMode: mode })}
            >
              <div className={`text-sm font-medium ${settings.defaultFillMode === mode ? 'text-indigo-700 dark:text-indigo-300' : ''}`}>
                {FILL_MODE_LABELS[mode]}
              </div>
              <div className="mt-0.5 text-xs text-neutral-400">{FILL_HINTS[mode]}</div>
            </button>
          ))}
        </div>
        <p className="text-xs leading-relaxed text-neutral-400">
          设为壁纸时默认使用该模式；对话框中也可勾选「保存为默认」随时更换。
        </p>
      </section>

      {/* 导入模式 */}
      <section className="space-y-2">
        <div className="font-medium">导入方式</div>
        <div className="space-y-2">
          {(
            [
              { value: 'copy', label: '复制到媒体库', hint: '导入时复制一份到存储目录，重命名/删除不影响原文件，占用额外磁盘空间' },
              { value: 'reference', label: '仅引用原文件', hint: '不复制文件，节省空间；但移动/删除原文件后图片将失效' }
            ] as { value: AppSettings['importMode']; label: string; hint: string }[]
          ).map((o) => (
            <button
              key={o.value}
              className={`w-full rounded-lg border p-3 text-left transition-colors ${
                settings.importMode === o.value
                  ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-950/60'
                  : 'border-neutral-300 dark:border-neutral-700'
              }`}
              onClick={() => void update({ importMode: o.value })}
            >
              <div className="font-medium">{o.label}</div>
              <div className="mt-0.5 text-xs leading-relaxed text-neutral-400">{o.hint}</div>
            </button>
          ))}
        </div>
      </section>

      {/* 存储位置 */}
      <section className="space-y-2">
        <div className="flex items-center gap-1.5 font-medium">
          <HardDrive size={14} />
          数据存储位置
        </div>
        {migrating ? (
          <div className="flex items-center gap-2.5 rounded-lg border border-indigo-300 bg-indigo-50 p-3 text-indigo-700 dark:border-indigo-800 dark:bg-indigo-950/50 dark:text-indigo-300">
            <Loader2 size={16} className="animate-spin" />
            正在迁移数据到新位置（请勿关闭应用或关机）…
          </div>
        ) : (
          <>
            <div className="rounded-lg border border-neutral-300 p-3 dark:border-neutral-700">
              <div className="flex items-center gap-2">
                <span className="text-xs text-neutral-400">当前位置</span>
                <span
                  className={`rounded-full px-1.5 py-0.5 text-[10px] ${
                    storage?.custom
                      ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300'
                      : 'bg-neutral-200 text-neutral-500 dark:bg-neutral-700 dark:text-neutral-300'
                  }`}
                >
                  {storage?.custom ? '自定义' : '默认'}
                </span>
              </div>
              <div className="mt-1 break-all font-mono text-xs">{storage?.root ?? '读取中…'}</div>
              {storage && <div className="mt-1 text-xs text-neutral-400">占用约 {formatBytes(storage.sizeBytes)}</div>}
            </div>
            <div className="flex gap-2">
              <button
                className="btn-ghost flex-1 justify-center border border-neutral-300 dark:border-neutral-700"
                onClick={() => void changeStorage()}
              >
                更改存储位置…
              </button>
              <button
                className="btn-ghost border border-neutral-300 dark:border-neutral-700"
                onClick={() => void window.api.openUserData()}
              >
                <FolderOpen size={14} />
                打开目录
              </button>
            </div>
            <p className="text-xs leading-relaxed text-neutral-400">
              更换后全部素材、缓存与配置（JSON 数据文件）整体复制到新位置并自动重启；适合迁移到大容量磁盘。使用外置磁盘时，未挂载启动会提示而非清空数据。
            </p>
          </>
        )}
      </section>

      {/* MinIO 多设备同步 */}
      <SyncSection />

      <div className="border-t border-neutral-200 pt-3 text-xs text-neutral-400 dark:border-neutral-800">
        vividDeck v{version}
      </div>
    </div>
  )
}
