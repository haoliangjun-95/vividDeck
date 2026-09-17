/**
 * 轮播壁纸调度器（主进程）
 *
 * - 定时器运行在主进程：关闭窗口（驻留托盘）后轮播不中断
 * - 随机模式：对素材池洗牌成队列依次播放，播完重洗（避免连续重复）
 * - 顺序模式：按加入时间顺序循环，进度持久化（重启续播）
 * - 每次切换成功后写入壁纸历史，并推送事件到渲染层（托盘气泡提示）
 */
import { BrowserWindow } from 'electron'
import { IPC_EVENTS } from '@shared/ipc'
import type { SlideshowConfig } from '@shared/types'
import { JsonStore } from './store'
import { getLibrary } from './library'
import { applyWallpaper, listMonitors } from './wallpaper'
import { recordApply } from './history'

const DEFAULT_CONFIG: SlideshowConfig = {
  enabled: false,
  intervalValue: 30,
  intervalUnit: 'minute',
  scope: { type: 'all' },
  order: 'random',
  fillMode: 'fill',
  monitorIds: [], // 空 = 全部显示器
  lastIndex: 0,
  lastAppliedAt: null
}

const slideshowStore = new JsonStore<SlideshowConfig>('slideshow', DEFAULT_CONFIG)

let timer: NodeJS.Timeout | null = null
let running = false
/** 随机模式的洗牌队列（图片 ID） */
let shuffleQueue: string[] = []

export function getSlideshowConfig(): SlideshowConfig {
  return slideshowStore.get()
}

/** 周期换算为毫秒 */
function intervalMs(config: SlideshowConfig): number {
  const v = Math.max(1, config.intervalValue || 1)
  switch (config.intervalUnit) {
    case 'minute':
      return v * 60_000
    case 'hour':
      return v * 3_600_000
    case 'day':
      return v * 86_400_000
  }
}

/** 依据范围计算素材池（图片 ID，按加入时间排序保证顺序模式稳定） */
function computePool(config: SlideshowConfig): string[] {
  const images = getLibrary().images
  const filtered = images.filter((img) => {
    if (config.scope.type === 'favorite') return img.favorite
    if (config.scope.type === 'category') return img.categoryId === config.scope.categoryId
    return true
  })
  return filtered.sort((a, b) => a.addedAt - b.addedAt).map((img) => img.id)
}

/** 洗牌（Fisher-Yates） */
function shuffle<T>(arr: T[]): T[] {
  const copy = [...arr]
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
  }
  return copy
}

/** 广播事件到所有渲染窗口 */
function broadcast(channel: string, payload?: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(channel, payload)
  }
}

/** 取下一张图片 ID（随机：洗牌队列；顺序：索引循环） */
function nextImageId(pool: string[], config: SlideshowConfig): string | null {
  if (pool.length === 0) return null
  if (config.order === 'sequential') {
    const index = ((config.lastIndex % pool.length) + pool.length) % pool.length
    slideshowStore.set({ lastIndex: index + 1 })
    return pool[index]
  }
  // 随机：队列耗尽时重洗；素材池变化时同步增删
  const poolSet = new Set(pool)
  shuffleQueue = shuffleQueue.filter((id) => poolSet.has(id))
  for (const id of pool) if (!shuffleQueue.includes(id)) shuffleQueue.push(id)
  if (shuffleQueue.length === 0) shuffleQueue = shuffle(pool)
  return shuffleQueue.shift() ?? null
}

/** 执行一次切换（轮播心脏） */
async function tick(manual = false): Promise<void> {
  if (running) return
  running = true
  try {
    const config = getSlideshowConfig()
    const pool = computePool(config)
    if (pool.length === 0) return

    const imageId = nextImageId(pool, config)
    if (!imageId) return
    const image = getLibrary().images.find((img) => img.id === imageId)
    if (!image) return

    // 校验目标显示器仍存在；配置的都被拔掉则退回全部
    let monitorIds = config.monitorIds
    if (monitorIds.length > 0) {
      const alive = (await listMonitors()).map((m) => m.id)
      monitorIds = monitorIds.filter((id) => alive.includes(id))
    }

    const result = await applyWallpaper(image.path, monitorIds, config.fillMode)
    const entry = recordApply(imageId, result.applied, config.fillMode)
    slideshowStore.set({ lastAppliedAt: Date.now() })
    broadcast(IPC_EVENTS.SLIDESHOW_TICK, { entry, manual })
  } catch (err) {
    console.error('[slideshow] 切换失败:', err)
  } finally {
    running = false
  }
}

/** 依据配置调度下一次切换 */
function schedule(delayMs?: number): void {
  if (timer) clearTimeout(timer)
  const config = getSlideshowConfig()
  if (!config.enabled) return

  let delay = delayMs
  if (delay === undefined) {
    // 重启续播：上次切换时间 + 周期 - 现在；已过期则尽快（3s 后）执行
    const interval = intervalMs(config)
    const last = config.lastAppliedAt ?? 0
    delay = Math.max(3000, last + interval - Date.now())
  }
  timer = setTimeout(() => {
    void tick()
    schedule() // 重新按周期排下一次
  }, delay)
  timer.unref?.()
}

/** 更新配置（部分字段），自动重启调度 */
export function setSlideshowConfig(patch: Partial<SlideshowConfig>): SlideshowConfig {
  slideshowStore.set(patch)
  slideshowStore.flush()
  const config = getSlideshowConfig()
  if (config.enabled) {
    // 开启或参数变化：立即重排（保留 lastAppliedAt 基准）
    schedule()
  } else if (timer) {
    clearTimeout(timer)
    timer = null
  }
  broadcast(IPC_EVENTS.SLIDESHOW_CHANGED, config)
  return config
}

/** 手动触发下一张（托盘菜单 / 界面按钮），并重置计时 */
export async function nextSlideshowNow(): Promise<void> {
  await tick(true)
  if (getSlideshowConfig().enabled) schedule()
}

/** 应用启动时恢复轮播 */
export function initSlideshow(): void {
  shuffleQueue = []
  if (getSlideshowConfig().enabled) schedule()
}

export function flushSlideshow(): void {
  slideshowStore.flush()
}
