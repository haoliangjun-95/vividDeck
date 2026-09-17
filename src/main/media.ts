/**
 * media:// 协议的路径解析辅助
 * 渲染层只能通过图片 ID 访问缓存/原图，无法读取任意路径（安全边界）
 * - 缩略图/预览图按需生成（懒加载），避免批量导入时全量生成卡顿
 * - 二期：云端图片（localFile=false）自动按需下载 —— 原图/预览触发 ensureLocal，
 *   缩略图缺失时优先从远端拉取（~30KB，新设备画廊秒开）
 */
import fs from 'node:fs'
import path from 'node:path'
import { getLibrary } from './services/library'
import { ensurePreview, ensureThumb, previewPath, thumbPath } from './services/thumbnails'
import { ensureLocal } from './services/sync/engine'
import { getSyncConfig, hasSecret } from './services/sync/store'

function syncReady(): boolean {
  const cfg = getSyncConfig()
  return cfg.enabled && cfg.endpoint !== '' && hasSecret()
}

/**
 * 解析 media:// 请求对应的本地文件路径（必要时生成/下载缓存）
 * @returns 文件绝对路径；图片不存在或生成失败返回 null（→ 404）
 */
export async function resolveMediaPath(kind: 'thumb' | 'preview' | 'original', imageId: string): Promise<string | null> {
  const image = getLibrary().images.find((img) => img.id === imageId)
  if (!image) return null
  try {
    if (kind === 'thumb') {
      const local = thumbPath(image)
      if (fs.existsSync(local)) return local
      // 本地无缩略图且文件在云端：尝试从远端拉缩略图（小文件，画廊秒开）
      if (!image.localFile && syncReady()) {
        const { loadSecret } = await import('./services/sync/store')
        const { createClient, downloadFile } = await import('./services/sync/client')
        const cfg = getSyncConfig()
        await downloadFile(createClient(cfg, loadSecret()), cfg.bucket, `thumbs/${path.basename(local)}`, local)
        return local
      }
      return (await ensureThumb(image)) || local
    }
    if (kind === 'preview') {
      // 预览依赖本地原图：云端图先触发按需下载
      if (!image.localFile && syncReady()) await ensureLocal(imageId)
      const p = previewPath(image)
      return (await ensurePreview(image)) || p
    }
    // original：本地无文件时按需下载（灯箱/裁剪/设壁纸共用此路径）
    if (!image.localFile || !fs.existsSync(image.path)) {
      if (syncReady()) await ensureLocal(imageId)
      else return null
    }
    return image.path
  } catch (err) {
    console.error(`[media] ${kind} 解析失败 (${image.fileName}):`, err)
    return null
  }
}
