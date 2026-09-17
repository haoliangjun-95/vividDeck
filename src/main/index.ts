/**
 * vividDeck 主进程入口
 * - 单实例锁（重复启动时聚焦已有窗口）
 * - 主窗口 + 系统托盘（关窗驻留，轮播不中断；托盘菜单：下一张 / 打开 / 退出）
 * - media:// 自定义协议：渲染层按图片 ID 安全加载缩略图/预览/原图
 * - 主题跟随系统（nativeTheme → 渲染层 html.dark）
 */
import { app, BrowserWindow, dialog, Menu, Tray, nativeTheme, net, protocol, shell, nativeImage } from 'electron'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { registerIpcHandlers } from './ipc'
import { initSlideshow, nextSlideshowNow, flushSlideshow } from './services/slideshow'
import { getSettings } from './services/settings'
import { customStorageDirMissing } from './services/paths'
import { flushLibrary } from './services/library'
import { flushHistory } from './services/history'
import { resolveMediaPath } from './media'
import { flushSyncConfig } from './services/sync/store'
import { flushSyncEngine, initSyncEngine, syncNow } from './services/sync/engine'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null

// ---------- 单实例锁 ----------
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => showMainWindow())
}

// ---------- media:// 协议（须在 app ready 前注册特权） ----------
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'media',
    privileges: { standard: false, secure: true, supportFetchAPI: false, stream: true }
  }
])

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 640,
    show: false,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#111118' : '#f6f6f8',
    title: 'vividDeck',
    webPreferences: {
      // ESM 格式 preload（Electron 28+ 支持，需 sandbox: false）
      preload: path.join(__dirname, '../preload/index.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false
    }
  })

  mainWindow.on('ready-to-show', () => mainWindow?.show())

  // 关闭 = 隐藏到托盘（轮播继续）；真正退出走托盘菜单 / Cmd+Q
  mainWindow.on('close', (event) => {
    if ((app as unknown as { __isQuitting?: boolean }).__isQuitting) return
    event.preventDefault()
    mainWindow?.hide()
  })

  // 开发环境加载 dev server，生产环境加载打包产物
  if (process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
}

function showMainWindow(): void {
  if (!mainWindow) {
    createWindow()
    return
  }
  if (!mainWindow.isVisible()) mainWindow.show()
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.focus()
}

/** 托盘"下一张"：直接调用轮播服务（配置了范围才有素材池） */
function trayNext(): void {
  void nextSlideshowNow().catch((err) => console.error('[tray] 下一张失败:', err))
}

function quitApp(): void {
  ;(app as unknown as { __isQuitting?: boolean }).__isQuitting = true
  app.quit()
}

// ---------- 系统托盘 ----------
function createTray(): void {
  // 16x16 模板图（base64 内嵌，避免开发/打包环境的资源路径差异；由 scripts/make-icons.cjs 生成）
  const TRAY_ICON_BASE64 =
    'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAACXBIWXMAAAsTAAALEwEAmpwYAAAAcklEQVR4nO3QMQqDUBBF0YOFvZ0guIUULsMunW4j4GKsspEsI5AdpBKSLo0mjcVv1E/AzguvmGHeLYaD3ahx/rec4oEnsnnXookVdPjO6VFgwAvlVjnHOxBMuAfzDcma4BocL+WyVK4wRgg+OMX+48A2P44OIzwF+DVVAAAAAElFTkSuQmCC'
  const icon = nativeImage.createFromBuffer(Buffer.from(TRAY_ICON_BASE64, 'base64'))
  icon.setTemplateImage(true)
  tray = new Tray(icon)
  tray.setToolTip('vividDeck 壁纸管理')

  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: '打开 vividDeck', click: () => showMainWindow() },
      { type: 'separator' },
      { label: '下一张壁纸', click: () => trayNext() },
      {
        label: '立即同步',
        click: () =>
          void syncNow().catch((err) => console.error('[tray] 同步失败:', err))
      },
      { type: 'separator' },
      { label: '退出', click: () => quitApp() }
    ])
  )
  // macOS 左键点击托盘 = 打开主窗口
  tray.on('click', () => showMainWindow())
}

