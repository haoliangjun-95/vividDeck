/**
 * 轮播计划面板：开关、周期（分钟/小时/天）、素材范围、顺序、目标显示器
 */
import React, { useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { useUIStore } from '../store/ui'
import { useLibraryStore } from '../store/library'
import type {
  IntervalUnit,
  MonitorInfo,
  MonitorOverride,
  SlideshowConfig,
  SlideshowOrder,
  SlideshowScope
} from '@shared/types'
import { matchAlbum } from '@shared/album'

export function SlideshowPanel(): JSX.Element {
  const toast = useUIStore((s) => s.toast)
  const categories = useLibraryStore((s) => s.categories)
  const albums = useLibraryStore((s) => s.albums)
  const favoriteCount = useLibraryStore((s) => s.images.filter((img) => img.favorite).length)
  const totalCount = useLibraryStore((s) => s.images.length)
  const images = useLibraryStore((s) => s.images)
  const [config, setConfig] = useState<SlideshowConfig | null>(null)
  const [monitors, setMonitors] = useState<MonitorInfo[]>([])

  useEffect(() => {
    void window.api.getSlideshow().then(setConfig)
    void window.api
      .listMonitors()
      .then(setMonitors)
      .catch(() => undefined)
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

  // 池大小：全部/收藏用派生计数；分类/相册按范围实际过滤（相册复用 matchAlbum，与侧栏口径一致）
  const poolSize = ((): number | undefined => {
    const sc = config.scope
    switch (sc.type) {
      case 'all':
        return totalCount
      case 'favorite':
        return favoriteCount
      case 'category':
        return images.filter((img) => img.categoryId === sc.categoryId).length
      case 'album': {
        const album = albums.find((a) => a.id === sc.albumId)
        return album ? images.filter((img) => matchAlbum(img, album)).length : 0
      }
      default:
        return undefined
    }
  })()

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
            onChange={(e) =>
              void patch({ intervalValue: Math.max(1, Number(e.target.value) || 1) })
            }
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
                  : config.scope.type === 'category' &&
                    config.scope.categoryId === opt.key.split(':')[1]
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
          <p className="text-xs text-amber-600 dark:text-amber-400">
            当前范围内没有图片，轮播将不会切换。
          </p>
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

      {/* 显示器（独立模式：每屏卡片；共享模式：简单多选） */}
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
        {config.independentMonitors && monitors.length > 1
          ? monitors.map((m) => (
              <MonitorCard key={m.id} monitor={m} config={config} onPatch={(p) => void patch(p)} />
            ))
          : monitors.map((m) => {
              const active = config.monitorIds.includes(m.id)
              return (
                <button
                  key={m.id}
                  className={`flex w-full items-center justify-between rounded-lg border px-3 py-2 transition-colors ${
                    active
                      ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-950/60'
                      : 'border-neutral-300 dark:border-neutral-700'
                  }`}
                  onClick={() =>
                    void patch({
                      monitorIds: active
                        ? config.monitorIds.filter((id) => id !== m.id)
                        : [...config.monitorIds, m.id]
                    })
                  }
                >
                  <span className="truncate">
                    {m.label}{' '}
                    <span className="text-xs text-neutral-400">
                      {m.width}×{m.height}
                    </span>
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

/** 单屏轮播卡片：当前壁纸 + 下次切换倒计时 + 自定义此屏（范围/周期/填充/开关） */
function MonitorCard({
  monitor,
  config,
  onPatch
}: {
  monitor: MonitorInfo
  config: SlideshowConfig
  onPatch: (p: Partial<SlideshowConfig>) => void
}): JSX.Element {
  const categories = useLibraryStore((st) => st.categories)
  const albums = useLibraryStore((st) => st.albums)
  const images = useLibraryStore((st) => st.images)
  const [history, setHistory] = useState<{ imageId: string; monitorIds: string[] }[]>([])
  const [expanded, setExpanded] = useState(false)
  const [now, setNow] = useState(Date.now())

  const o = config.monitorOverrides?.[monitor.id] ?? {}
  const eff = {
    intervalValue: o.intervalValue ?? config.intervalValue,
    intervalUnit: o.intervalUnit ?? config.intervalUnit,
    scope: o.scope ?? config.scope,
    fillMode: o.fillMode ?? config.fillMode
  }
  const disabled = o.disabled ?? false
  const intervalMsVal =
    eff.intervalValue *
    (eff.intervalUnit === 'minute' ? 60_000 : eff.intervalUnit === 'hour' ? 3_600_000 : 86_400_000)
  const lastAt = config.lastAppliedAtByMonitor?.[monitor.id] ?? 0
  const nextAt = lastAt + intervalMsVal
  const remainMs = nextAt - now

  useEffect(() => {
    void window.api.listHistory().then((h) => setHistory(h as never))
    const off = window.api.onSlideshowTick(() => {
      void window.api.listHistory().then((h) => setHistory(h as never))
      setNow(Date.now())
    })
    return off
  }, [])
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])

  const currentEntry = history.find((h) => h.monitorIds.includes(monitor.id))
  const currentImg = currentEntry ? images.find((i) => i.id === currentEntry.imageId) : undefined
  const fmtRemain = (ms: number): string => {
    if (ms <= 0) return '即将切换'
    const s = Math.floor(ms / 1000)
    if (s < 60) return `${s} 秒后`
    const m = Math.floor(s / 60)
    if (m < 60) return `${m} 分 ${s % 60} 秒后`
    const h = Math.floor(m / 60)
    return `${h} 时 ${m % 60} 分后`
  }

  const patchOverride = (p: Partial<MonitorOverride>): void => {
    onPatch({
      monitorOverrides: { ...(config.monitorOverrides ?? {}), [monitor.id]: { ...o, ...p } }
    })
  }

  const scopeLabel = (sc: SlideshowScope): string => {
    if (sc.type === 'all') return '全部图库'
    if (sc.type === 'favorite') return '收藏'
    if (sc.type === 'category')
      return `分类：${categories.find((c) => c.id === sc.categoryId)?.name ?? '?'}`
    return `相册：${albums.find((a) => a.id === sc.albumId)?.name ?? '?'}`
  }

  return (
    <div className={`card space-y-2 p-3 ${disabled ? 'opacity-50' : ''}`}>
      <div className="flex items-center gap-3">
        {currentImg ? (
          <img
            src={`media://thumb/${currentImg.id}`}
            alt=""
            className="h-12 w-16 shrink-0 rounded-md object-cover"
          />
        ) : (
          <div className="flex h-12 w-16 shrink-0 items-center justify-center rounded-md bg-neutral-200 text-[10px] text-neutral-400 dark:bg-neutral-700">
            未设置
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">
            {monitor.label}{' '}
            <span className="text-xs font-normal text-neutral-400">
              {monitor.width}×{monitor.height}
              {monitor.isMain ? ' · 主屏' : ''}
            </span>
          </div>
          <div className="text-xs text-neutral-400">
            {disabled ? '已暂停' : config.enabled ? fmtRemain(remainMs) : '轮播未开启'} ·{' '}
            {scopeLabel(eff.scope as SlideshowScope)}
          </div>
        </div>
        <label
          className="flex cursor-pointer items-center gap-1 text-[11px] text-neutral-400"
          title="单独暂停此屏轮播"
        >
          <input
            type="checkbox"
            className="h-3.5 w-3.5 accent-indigo-600"
            checked={!disabled}
            onChange={(e) => patchOverride({ disabled: !e.target.checked })}
          />
          轮播
        </label>
      </div>
      <button
        className="btn-ghost w-full justify-center !py-1 text-xs"
        onClick={() => setExpanded((v) => !v)}
      >
        {expanded ? '收起' : '自定义此屏'}
      </button>
      {expanded && (
        <div className="space-y-2 border-t border-neutral-200 pt-2 text-xs dark:border-neutral-700">
          <div className="flex items-center gap-2">
            <span className="w-10 shrink-0 text-neutral-400">周期</span>
            <input
              type="number"
              min={1}
              className="field w-16 !py-1"
              value={eff.intervalValue}
              onChange={(e) =>
                patchOverride({ intervalValue: Math.max(1, Number(e.target.value) || 1) })
              }
            />
            <select
              className="field !py-1"
              value={eff.intervalUnit}
              onChange={(e) =>
                patchOverride({ intervalUnit: e.target.value as 'minute' | 'hour' | 'day' })
              }
            >
              <option value="minute">分钟</option>
              <option value="hour">小时</option>
              <option value="day">天</option>
            </select>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-10 shrink-0 text-neutral-400">填充</span>
            <select
              className="field !py-1"
              value={eff.fillMode}
              onChange={(e) =>
                patchOverride({ fillMode: e.target.value as 'fill' | 'stretch' | 'center' | 'fit' })
              }
            >
              <option value="fill">铺满</option>
              <option value="stretch">拉伸</option>
              <option value="center">居中</option>
              <option value="fit">适应屏幕</option>
            </select>
          </div>
          <div>
            <span className="mb-1 block text-neutral-400">范围</span>
            <select
              className="field w-full !py-1"
              value={`${(eff.scope as SlideshowScope).type}:${(eff.scope as SlideshowScope).categoryId ?? (eff.scope as SlideshowScope).albumId ?? ''}`}
              onChange={(e) => {
                const [type, id] = e.target.value.split(':')
                if (type === 'all') patchOverride({ scope: { type: 'all' } })
                else if (type === 'favorite') patchOverride({ scope: { type: 'favorite' } })
                else if (type === 'category')
                  patchOverride({ scope: { type: 'category', categoryId: id } })
                else if (type === 'album') patchOverride({ scope: { type: 'album', albumId: id } })
              }}
            >
              <option value="all:">全部图库</option>
              <option value="favorite:">收藏</option>
              {categories.map((c) => (
                <option key={c.id} value={`category:${c.id}`}>
                  分类：{c.name}
                </option>
              ))}
              {albums.map((a) => (
                <option key={a.id} value={`album:${a.id}`}>
                  相册：{a.name}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}
    </div>
  )
}
