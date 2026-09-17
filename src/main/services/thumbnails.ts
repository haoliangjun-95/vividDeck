/**
 * 缩略图与大图预览服务（sharp）
 * - 缩略图：WebP，长边最大 512px，画廊网格加载用，大图轻量化不占内存
 * - 预览图：JPEG，长边最大 2560px，灯箱放大查看与裁剪取景用
 *   （HEIC 无法被 Chromium 直接渲染，统一由 sharp 转码为 JPEG 预览）
 * - 文件名携带内容哈希前 8 位，图片内容变化时自动失效重建
 */
import sharp from 'sharp'
import fs from 'node:fs'
import path from 'node:path'
import { previewDir, thumbDir } from './paths'
import type { ImageItem } from '@shared/types'

export function thumbPath(image: ImageItem): string {
  return path.join(thumbDir(), `${image.id}_${image.hash.slice(0, 8)}.webp`)
}

export function previewPath(image: ImageItem): string {
  return path.join(previewDir(), `${image.id}_${image.hash.slice(0, 8)}.jpg`)
}

/** 生成缩略图（已存在则直接复用缓存） */
export async function ensureThumb(image: ImageItem): Promise<string> {
  const target = thumbPath(image)
  if (fs.existsSync(target)) return target
  await sharp(image.path)
    .rotate() // 按 EXIF 方向自动摆正
    .resize(512, 512, { fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 82 })
    .toFile(target)
  return target
}

/** 生成灯箱/裁剪用预览图（已存在则直接复用缓存） */
export async function ensurePreview(image: ImageItem): Promise<string> {
  const target = previewPath(image)
  if (fs.existsSync(target)) return target
  await sharp(image.path)
    .rotate()
    .resize(2560, 2560, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 90 })
    .toFile(target)
  return target
}

/** 删除某图片的全部缓存（缩略图 + 预览） */
export function purgeCache(imageId: string): void {
  for (const dir of [thumbDir(), previewDir()]) {
    try {
      for (const name of fs.readdirSync(dir)) {
        if (name.startsWith(`${imageId}_`)) fs.unlinkSync(path.join(dir, name))
      }
    } catch {
      /* 目录不存在则忽略 */
    }
  }
}
