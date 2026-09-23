/**
 * 轮播壁纸调度器（主进程）
 *
 * - 定时器运行在主进程：关闭窗口（驻留托盘）后轮播不中断
 * - 随机模式：对素材池洗牌成队列依次播放，播完重洗（避免连续重复）
 * - 顺序模式：按加入时间顺序循环，进度持久化（重启续播）
 * - 每次切换成功后写入壁纸历史，并推送事件到渲染层（托盘气泡提示）
 */
import { BrowserWindow } from 'electron'
import fs from 'node:fs'
import { IPC_EVENTS } from '@shared/ipc'
import type { SlideshowConfig } from '@shared/types'
import { JsonStore } from './store'
import { getLibrary } from './library'
import { applyWallpaper, listMonitors } from './wallpaper'
import { recordApply } from './history'
import { ensureLocal } from './sync/engine'
import { matchAlbum } from '@shared/album'

const DEFAULT_CONFIG: SlideshowConfig = {
  enabled: false,
  intervalValue: 30,
  intervalUnit: 'minute',
  scope: { type: 'all' },
  order: 'random',
  fillMode: 'fill',
  monitorIds: [], // 空 = 全部显示器
  independentMonitors: true, // 多显示器时各屏独立切换不同照片
  lastIndex: 0,
  lastIndexByMonitor: {},
  lastAppliedAt: null
}

const slideshowStore = new JsonStore<SlideshowConfig>('slideshow', DEFAULT_CONFIG)

let timer: NodeJS.Timeout | null = null
let running = false
/** 随机模式的洗牌队列（图片 ID；独立模式下按显示器各一份，'' 键 = 共享队列） */
const shuffleQueues = new Map<string, string[]>()

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
  const data = getLibrary()
  const album = config.scope.type === 'album' ? (data.albums ?? []).find((a) => a.id === config.scope.albumId) : undefined
  const filtered = data.images.filter((img) => {
    if (config.scope.type === 'favorite') return img.favorite
    if (config.scope.type === 'category') return img.categoryId === config.scope.categoryId
    if (config.scope.type === 'album') return album ? matchAlbum(img, album) : false
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

/**
 * 取下一张图片 ID（随机：按 cursorKey 各自的洗牌队列；顺序：各自的索引循环）
 * @param cursorKey 游标键：共享模式 ''；独立模式为 monitorId
 * @param excludeIds 本次 tick 内已被其他显示器使用的图（尽量避开同图重复上墙）
 */
function nextImageId(pool: string[], config: SlideshowConfig, cursorKey = '', excludeIds = new Set<string>()): string | null {
  if (pool.length === 0) return null

  if (config.order === 'sequential') {
    const store = slideshowStore.get()
    const current = cursorKey === '' ? store.lastIndex : (store.lastIndexByMonitor?.[cursorKey] ?? 0)
    let index = ((current % pool.length) + pool.length) % pool.length
    // 避开本 tick 已用过的图（池足够大时最多向后探 N 步）
    let steps = 0
    while (steps < Math.min(pool.length - 1, 8) && excludeIds.has(pool[index])) {
      index = (index + 1) % pool.length
      steps++
    }
    const patch: Partial<SlideshowConfig> =
      cursorKey === '' ? { lastIndex: index + 1 } : { lastIndexByMonitor: { ...store.lastIndexByMonitor, [cursorKey]: index + 1 } }
    slideshowStore.set(patch)
    return pool[index]
  }

  // 随机：按 cursorKey 维护"未播放"洗牌队列；仅剔除已不在池中的 id，
  // 不回填已播放的（否则队列永不耗尽、变成固定顺序循环）；耗尽后整池重洗。
  // 新导入的图会在下一次重洗时加入。
  let queue = shuffleQueues.get(cursorKey) ?? []
  const poolSet = new Set(pool)
  queue = queue.filter((id) => poolSet.has(id))
  let candidates = queue.filter((id) => !excludeIds.has(id))
  if (candidates.length === 0) candidates = shuffle([...pool].filter((id) => !excludeIds.has(id)))
  const picked = candidates.shift() ?? null
  shuffleQueues.set(cursorKey, candidates)
  return picked
}

/** 执行一次切换（轮播心脏；独立模式下每个显示器各取一张不同的图） */
async function tick(manual = false): Promise<void> {
  if (running) return
  running = true
  try {
    const config = getSlideshowConfig()
    const pool = computePool(config)
    if (pool.length === 0) return

    // 解析目标显示器：配置为空 = 全部在线显示器（独立模式需要具体清单逐屏取图）
    const alive = (await listMonitors()).map((m) => m.id)
    let monitorIds = config.monitorIds.length > 0 ? config.monitorIds.filter((id) => alive.includes(id)) : alive

    const images = getLibrary().images
    const usedThisTick = new Set<string>()
    const entries: { entry: ReturnType<typeof recordApply>; manual: boolean }[] = []

    const targets = config.independentMonitors && monitorIds.length > 1 ? monitorIds : [undefined]
    for (const target of targets) {
      // 逐屏容错：任何一屏失败（下载/设置异常）记录日志并继续其余屏幕
      try {
        // 独立模式：每个显示器自己的游标/队列；共享模式：'' 游标、全部屏同图
        const imageId = nextImageId(pool, config, target ?? '', usedThisTick)
        if (!imageId) continue
        const image = images.find((img) => img.id === imageId)
        if (!image) continue

        // 云端图（按需下载模式）先取回本地再设置
        let filePath = image.path
        if (!image.localFile || !fs.existsSync(image.path)) {
          filePath = await ensureLocal(image.id)
        }

        const applyTo = target ? [target] : monitorIds
        const result = await applyWallpaper(filePath, applyTo, config.fillMode)
        usedThisTick.add(imageId)
        entries.push({ entry: recordApply(imageId, result.applied, config.fillMode), manual })
      } catch (err) {
        console.error(`[slideshow] 显示器 ${target ?? '(全部)'} 切换失败，跳过:`, err)
      }
    }

    if (entries.length > 0) {
      slideshowStore.set({ lastAppliedAt: Date.now() })
      broadcast(IPC_EVENTS.SLIDESHOW_TICK, { entry: entries[entries.length - 1].entry, entries, manual })
    }
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
    // 等待本次切换完成后再调度（用最新的 lastAppliedAt 计算间隔），
    // 否则会用旧时间戳算出极短间隔，导致一次周期内连续切换
    void tick().then(() => schedule())
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
  shuffleQueues.clear()
  if (getSlideshowConfig().enabled) schedule()
}

export function flushSlideshow(): void {
  slideshowStore.flush()
}