// ---------- 应用菜单（macOS 必备基础菜单） ----------
function createAppMenu(): void {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: 'vividDeck',
      submenu: [
        { role: 'about', label: '关于 vividDeck' },
        { type: 'separator' },
        { role: 'hide', label: '隐藏' },
        { role: 'unhide', label: '显示全部' },
        { type: 'separator' },
        { label: '退出', accelerator: 'CmdOrCtrl+Q', click: () => quitApp() }
      ]
    },
    {
      label: '编辑',
      submenu: [
        { role: 'undo', label: '撤销' },
        { role: 'redo', label: '重做' },
        { type: 'separator' },
        { role: 'cut', label: '剪切' },
        { role: 'copy', label: '复制' },
        { role: 'paste', label: '粘贴' },
        { role: 'selectAll', label: '全选' }
      ]
    },
    {
      label: '视图',
      submenu: [
        { role: 'reload', label: '刷新' },
        { role: 'toggleDevTools', label: '开发者工具' },
        { type: 'separator' },
        { role: 'resetZoom', label: '重置缩放' },
        { role: 'zoomIn', label: '放大' },
        { role: 'zoomOut', label: '缩小' },
        { role: 'togglefullscreen', label: '全屏' }
      ]
    },
    { label: '窗口', submenu: [{ role: 'minimize', label: '最小化' }, { role: 'close', label: '关闭' }] }
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

// ---------- 生命周期 ----------
app.whenReady().then(() => {
  // 自定义存储目录不可用（如外置磁盘未挂载）：明确报错退出，
  // 避免回退默认目录后把"空库"覆盖写回，造成数据"消失"的错觉
  if (customStorageDirMissing()) {
    dialog.showErrorBox(
      '存储目录不可用',
      'vividDeck 的数据存储目录当前无法访问（若使用外置磁盘，请先挂载后重试）。\n\n可以在挂载后重新启动应用，或删除以下位置的 settings.json 中的 storageDir 项以恢复默认目录。'
    )
    app.exit(1)
    return
  }

  // media:// 协议处理：仅允许按图片 ID 访问素材库，杜绝任意文件读取
  protocol.handle('media', async (request) => {
    // 形如 media://thumb/<imageId>
    const match = /^media:\/\/(thumb|preview|original)\/([\w-]+)(?:\?.*)?$/.exec(request.url)
    if (!match) return new Response('Not Found', { status: 404 })
    const filePath = await resolveMediaPath(match[1] as 'thumb' | 'preview' | 'original', match[2])
    if (!filePath) return new Response('Not Found', { status: 404 })
    // pathToFileURL 正确处理中文/空格/特殊字符；net.fetch 返回带 MIME 的流式响应
    return net.fetch(pathToFileURL(filePath).toString())
  })

  nativeTheme.themeSource = getSettings().theme

  registerIpcHandlers()
  createAppMenu()
  createWindow()
  createTray()
  initSlideshow()
  initSyncEngine()

  app.on('activate', () => {
    // macOS 点击 Dock 图标重新显示窗口
    showMainWindow()
  })
})

app.on('before-quit', () => {
  // 标记真实退出：托盘菜单 / Cmd+Q / 外部 SIGTERM（logout 等）都会经过这里；
  // 未置标记时窗口 close 会被"隐藏到托盘"逻辑拦截，导致应用杀不死
  ;(app as unknown as { __isQuitting?: boolean }).__isQuitting = true
  // 退出前确保全部数据落盘
  flushLibrary()
  flushHistory()
  flushSlideshow()
  flushSyncConfig()
  flushSyncEngine()
})

// 托盘常驻：窗口全部关闭不退出应用（由托盘菜单或 Cmd+Q 退出）
app.on('window-all-closed', () => undefined)

// 外部链接统一交给系统浏览器打开
app.on('web-contents-created', (_event, contents) => {
  contents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http')) void shell.openExternal(url)
    return { action: 'deny' }
  })
})
