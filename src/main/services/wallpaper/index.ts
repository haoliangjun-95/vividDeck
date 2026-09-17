/**
 * 壁纸设置统一入口（平台分发层）
 *
 * 调用链：applyWallpaper()
 *   1. 查询目标显示器物理分辨率
 *   2. prerenderFill() 按填充模式预渲染（跨平台共用，保证双端一致）
 *   3. 分发到对应平台适配器：
 *        darwin.ts  ——【系统适配 - macOS】wallpaper 库（osascript 后备）
 *        win32.ts   ——【系统适配 - Windows】IDesktopWallpaper COM（SPI 后备）
 *   4. 成功后写入壁纸历史
 */
import fs from 'node:fs'
import type { FillMode, MonitorInfo } from '@shared/types'
import { prerenderFill } from './prerender'
import * as darwin from './darwin'
import * as win32 from './win32'

export type WallpaperResult = { applied: string[] }

export async function listMonitors(): Promise<MonitorInfo[]> {
  return process.platform === 'darwin' ? darwin.listMonitors() : win32.listMonitors()
}

/**
 * 设置壁纸（历史记录由调用方写入，见 ipc.ts / slideshow.ts）
 * @param imagePath 图片绝对路径（原图，未预渲染）
 * @param monitorIds 目标显示器 ID 列表；空数组 = 全部显示器
 * @param fillMode 填充模式
 */
export async function applyWallpaper(
  imagePath: string,
  monitorIds: string[],
  fillMode: FillMode
): Promise<WallpaperResult> {
  if (!fs.existsSync(imagePath)) throw new Error(`文件不存在：${imagePath}`)

  const monitors = await listMonitors()
  // 过滤掉当前已不存在的显示器（拔掉的外接屏等场景自动跳过）
  const targets = monitorIds.length
    ? monitors.filter((m) => monitorIds.includes(m.id))
    : monitors
  if (targets.length === 0) throw new Error('未找到可用的显示器')

  const applied: string[] = []
  let lastError: string | undefined

  for (const monitor of targets) {
    try {
      // 关键：按每台显示器的物理分辨率分别预渲染，多屏不同分辨率各自吻合
      const rendered = await prerenderFill(imagePath, monitor.width, monitor.height, fillMode)
      if (process.platform === 'darwin') {
        await darwin.setWallpaper(rendered, monitor.id)
      } else {
        await win32.setWallpaper(rendered, monitor.id, fillMode)
      }
      applied.push(monitor.id)
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err)
      console.error(`[wallpaper] 设置显示器 ${monitor.label} 失败:`, err)
    }
  }

  if (applied.length === 0) throw new Error(lastError || '壁纸设置失败')
  return { applied }
}
