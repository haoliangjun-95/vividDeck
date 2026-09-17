/**
 * media:// 协议的路径解析辅助
 * 渲染层只能通过图片 ID 访问缓存/原图，无法读取任意路径（安全边界）
 * 缩略图/预览图按需生成（懒加载），避免批量导入时全量生成卡顿
 */
import { getLibrary } from './services/library'
import { ensurePreview, ensureThumb, previewPath, thumbPath } from './services/thumbnails'

/**
 * 解析 media:// 请求对应的本地文件路径（必要时生成缓存）
 * @returns 文件绝对路径；图片不存在或生成失败返回 null（→ 404）
 */
export async function resolveMediaPath(kind: 'thumb' | 'preview' | 'original', imageId: string): Promise<string | null> {
  const image = getLibrary().images.find((img) => img.id === imageId)
  if (!image) return null
  try {
    if (kind === 'thumb') {
      const p = thumbPath(image)
      // 已有缓存直接返回，否则现场生成
      return (await ensureThumb(image)) || p
    }
    if (kind === 'preview') {
      const p = previewPath(image)
      return (await ensurePreview(image)) || p
    }
    return image.path
  } catch (err) {
    console.error(`[media] ${kind} 生成失败 (${image.fileName}):`, err)
    return null
  }
}
