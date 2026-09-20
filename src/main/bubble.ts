/**
 * 桌面悬浮球：点击切换壁纸的置顶小窗
 * - 无边框透明窗口，始终悬浮于所有窗口之上，不占任务栏
 * - 球面显示当前壁纸缩略图（渲染层经 media:// 加载）
 * - 位置持久化 + 屏幕边界钳制（显示器分辨率/数量变化自动拉回可见区域）
 * - macOS 跨空间（全屏空间除外）常驻
 */
import { BrowserWindow, Menu, screen, ipcMain } from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { IPC, IPC_EVENTS } from '@shared/ipc'
import { JsonStore } from './services/store'
import { getSettings, updateSettings } from './services/settings'
import { listHistory } from './services/history'
import { nextSlideshowNow } from './services/slideshow'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

/** 窗口尺寸（含阴影留白） */
const SIZE = 76
/** 距屏幕边缘最小留白 */
const MARGIN = 6

interface BubbleState {
  x: number
  y: number
}

const bubbleStore = new JsonStore<BubbleState>('bubble', { x: -1, y: -1 })

let bubbleWindow: BrowserWindow | null = null
/** 状态变化回调（托盘菜单刷新用） */
let stateChangeHandler: (() => void) | null = null
/** 「打开主界面」回调（index.ts 注入，避免跨模块循环依赖） */
let openMainHandler: (() => void) | null = null

function broadcast(channel: string, payload?: unknown): void {
  if (bubbleWindow && !bubbleWindow.isDestroyed()) {
    bubbleWindow.webContents.send(channel, payload)
  }
}

/** 把坐标钳制到最近的显示器可见区域内 */
function clampToScreen(x: number, y: number): { x: number; y: number } {
  const displays = screen.getAllDisplays()
  // 找中心点离目标最近的显示器
  let nearest = screen.getPrimaryDisplay()
  let bestDistance = Number.POSITIVE_INFINITY
  for (const d of displays) {
    const cx = d.workArea.x + d.workArea.width / 2
    const cy = d.workArea.y + d.workArea.height / 2
    const dist = (cx - (x + SIZE / 2)) ** 2 + (cy - (y + SIZE / 2)) ** 2
    if (dist < bestDistance) {
      bestDistance = dist
      nearest = d
    }
  }
  const area = nearest.workArea
  return {
    x: Math.min(Math.max(x, area.x + MARGIN), area.x + area.width - SIZE - MARGIN),
    y: Math.min(Math.max(y, area.y + MARGIN), area.y + area.height - SIZE - MARGIN)
  }
}

/** 初始/默认位置：主屏右上角 */
function defaultPosition(): { x: number; y: number } {
  const area = screen.getPrimaryDisplay().workArea
  return { x: area.x + area.width - SIZE - 20, y: area.y + 20 }
}

function loadPosition(): { x: number; y: number } {
  const saved = bubbleStore.get()
  if (saved.x < 0 || saved.y < 0) return defaultPosition()
  return clampToScreen(saved.x, saved.y)
}

function savePosition(x: number, y: number): void {
  bubbleStore.set({ x, y })
}

/** 当前壁纸 imageId（悬浮球与界面共用：历史最新一条） */
export function currentWallpaperImageId(): string | null {
  const latest = listHistory()[0]
  return latest ? latest.imageId : null
}

