/**
 * 自动更新（electron-updater + GitHub Releases）：
 * - Windows：全自动——启动延迟检查、后台下载、就绪后提示重启安装
 *   （NSIS 未签名仅 SmartScreen 提示，不影响安装）
 * - macOS：半自动——未签名构建无法自动安装（Squirrel.Mac 强制要求代码签名），
 *   检测到新版本时弹窗引导跳转 Releases 页手动下载
 * - 手动检查：应用菜单「检查更新…」，结果弹窗；开发模式直接提示不支持
 * 发布流水线见 .github/workflows/release.yml（推 v* tag 自动构建并上传）
 */
import { app, dialog, shell } from 'electron'
// electron-updater 为 CJS 包：具名导入在 ESM 主进程会抛
// "Named export 'autoUpdater' not found"，必须默认导入后解构
import updaterPkg from 'electron-updater'

const { autoUpdater } = updaterPkg as typeof import('electron-updater')

const RELEASES_URL = 'https://github.com/haoliangjun-95/vividDeck/releases/latest'
/** 启动后延迟检查：避开启动高峰（db 迁移/快照/同步） */
const STARTUP_CHECK_DELAY_MS = 30_000

/** 手动检查标志：静默的启动检查不弹"已是最新"，手动检查要给结果 */
let manualCheck = false

function markQuitting(): void {
  ;(app as unknown as { __isQuitting?: boolean }).__isQuitting = true
}

export function initUpdater(): void {
  if (!app.isPackaged) return
  autoUpdater.autoDownload = process.platform === 'win32'
  autoUpdater.autoInstallOnAppQuit = process.platform === 'win32'
  autoUpdater.logger = console

  autoUpdater.on('update-available', (info) => {
    if (process.platform === 'darwin') {
      void dialog
        .showMessageBox({
          type: 'info',
          title: '发现新版本',
          message: `vividDeck ${info.version} 已发布`,
          detail: '当前 macOS 构建未签名，无法自动安装，请前往发布页下载新版 dmg。',
          buttons: ['前往下载', '稍后'],
          defaultId: 0
        })
        .then((r) => {
          if (r.response === 0) void shell.openExternal(RELEASES_URL)
        })
    }
    // Windows：autoDownload 生效，下载完成走 update-downloaded
  })

  autoUpdater.on('update-not-available', () => {
    if (manualCheck) {
      manualCheck = false
      void dialog.showMessageBox({
        type: 'info',
        title: '检查更新',
        message: '已是最新版本',
        buttons: ['好']
      })
    }
  })

  autoUpdater.on('update-downloaded', (info) => {
    void dialog
      .showMessageBox({
        type: 'info',
        title: '更新已就绪',
        message: `${info.version} 已下载完成，重启后安装。`,
        buttons: ['立即重启', '稍后'],
        defaultId: 0
      })
      .then((r) => {
        if (r.response === 0) {
          markQuitting()
          app.relaunch()
          app.exit(0)
        }
      })
  })

  autoUpdater.on('error', (err) => {
    console.error('[updater] 检查更新失败:', err)
    if (manualCheck) {
      manualCheck = false
      void dialog.showMessageBox({
        type: 'warning',
        title: '检查更新',
        message: '检查更新失败（网络问题或发布配置未就绪）',
        detail: err.message,
        buttons: ['好']
      })
    }
  })

  setTimeout(
    () => void autoUpdater.checkForUpdates().catch(() => undefined),
    STARTUP_CHECK_DELAY_MS
  ).unref?.()
}

/** 菜单「检查更新…」入口（开发模式提示不支持） */
export function checkForUpdatesManually(): void {
  if (!app.isPackaged) {
    void dialog.showMessageBox({
      type: 'info',
      title: '检查更新',
      message: '开发模式不支持检查更新（发布构建生效）',
      buttons: ['好']
    })
    return
  }
  manualCheck = true
  void autoUpdater.checkForUpdates().catch(() => undefined)
}
