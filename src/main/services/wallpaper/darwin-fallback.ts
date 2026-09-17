// ==========【系统适配 - macOS】后备适配器：osascript 调用 System Events ==========
//
// 通过 AppleScript 操作 "System Events" 的 desktop 对象：
//   - 枚举：tell application "System Events" to get display name of every desktop
//   - 设置：tell application "System Events" to tell desktop N to set picture to POSIX file "..."
// 兼容 Ventura / Sonoma（多显示器 = 多个 desktop 对象，可独立设置）。
// 适用于 wallpaper 库异常时的一行切换兜底（darwin.ts 自动降级到这里）。

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { screen } from 'electron'
import type { MonitorInfo } from '@shared/types'

const execFileAsync = promisify(execFile)

async function osa(script: string): Promise<string> {
  const { stdout } = await execFileAsync('osascript', ['-e', script], { timeout: 15000 })
  return stdout.trim()
}

export function osascriptListMonitors(displays: Electron.Display[] = screen.getAllDisplays()): MonitorInfo[] {
  // desktop 对象顺序与 Electron displays 通常一一对应（主屏在前）
  return displays.map((display, index) => ({
    id: `darwin:${index}`,
    label: display.label || `显示器 ${index + 1}`,
    width: Math.round(display.bounds.width * display.scaleFactor),
    height: Math.round(display.bounds.height * display.scaleFactor),
    scaleFactor: display.scaleFactor,
    isMain: display.id === screen.getPrimaryDisplay().id
  }))
}

export async function osascriptSetWallpaper(filePath: string, monitorId?: string): Promise<void> {
  // AppleScript 字符串中的双引号需要转义
  const posix = filePath.replace(/"/g, '\\"')
  if (!monitorId || monitorId === 'all') {
    await osa(`tell application "System Events" to tell every desktop to set picture to POSIX file "${posix}"`)
  } else {
    const index = Number(monitorId.split(':')[1]) + 1 // AppleScript 索引从 1 开始
    await osa(`tell application "System Events" to tell desktop ${index} to set picture to POSIX file "${posix}"`)
  }
}
