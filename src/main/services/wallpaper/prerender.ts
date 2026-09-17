/**
 * 填充模式预渲染（sharp，跨平台共用）
 *
 * 双端统一填充效果的关键：macOS 与 Windows 都没有既统一又可靠的
 * "填充样式"设置接口（macOS 无公开 API 修改填充样式；Windows 的
 * SetPosition 各版本表现不一），因此统一策略为——
 *   按目标显示器的【物理分辨率】把原图预渲染为像素级吻合的新图，
 *   再交给各平台 API 设为壁纸，视觉表现与"填充模式"定义完全一致。
 *
 * 输出统一为 JPEG：规避 Windows 不支持 WebP/HEIC 壁纸的问题。
 */
import sharp from 'sharp'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import type { FillMode } from '@shared/types'
import { appliedDir } from '../paths'

/**
 * 预渲染：按填充模式把原图适配到 width x height
 * - fill    铺满：等比缩放至覆盖全屏，居中裁掉超出部分
 * - stretch 拉伸：强制拉伸到屏幕尺寸（可能变形）
 * - center  居中：原尺寸（过大时等比缩小）置于黑色画布中央
 * - fit     适应：等比缩放至完整可见，黑色补边
 */
export async function prerenderFill(
  srcPath: string,
  width: number,
  height: number,
  mode: FillMode
): Promise<string> {
  // 缓存键 = 源文件 + 参数 的哈希，同一图同一模式只渲染一次
  const key = crypto
    .createHash('sha1')
    .update(`${srcPath}|${width}x${height}|${mode}`)
    .digest('hex')
    .slice(0, 16)
  const target = path.join(appliedDir(), `${key}.jpg`)
  if (fs.existsSync(target)) return target

  const input = sharp(srcPath).rotate() // 按 EXIF 摆正
  let pipeline: sharp.Sharp

  switch (mode) {
    case 'fill':
      pipeline = input.resize(width, height, { fit: 'cover', position: 'centre' })
      break
    case 'stretch':
      pipeline = input.resize(width, height, { fit: 'fill' })
      break
    case 'center':
      // 原尺寸居中；原图大于屏幕时等比缩小到可容纳，但不放大小图
      pipeline = input.resize(width, height, {
        fit: 'inside',
        withoutEnlargement: true
      })
      break
    case 'fit':
      pipeline = input.resize(width, height, { fit: 'contain', background: '#000000' })
      break
    default:
      pipeline = input
  }

  if (mode === 'center' || mode === 'fit') {
    // 居中/适应需要先得到缩放后的实际尺寸，再扩展到全屏画布
    const meta = await pipeline.clone().toBuffer({ resolveWithObject: true })
    pipeline = sharp(meta.data).extend({
      top: Math.floor((height - meta.info.height) / 2),
      bottom: height - meta.info.height - Math.floor((height - meta.info.height) / 2),
      left: Math.floor((width - meta.info.width) / 2),
      right: width - meta.info.width - Math.floor((width - meta.info.width) / 2),
      background: '#000000'
    })
  }

  await pipeline.jpeg({ quality: 95 }).toFile(target)
  return target
}
