/**
 * 缓存清理服务（#8）：缩略图/预览孤儿清理 + 预渲染缓存整体再生 + 占用统计。
 * 孤儿 = 与库中任何图片"当前精确文件名"不匹配的缓存文件，
 * 同时覆盖已删图片残留与图片编辑后的旧哈希版本。
 * 只动应用命名格式的文件，未知文件（.DS_Store 等）一律保留。
 * 纯识别逻辑（findOrphanCacheFiles / isAppliedCacheFile）断言见 tests/cache-clean.test.ts。
 */
import fs from 'node:fs'
import path from 'node:path'
import { appliedDir, dirSize, previewDir, thumbDir } from './paths'
import { previewPath, thumbPath } from './thumbnails'
import { getLibrary } from './library'

/** 缩略图/预览命名：`<id: 小写字母数字>_<sha1 前 8 位>.<webp|jpg>`（见 thumbnails.ts） */
const CACHE_NAME_PATTERN = /^[0-9a-z]+_[0-9a-f]{8}\.(webp|jpg)$/

/** 预渲染缓存命名：`<sha1 前 16 位>.jpg`（见 wallpaper/prerender.ts，纯派生可整体再生） */
const APPLIED_NAME_PATTERN = /^[0-9a-f]{16}\.jpg$/

export interface CleanCacheResult {
  /** 实际删除的文件数 */
  removed: number
  /** 释放字节数 */
  freedBytes: number
  /** 清理后缓存占用字节数（thumbnails + previews + applied） */
  cacheBytes: number
}

/** 规范命名且不在有效集合内的文件判为孤儿；未知命名一律保留 */
export function findOrphanCacheFiles(
  names: readonly string[],
  validNames: ReadonlySet<string>
): string[] {
  return names.filter((n) => CACHE_NAME_PATTERN.test(n) && !validNames.has(n))
}

/** applied/ 下的预渲染缓存文件（可随时删除，设置壁纸时自动重建） */
export function isAppliedCacheFile(name: string): boolean {
  return APPLIED_NAME_PATTERN.test(name)
}

/** 当前缓存总占用（thumbnails + previews + applied） */
export async function cacheSize(): Promise<number> {
  return (await dirSize(thumbDir())) + (await dirSize(previewDir())) + (await dirSize(appliedDir()))
}

/** 执行清理：孤儿缩略图/预览 + 全部预渲染缓存；目录不存在或文件占用中均静默跳过 */
export async function cleanCache(): Promise<CleanCacheResult> {
  const valid = new Set<string>()
  for (const img of getLibrary().images) {
    valid.add(path.basename(thumbPath(img)))
    valid.add(path.basename(previewPath(img)))
  }

  let removed = 0
  let freedBytes = 0

  const removeFile = async (full: string): Promise<void> => {
    try {
      const st = await fs.promises.stat(full)
      await fs.promises.unlink(full)
      removed += 1
      freedBytes += st.size
    } catch {
      /* 文件已消失或被占用：跳过 */
    }
  }

  for (const dir of [thumbDir(), previewDir()]) {
    let names: string[]
    try {
      names = await fs.promises.readdir(dir)
    } catch {
      continue // 目录不存在
    }
    for (const name of findOrphanCacheFiles(names, valid)) {
      await removeFile(path.join(dir, name))
    }
  }

  try {
    const applied = await fs.promises.readdir(appliedDir())
    for (const name of applied.filter(isAppliedCacheFile)) {
      await removeFile(path.join(appliedDir(), name))
    }
  } catch {
    /* 目录不存在 */
  }

  return { removed, freedBytes, cacheBytes: await cacheSize() }
}