function createBubbleWindow(): void {
  const pos = loadPosition()
  bubbleWindow = new BrowserWindow({
    width: SIZE,
    height: SIZE,
    x: pos.x,
    y: pos.y,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false, // 拖动由渲染层位移 + setPosition 实现（避免与点击冲突）
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    show: false,
    focusable: false, // 点击不抢焦点
    hasShadow: false,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false
    }
  })

  bubbleWindow.setAlwaysOnTop(true, 'floating')
  if (process.platform === 'darwin') {
    // 跨空间常驻（全屏空间不显示，避免遮挡演示等场景）
    bubbleWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: false })
  }

  bubbleWindow.on('ready-to-show', () => {
    if (getSettings().bubbleEnabled) bubbleWindow?.show()
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    // 开发模式：dev server 多页面路由（vite 多入口为 bubble.html）
    void bubbleWindow.loadURL(`${process.env.ELECTRON_RENDERER_URL}/bubble.html`)
  } else {
    void bubbleWindow.loadFile(path.join(__dirname, '../renderer/bubble.html'))
  }

  bubbleWindow.webContents.on('before-input-event', (event, input) => {
    // 禁止悬浮球内的快捷键冒泡（如 Cmd+R 刷新）
    if (input.type === 'keyDown' && (input.meta || input.control)) event.preventDefault()
  })
}

/** 应用启动时初始化（窗口 + 显示器变化监听 + IPC） */
export function initBubble(onStateChange: () => void): void {
  stateChangeHandler = onStateChange
  createBubbleWindow()

  // 显示器分辨率/数量变化 → 拉回可见区域
  screen.on('display-metrics-changed', () => {
    if (!bubbleWindow || bubbleWindow.isDestroyed()) return
    const [x, y] = bubbleWindow.getPosition()
    const clamped = clampToScreen(x, y)
    if (clamped.x !== x || clamped.y !== y) bubbleWindow.setPosition(clamped.x, clamped.y, false)
    savePosition(clamped.x, clamped.y)
  })
  screen.on('display-removed', () => {
    if (!bubbleWindow || bubbleWindow.isDestroyed()) return
    const [x, y] = bubbleWindow.getPosition()
    const clamped = clampToScreen(x, y)
    bubbleWindow.setPosition(clamped.x, clamped.y, false)
    savePosition(clamped.x, clamped.y)
  })

  // 拖动位移（渲染层 mousemove 计算 delta）
  ipcMain.on(IPC.BUBBLE_MOVE_BY, (_e, dx: number, dy: number) => {
    if (!bubbleWindow || bubbleWindow.isDestroyed()) return
    const [x, y] = bubbleWindow.getPosition()
    // 拖动时放宽到虚拟屏幕范围（工作区联合），落点再由钳制兜底
    const nx = Math.round(x + dx)
    const ny = Math.round(y + dy)
    bubbleWindow.setPosition(nx, ny, false)
    savePosition(nx, ny)
  })

  // 右键菜单
  ipcMain.on(IPC.BUBBLE_CONTEXT_MENU, () => {
    const menu = Menu.buildFromTemplate([
      { label: '下一张壁纸', click: () => void nextSlideshowNow() },
      { label: '打开主界面', click: () => openMainHandler?.() },
      { type: 'separator' },
      { label: '隐藏悬浮球', click: () => setBubbleEnabled(false) }
    ])
    menu.popup({ window: bubbleWindow ?? undefined })
  })
}

/** 右键「打开主界面」回调注入（index.ts 调用并传 showMainWindow） */
export function onBubbleOpenMain(cb: () => void): void {
  openMainHandler = cb
}

/** 开关悬浮球（设置页 / 托盘共用） */
export function setBubbleEnabled(enabled: boolean): void {
  updateSettings({ bubbleEnabled: enabled })
  if (!bubbleWindow || bubbleWindow.isDestroyed()) {
    if (enabled) createBubbleWindow()
  } else {
    if (enabled) {
      const pos = loadPosition()
      bubbleWindow.setPosition(pos.x, pos.y, false)
      bubbleWindow.showInactive()
    } else {
      bubbleWindow.hide()
    }
  }
  stateChangeHandler?.()
}

export function isBubbleVisible(): boolean {
  return Boolean(getSettings().bubbleEnabled)
}

/** 壁纸变化时通知悬浮球刷新缩略图（recordApply 调用） */
export function notifyWallpaperChanged(imageId: string): void {
  broadcast(IPC_EVENTS.BUBBLE_UPDATE, { imageId })
}

export function flushBubble(): void {
  bubbleStore.flush()
}
