/**
 * 轮播壁纸调度器（主进程）
 *
 * - 定时器运行在主进程：关闭窗口（驻留托盘）后轮播不中断
 * - 随机模式：对素材池洗牌成队列依次播放，播完重洗（避免连续重复）
 * - 顺序模式：按加入时间顺序循环，进度持久化（重启续播）
 * - 每次切换成功后写入壁纸历史，并推送事件到渲染层（托盘气泡提示）
 * - 单屏连续失败按指数退避，素材池为空按固定节奏温和重试（避免拔屏等场景的重试风暴）
 * - 显示器热插拔感知：接屏/拔屏（防抖合并）后清空退避状态并重排调度
 * - 独立模式跨屏去重：避开一个周期窗口内其他屏刚应用过的照片，并错开各屏首次切换
 */
import { BrowserWindow, screen } from 'electron'
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
  monitorOverrides: {},
  lastAppliedAtByMonitor: {},
  lastIndex: 0,
  lastIndexByMonitor: {},
  lastAppliedAt: null
}

const slideshowStore = new JsonStore<SlideshowConfig>('slideshow', DEFAULT_CONFIG)

/** 常规调度的最小延迟：周期已过期时尽快（该延迟后）执行 */
const MIN_APPLY_DELAY_MS = 3_000
/** 失败退避的基础延迟：首次失败后此时长重试 */
const BACKOFF_BASE_MS = 3_000
/** 失败退避的增长倍数：每连续失败一次 ×2 */
const BACKOFF_MULTIPLIER = 2
/** 退避上限因子：退避延迟不超过 max(该屏周期, 此值) */
const BACKOFF_CAP_MS = 60_000
/** 素材池为空时的重试间隔：用户可能随时导入图片，不退避、固定温和节奏 */
const EMPTY_POOL_RETRY_MS = 30_000
/** 显示器热插拔事件的防抖延迟：合并分辨率变化等事件风暴为一次重排 */
const DISPLAY_EVENT_DEBOUNCE_MS = 500
/** 跨屏去重窗口的容量上限：超出时按插入序淘汰最旧记录 */
const RECENT_APPLIED_CAP = 64

let timer: NodeJS.Timeout | null = null
/** 独立模式每屏各自的定时器 */
const monitorTimers = new Map<string, NodeJS.Timeout>()
let running = false
/** 随机模式的洗牌队列（图片 ID；独立模式下按显示器各一份，'' 键 = 共享队列） */
const shuffleQueues = new Map<string, string[]>()
/** 每屏连续失败次数（指数退避依据；成功后清零，仅内存态不持久化） */
const monitorFailures = new Map<string, number>()
/** 跨屏去重窗口：图片 ID -> 应用它的屏与时间（读取时顺带清理过期项） */
const recentApplied = new Map<string, { monitorId: string; at: number }>()
/** 显示器热插拔监听是否已注册（防止重复 init 造成双重绑定） */
let screenEventsBound = false
/** 热插拔防抖定时器 */
let screenEventTimer: NodeJS.Timeout | null = null

/** 单屏一次切换的结果（调度器据此决定下一次延迟策略） */
type TickOutcome = 'applied' | 'empty-pool' | 'failed' | 'skipped'

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

/** 解析某屏的有效轮播参数（override 覆盖全局，缺省继承） */
function effectiveConfig(config: SlideshowConfig, monitorId: string): SlideshowConfig & { disabled: boolean } {
  const o = config.monitorOverrides?.[monitorId] ?? {}
  return {
    ...config,
    scope: o.scope ?? config.scope,
    intervalValue: o.intervalValue ?? config.intervalValue,
    intervalUnit: o.intervalUnit ?? config.intervalUnit,
    fillMode: o.fillMode ?? config.fillMode,
    disabled: o.disabled ?? false
  }
}

