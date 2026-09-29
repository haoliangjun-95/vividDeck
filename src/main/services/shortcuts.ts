/**
 * 全局快捷键（系统级，应用不在前台也生效）：
 * Alt+Cmd/Ctrl+Right = 下一张壁纸（调用轮播服务，等价托盘"下一张"）
 * 设置页可开关（默认关，避免占用用户已有快捷键）；重复注册安全（先注销）
 */
import { globalShortcut } from 'electron'

const NEXT_WALLPAPER_ACCEL = 'Alt+CommandOrControl+Right'
let registered = false

export function initShortcuts(enabled: boolean): void {
  if (registered) {
    globalShortcut.unregister(NEXT_WALLPAPER_ACCEL)
    registered = false
  }
  if (!enabled) return
  const ok = globalShortcut.register(NEXT_WALLPAPER_ACCEL, () => {
    // 动态 import：不把轮播服务拉进本模块的静态依赖链（保持薄 bootstrap）
    void import('./slideshow')
      .then((m) => m.nextSlideshowNow())
      .catch((err) => console.error('[shortcuts] 下一张失败:', err))
  })
  if (ok) {
    registered = true
    console.log(`[shortcuts] 已注册 ${NEXT_WALLPAPER_ACCEL} = 下一张壁纸`)
  } else {
    console.warn(`[shortcuts] ${NEXT_WALLPAPER_ACCEL} 注册失败（已被其他应用占用）`)
  }
}
