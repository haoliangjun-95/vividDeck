// ==========【系统适配 - macOS】主适配器：复用 wallpaper 开源库 ==========
//
// 复用 sindresorhus/wallpaper（MIT，内部为编译好的原生二进制）：
//   - screens()       枚举显示器
//   - setWallpaper()  单屏 / 全部屏设置壁纸，兼容 Ventura / Sonoma
//
// 说明：
//   - wallpaper 为 ESM-only 包且带原生二进制，因此通过动态 import 加载，
//     并由 electron-builder 的 asarUnpack 释放二进制（见 electron-builder.yml）。
//   - 修改桌面壁纸在 macOS 上无需额外 TCC 权限（无"自动化"授权弹窗）。
//   - 若库在新系统版本上异常，自动切换 osascript 后备实现（darwin-fallback.ts）。

import { screen } from 'electron'
import type { MonitorInfo } from '@shared/types'
import { osascriptListMonitors, osascriptSetWallpaper } from './darwin-fallback'

/** wallpaper 库的动态类型（仅声明用到的方法） */
interface WallpaperLib {
  screens(): Promise<string[]>
  setWallpaper(path: string, options?: { screen?: number | 'all' }): Promise<void>
}

let cachedLib: WallpaperLib | null = null
/** 后备开关：主适配器失败一次后本次会话内直接走 osascript */
let useFallback = false

async function loadLib(): Promise<WallpaperLib> {
  if (!cachedLib) {
    // 动态 import：wallpaper 是 ESM-only，从 CJS 主进程加载需走动态导入
    cachedLib = (await import('wallpaper')) as unknown as WallpaperLib
  }
  return cachedLib
}

/** 枚举显示器：Electron display 信息（分辨率/DPI）+ 库的屏幕索引 */
export async function listMonitors(): Promise<MonitorInfo[]> {
  const displays = screen.getAllDisplays()
  if (useFallback) return osascriptListMonitors(displays)
  try {
    const lib = await loadLib()
    const names = await lib.screens()
    // 库返回的顺序即 setWallpaper({screen: index}) 使用的索引；
    // 展示名与 Electron display.label 匹配（匹配不上则按顺序对齐）
    return names.map((name, index) => {
      const display =
        displays.find((d) => d.label === name) ??
        displays.find((d) => d.id === index) ??
        displays[index]
      return {
        id: `darwin:${index}`,
        label: name || display?.label || `显示器 ${index + 1}`,
        width: Math.round((display?.bounds.width ?? 1920) * (display?.scaleFactor ?? 1)),
        height: Math.round((display?.bounds.height ?? 1080) * (display?.scaleFactor ?? 1)),
        scaleFactor: display?.scaleFactor ?? 1,
        isMain: display ? display.id === screen.getPrimaryDisplay().id : index === 0
      }
    })
  } catch (err) {
    console.error('[wallpaper/darwin] wallpaper 库枚举失败，切换 osascript 后备:', err)
    useFallback = true
    return osascriptListMonitors(displays)
  }
}

/** 设置壁纸：monitorId 为空表示所有屏 */
export async function setWallpaper(filePath: string, monitorId?: string): Promise<void> {
  if (useFallback) return osascriptSetWallpaper(filePath, monitorId)
  try {
    const lib = await loadLib()
    if (!monitorId || monitorId === 'all') {
      await lib.setWallpaper(filePath, { screen: 'all' })
      return
    }
    const index = Number(monitorId.split(':')[1])
    await lib.setWallpaper(filePath, { screen: index })
  } catch (err) {
    console.error('[wallpaper/darwin] wallpaper 库设置失败，切换 osascript 后备重试:', err)
    useFallback = true
    return osascriptSetWallpaper(filePath, monitorId)
  }
}