/** 后台预取：把该屏池中游标之后的 N 张云端图提前下载（不阻塞切换） */
function prefetchNext(pool: string[], config: SlideshowConfig, cursorKey: string, count = 3): void {
  const images = getLibrary().images
  const store = slideshowStore.get()
  const cur = cursorKey === '' ? store.lastIndex : (store.lastIndexByMonitor?.[cursorKey] ?? 0)
  const upcoming: string[] = []
  if (config.order === 'sequential') {
    for (let i = 1; i <= count; i++) {
      const id = pool[(cur + i) % pool.length]
      if (id) upcoming.push(id)
    }
  } else {
    const queue = shuffleQueues.get(cursorKey) ?? []
    upcoming.push(...queue.slice(0, count))
  }
  for (const id of upcoming) {
    const img = images.find((i) => i.id === id)
    if (img && !img.localFile) {
      void ensureLocal(id).catch(() => undefined)
    }
  }
}

/** 记录某屏刚应用过的图（跨屏去重窗口；超容量时按插入序近似淘汰最旧项） */
function rememberRecentApply(imageId: string, monitorId: string): void {
  recentApplied.set(imageId, { monitorId, at: Date.now() })
  while (recentApplied.size > RECENT_APPLIED_CAP) {
    const oldest = recentApplied.keys().next()
    if (oldest.done === true) break
    recentApplied.delete(oldest.value)
  }
}

/** 构造某屏的排除集合：窗口（本屏一个周期）内其他屏最近应用过的图，避免同图重复上墙 */
function buildRecentExcludeIds(monitorId: string, windowMs: number): Set<string> {
  const now = Date.now()
  const exclude = new Set<string>()
  for (const [imageId, rec] of recentApplied) {
    if (now - rec.at >= windowMs) {
      // 过期项顺带淘汰，控制内存占用
      recentApplied.delete(imageId)
      continue
    }
    if (rec.monitorId !== monitorId) exclude.add(imageId)
  }
  return exclude
}

/** 单屏切换（独立模式每屏各自的 tick）；返回结果供调度器决定下一次延迟 */
async function tickMonitor(monitorId: string, manual = false): Promise<TickOutcome> {
  // 每次读取最新持久化配置：用户关闭总开关后，已排定的定时器不得再多切一次
  const config = getSlideshowConfig()
  if (!config.enabled && !manual) return 'skipped'
  const eff = effectiveConfig(config, monitorId)
  if (eff.disabled) return 'skipped'
  try {
    const pool = computePool(eff)
    if (pool.length === 0) return 'empty-pool'
    // 跨屏去重：避开其他屏最近一个周期内已应用的图；
    // 池太小（去重集覆盖整池）时放弃去重保证有图可出，否则随机路径会返回 null
    const excludeIds = buildRecentExcludeIds(monitorId, intervalMs(eff))
    const imageId = nextImageId(pool, eff, monitorId, excludeIds.size < pool.length ? excludeIds : new Set<string>())
    if (!imageId) return 'failed'
    const image = getLibrary().images.find((img) => img.id === imageId)
    if (!image) return 'failed'
    let filePath = image.path
    if (!image.localFile || !fs.existsSync(image.path)) {
      filePath = await ensureLocal(image.id)
    }
    const result = await applyWallpaper(filePath, [monitorId], eff.fillMode)
    const entry = recordApply(imageId, result.applied, eff.fillMode)
    slideshowStore.set({ lastAppliedAtByMonitor: { ...slideshowStore.get().lastAppliedAtByMonitor, [monitorId]: Date.now() } })
    rememberRecentApply(imageId, monitorId)
    broadcast(IPC_EVENTS.SLIDESHOW_TICK, { entry, entries: [entry], manual })
    prefetchNext(pool, eff, monitorId)
    return 'applied'
  } catch (err) {
    console.error(`[slideshow] 显示器 ${monitorId} 切换失败:`, err)
    return 'failed'
  }
}

/**
 * 为单屏排下一次切换（独立模式）
 * @param staggerMs 错峰偏移：叠加到计算出的延迟上，避免多屏同一时刻触发原生调用
 */
