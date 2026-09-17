/** 渲染层通用小工具 */
import type { ImageItem } from '@shared/types'

/** media:// 协议 URL */
export function mediaUrl(kind: 'thumb' | 'preview' | 'original', imageId: string): string {
  return `media://${kind}/${imageId}`
}

/** 文件大小人性化显示 */
export function formatBytes(bytes: number): string {
  if (!bytes) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)))
  return `${(bytes / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}

/** 分辨率显示：3840 x 2160 */
export function formatResolution(image: Pick<ImageItem, 'width' | 'height'>): string {
  return image.width && image.height ? `${image.width} × ${image.height}` : '未知'
}

/** 时间显示 */
export function formatTime(ts: number): string {
  const d = new Date(ts)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** 格式名转大写展示（heic → HEIC） */
export function formatLabel(format: string): string {
  return format === 'jpeg' ? 'JPG' : format.toUpperCase()
}
