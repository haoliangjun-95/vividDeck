/**
 * 轮播计划面板：开关、周期（分钟/小时/天）、素材范围、顺序、目标显示器
 */
import React, { useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { useUIStore } from '../store/ui'
import { useLibraryStore } from '../store/library'
import type { IntervalUnit, MonitorInfo, SlideshowConfig, SlideshowOrder } from '@shared/types'

export function SlideshowPanel(): JSX.Element {
  const toast = useUIStore((s) => s.toast)
  const categories = useLibraryStore((s) => s.categories)
  const albums = useLibraryStore((s) => s.albums)
  const favoriteCount = useLibraryStore((s) => s.images.filter((img) => img.favorite).length)
  const totalCount = useLibraryStore((s) => s.images.length)
  const [config, setConfig] = useState<SlideshowConfig | null>(null)
  const [monitors, setMonitors] = useState<MonitorInfo[]>([])

  useEffect(() => {
    void window.api.getSlideshow().then(setConfig)
    void window.api.listMonitors().then(setMonitors).catch(() => undefined)
    const off = window.api.onSlideshowChanged(setConfig)
    return off
  }, [])

  if (!config) return <div className="text-sm text-neutral-400">加载中…</div>

  const patch = async (p: Partial<SlideshowConfig>): Promise<void> => {
    try {
      setConfig(await window.api.setSlideshow(p))
    } catch (err) {
      toast(`保存失败：${err instanceof Error ? err.message : String(err)}`, 'error')
    }
  }

  const poolSize =
    config.scope.type === 'all' ? totalCount : config.scope.type === 'favorite' ? favoriteCount : undefined

  const unitOptions: { value: IntervalUnit; label: string }[] = [
    { value: 'minute', label: '分钟' },
    { value: 'hour', label: '小时' },
    { value: 'day', label: '天' }
  ]

  return (
    <div className="space-y-5 text-sm">
      {/* 开关 */}
      <label className="flex cursor-pointer items-center justify-between">
        <span className="font-medium">自动轮播</span>
        <button
          role="switch"
          aria-checked={config.enabled}
          className={`relative h-6 w-11 rounded-full transition-colors ${
            config.enabled ? 'bg-indigo-600' : 'bg-neutral-300 dark:bg-neutral-700'
          }`}
          onClick={() => void patch({ enabled: !config.enabled })}
        >
          <span
            className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${
              config.enabled ? 'left-[22px]' : 'left-0.5'
            }`}
          />
        </button>
      </label>

      {/* 周期 */}
      <section className="space-y-2">
        <div className="font-medium">切换周期</div>
        <div className="flex items-center gap-2">
          <span className="text-neutral-400">每</span>
          <input
            type="number"
            min={1}
            max={720}
            className="field w-20"
            value={config.intervalValue}
            onChange={(e) => void patch({ intervalValue: Math.max(1, Number(e.target.value) || 1) })}
          />
          <select
            className="field"
            value={config.intervalUnit}
            onChange={(e) => void patch({ intervalUnit: e.target.value as IntervalUnit })}
          >
            {unitOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <span className="text-neutral-400">切换一次</span>
        </div>
      </section>

      {/* 范围 */}
      <section className="space-y-2">
        <div className="font-medium">轮播素材范围</div>
        <div className="space-y-1.5">
          {[
            { key: 'all', label: `全部图库（${totalCount} 张）` },
            { key: 'favorite', label: `收藏图片（${favoriteCount} 张）` },
            ...categories.map((c) => ({ key: `category:${c.id}`, label: `分类：${c.name}` })),
            ...albums.map((a) => ({ key: `album:${a.id}`, label: `智能相册：${a.name}` }))
          ].map((opt) => {
            const active =
              opt.key === 'all'
                ? config.scope.type === 'all'
                : opt.key === 'favorite'
                  ? config.scope.type === 'favorite'
                  : config.scope.type === 'category' && config.scope.categoryId === opt.key.split(':')[1]
            return (
              <button
                key={opt.key}
                className={`w-full rounded-lg px-3 py-2 text-left transition-colors ${
                  active
                    ? 'bg-indigo-50 font-medium text-indigo-700 ring-1 ring-indigo-300 dark:bg-indigo-950/60 dark:text-indigo-300 dark:ring-indigo-800'
                    : 'hover:bg-neutral-100 dark:hover:bg-neutral-800'
                }`}
                onClick={() =>
                  void patch({
                    scope:
                      opt.key === 'all'
                        ? { type: 'all' }
                        : opt.key === 'favorite'
                          ? { type: 'favorite' }
                          : opt.key.startsWith('album:')
                            ? { type: 'album', albumId: opt.key.split(':')[1] }
                            : { type: 'category', categoryId: opt.key.split(':')[1] }
                  })
                }
              >
                {opt.label}
              </button>
            )
          })}
        </div>
        {poolSize === 0 && (
          <p className="text-xs text-amber-600 dark:text-amber-400">当前范围内没有图片，轮播将不会切换。</p>
        )}
      </section>

      {/* 顺序 */}
      <section className="space-y-2">
        <div className="font-medium">切换顺序</div>
        <div className="flex gap-2">
          {(
            [
              { value: 'random', label: '随机' },
              { value: 'sequential', label: '顺序循环' }
            ] as { value: SlideshowOrder; label: string }[]
          ).map((o) => (
            <button
              key={o.value}
              className={`flex-1 rounded-lg border px-3 py-2 transition-colors ${
                config.order === o.value
                  ? 'border-indigo-500 bg-indigo-50 font-medium text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300'
                  : 'border-neutral-300 dark:border-neutral-700'
              }`}
              onClick={() => void patch({ order: o.value })}
            >
              {o.label}
            </button>
          ))}
        </div>
      </section>

      {/* 显示器 */}
      <section className="space-y-2">
        <div className="font-medium">目标显示器（不选 = 全部）</div>
        {monitors.length > 1 && (
          <label className="flex cursor-pointer items-center gap-2 text-xs text-neutral-500 dark:text-neutral-400">
            <input
              type="checkbox"
              className="h-3.5 w-3.5 accent-indigo-600"
              checked={config.independentMonitors}
              onChange={(e) => void patch({ independentMonitors: e.target.checked })}
            />
            每个显示器切换不同照片（关闭则所有屏同步同一张）
          </label>
        )}
        {monitors.map((m) => {
          const active = config.monitorIds.includes(m.id)
          return (
            <button
              key={m.id}
              className={`flex w-full items-center justify-between rounded-lg border px-3 py-2 transition-colors ${
                active ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-950/60' : 'border-neutral-300 dark:border-neutral-700'
              }`}
              onClick={() =>
                void patch({
                  monitorIds: active ? config.monitorIds.filter((id) => id !== m.id) : [...config.monitorIds, m.id]
                })
              }
            >
              <span className="truncate">
                {m.label} <span className="text-xs text-neutral-400">{m.width}×{m.height}</span>
              </span>
              <span>{active ? '✓' : ''}</span>
            </button>
          )
        })}
      </section>

      <button
        className="btn-ghost w-full justify-center border border-neutral-300 dark:border-neutral-700"
        onClick={() =>
          void window.api
            .slideshowNext()
            .then(() => toast('已切换下一张', 'info'))
            .catch((err) => toast(err.message, 'error'))
        }
      >
        <RefreshCw size={14} />
        立即切换下一张
      </button>

      <p className="rounded-lg bg-neutral-100 p-3 text-xs leading-relaxed text-neutral-500 dark:bg-neutral-800/60 dark:text-neutral-400">
        提示：关闭主窗口后应用将驻留系统托盘，轮播不会中断；可在托盘菜单中快速切换或退出。
      </p>
    </div>
  )
}