function scheduleMonitor(monitorId: string, delayMs?: number, staggerMs = 0): void {
  const config = getSlideshowConfig()
  const eff = effectiveConfig(config, monitorId)
  if (!config.enabled || eff.disabled) {
    const t = monitorTimers.get(monitorId)
    if (t) clearTimeout(t)
    monitorTimers.delete(monitorId)
    return
  }
  const old = monitorTimers.get(monitorId)
  if (old) clearTimeout(old)
  let delay = delayMs
  if (delay === undefined) {
    // 重启续播：上次切换时间 + 周期 - 现在；已过期则尽快执行
    const interval = intervalMs(eff)
    const last = slideshowStore.get().lastAppliedAtByMonitor?.[monitorId] ?? 0
    delay = Math.max(MIN_APPLY_DELAY_MS, last + interval - Date.now())
  }
  delay += staggerMs
  const t = setTimeout(() => {
    void tickMonitor(monitorId).then((outcome) => rescheduleMonitor(monitorId, outcome))
  }, delay)
  t.unref?.()
  monitorTimers.set(monitorId, t)
}

/**
 * 一次切换后依据结果重排（独立模式）：
 * - 成功：清零失败计数，按常规周期调度
 * - 池空：不计失败，按固定温和节奏重试（用户可能随时导入图片）
 * - 失败：指数退避（3s 起、每次 ×2、封顶 max(周期, 60s)），
 *   避免拔屏等场景每轮 computePool + 原生子进程调用的无退避重试风暴
 */
function rescheduleMonitor(monitorId: string, outcome: TickOutcome): void {
  const config = getSlideshowConfig()
  const eff = effectiveConfig(config, monitorId)
  // 总开关或该屏已关闭：scheduleMonitor 内部会清掉该屏定时器
  if (!config.enabled || eff.disabled) {
    scheduleMonitor(monitorId)
    return
  }
  switch (outcome) {
    case 'applied':
      monitorFailures.delete(monitorId)
      scheduleMonitor(monitorId)
      return
    case 'skipped':
      scheduleMonitor(monitorId)
      return
    case 'empty-pool':
      scheduleMonitor(monitorId, EMPTY_POOL_RETRY_MS)
      return
    case 'failed': {
      const failures = (monitorFailures.get(monitorId) ?? 0) + 1
      monitorFailures.set(monitorId, failures)
      const cap = Math.max(intervalMs(eff), BACKOFF_CAP_MS)
      const backoff = Math.min(BACKOFF_BASE_MS * BACKOFF_MULTIPLIER ** (failures - 1), cap)
      scheduleMonitor(monitorId, backoff)
      return
    }
  }
}

/** 清空每屏定时器 */
function clearMonitorTimers(): void {
  for (const t of monitorTimers.values()) clearTimeout(t)
  monitorTimers.clear()
}

