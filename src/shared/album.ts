/**
 * 智能相册匹配谓词（主进程轮播池与渲染层画廊共用，保证两处口径一致）
 * 规则内全部条件 AND 叠加；缺省项不参与过滤。
 */
import type { SmartAlbum } from './types'

interface MatchableImage {
  width: number
  height: number
  categoryId: string | null
  tags: string[]
  favorite: boolean
  /** 拍摄时间（EXIF，epoch 毫秒）；未知为 null/undefined */
  takenAt?: number | null
  /** 文件名（keyword 规则用；缺省跳过文件名匹配） */
  fileName?: string
  /** 文件字节数（大小范围规则用；缺省跳过该规则） */
  sizeBytes?: number
}

export function matchAlbum(img: MatchableImage, album: SmartAlbum): boolean {
  const r = album.rules
  if (r.favoriteOnly && !img.favorite) return false
  if (r.tagsAll && r.tagsAll.length > 0 && !r.tagsAll.every((t) => img.tags.includes(t)))
    return false
  if (r.tagsAny && r.tagsAny.length > 0 && !r.tagsAny.some((t) => img.tags.includes(t)))
    return false
  if (
    r.categoryIds &&
    r.categoryIds.length > 0 &&
    !(img.categoryId && r.categoryIds.includes(img.categoryId))
  )
    return false
  if (r.minWidth && img.width < r.minWidth) return false
  // 关键词：文件名或任一标签包含（不区分大小写）
  if (r.keyword && r.keyword.trim()) {
    const kw = r.keyword.trim().toLowerCase()
    const inName = img.fileName !== undefined && img.fileName.toLowerCase().includes(kw)
    const inTags = img.tags.some((t) => t.toLowerCase().includes(kw))
    if (!inName && !inTags) return false
  }
  // 文件大小范围（MB；记录缺字节数时跳过，防误杀）
  if ((r.minSizeMB || r.maxSizeMB) && typeof img.sizeBytes === 'number') {
    if (r.minSizeMB && img.sizeBytes < r.minSizeMB * 1024 * 1024) return false
    if (r.maxSizeMB && img.sizeBytes > r.maxSizeMB * 1024 * 1024) return false
  }
  // 拍摄日期范围（闭区间）：设置了任一边界时，无拍摄时间的图不匹配
  if (r.takenFrom !== undefined || r.takenTo !== undefined) {
    if (img.takenAt === null || img.takenAt === undefined) return false
    if (r.takenFrom !== undefined && img.takenAt < r.takenFrom) return false
    if (r.takenTo !== undefined && img.takenAt > r.takenTo) return false
  }
  if (r.orientation) {
    const landscape = img.width >= img.height
    if (r.orientation === 'landscape' && !landscape) return false
    if (r.orientation === 'portrait' && landscape) return false
  }
  if ((r.minAspect || r.maxAspect) && img.width > 0 && img.height > 0) {
    const aspect = img.width / img.height
    if (r.minAspect && aspect < r.minAspect) return false
    if (r.maxAspect && aspect > r.maxAspect) return false
  }
  return true
}

export function matchAlbums(img: MatchableImage, albums: SmartAlbum[]): string[] {
  return albums.filter((a) => matchAlbum(img, a)).map((a) => a.id)
}