/** 执行一次切换（轮播心脏；独立模式下每个显示器各取一张不同的图） */
async function tick(manual = false): Promise<void> {
  if (running) return
  running = true
  try {
    const config = getSlideshowConfig()
    // 读取最新持久化配置：关闭总开关后已排定的定时器不得再多切一次（手动触发除外）
    if (!config.enabled && !manual) return
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

/** 共享模式调度（全部屏同一张图，单 timer） */
function scheduleShared(delayMs?: number): void {
  if (timer) clearTimeout(timer)
  const config = getSlideshowConfig()
  if (!config.enabled) return
  let delay = delayMs
  if (delay === undefined) {
    // 重启续播：上次切换时间 + 周期 - 现在；已过期则尽快执行
    const interval = intervalMs(config)
    const last = config.lastAppliedAt ?? 0
    delay = Math.max(MIN_APPLY_DELAY_MS, last + interval - Date.now())
  }
  timer = setTimeout(() => {
    // 等待本次切换完成后再调度（用最新的 lastAppliedAt 计算间隔），
    // 否则会用旧时间戳算出极短间隔，导致一次周期内连续切换
    void tick().then(() => schedule())
  }, delay)
  timer.unref?.()
}

/** 依据配置调度下一次切换（独立模式分派每屏；共享模式单 timer） */
function schedule(delayMs?: number): void {
  if (timer) clearTimeout(timer)
  clearMonitorTimers()
  const config = getSlideshowConfig()
  if (!config.enabled) return

  if (config.independentMonitors) {
    // 每屏独立调度（各自的周期与覆盖配置）；monitor id 来自平台适配层
    void listMonitors()
      .then((mons) => {
        const alive = mons.map((m) => m.id)
        const targets = config.monitorIds.length > 0 ? config.monitorIds.filter((id) => alive.includes(id)) : alive
        // 至少两屏才有独立意义；单屏退回共享路径
        if (targets.length > 1) {
          // 错峰：按屏索引把首次切换平移 周期/屏数 的份额，
          // 避免所有屏同一时刻触发（N 个原生子进程 + N 次 sharp 预渲染并发）
          targets.forEach((m, i) => {
            const stagger = Math.round((i * intervalMs(effectiveConfig(config, m))) / targets.length)
            scheduleMonitor(m, delayMs, stagger)
          })
        } else {
          scheduleShared(delayMs)
        }
      })
      .catch(() => scheduleShared(delayMs))
    return
  }
  scheduleShared(delayMs)
}

/** 更新配置（部分字段），自动重启调度 */
export function setSlideshowConfig(patch: Partial<SlideshowConfig>): SlideshowConfig {
  slideshowStore.set(patch)
  slideshowStore.flush()
  const config = getSlideshowConfig()
  // 统一走 schedule()：内部先清共享 timer 与全部 monitorTimers，关闭时直接 no-op，
  // 保证关闭轮播后每屏定时器一并停止（此前只清共享 timer，各屏还会再多切一次）
  schedule()
  broadcast(IPC_EVENTS.SLIDESHOW_CHANGED, config)
  return config
}

/** 手动触发下一张（托盘菜单 / 界面按钮），并重置计时 */
export async function nextSlideshowNow(): Promise<void> {
  const config = getSlideshowConfig()
  if (config.independentMonitors) {
    const mons = await listMonitors().catch(() => [] as { id: string }[])
    const alive = mons.map((m) => m.id)
    const targets = config.monitorIds.length > 0 ? config.monitorIds.filter((id) => alive.includes(id)) : alive
    if (targets.length > 1) {
      // 并行切换各屏（游标彼此独立、store 按屏原子写入，且 tickMonitor 内部已捕获异常不会 reject），
      // 避免逐屏串行等待各自的下载 + 预渲染
      await Promise.all(targets.map((m) => tickMonitor(m, true)))
      if (getSlideshowConfig().enabled) for (const m of targets) scheduleMonitor(m)
      return
    }
  }
  await tick(true)
  if (getSlideshowConfig().enabled) schedule()
}

/** 显示器拓扑变化（接屏/拔屏）：清空退避状态并防抖重排，避免事件风暴下反复调度 */
function onDisplayTopologyChanged(): void {
  if (screenEventTimer) clearTimeout(screenEventTimer)
  screenEventTimer = setTimeout(() => {
    screenEventTimer = null
    // 显示器集合已变化：旧屏的失败计数不再有意义，全部清空后重新枚举调度
    monitorFailures.clear()
    schedule()
  }, DISPLAY_EVENT_DEBOUNCE_MS)
  screenEventTimer.unref?.()
}

/** 注册显示器热插拔监听（幂等：重复 init 不会双重绑定） */
function bindScreenEvents(): void {
  if (screenEventsBound) return
  screenEventsBound = true
  screen.on('display-added', onDisplayTopologyChanged)
  screen.on('display-removed', onDisplayTopologyChanged)
}

/** 应用启动时恢复轮播 */
export function initSlideshow(): void {
  shuffleQueues.clear()
  monitorFailures.clear()
  recentApplied.clear()
  bindScreenEvents()
  if (getSlideshowConfig().enabled) schedule()
}

export function flushSlideshow(): void {
  slideshowStore.flush()
}
