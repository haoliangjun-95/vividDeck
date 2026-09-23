/**
 * 智能相册匹配谓词（主进程轮播池与渲染层画廊共用，保证两处口径一致）
 * 规则内全部条件 AND 叠加；缺省项不参与过滤。
 */
import type { ImageItem, SmartAlbum } from './types'

interface MatchableImage {
  width: number
  height: number
  categoryId: string | null
  tags: string[]
  favorite: boolean
}

export function matchAlbum(img: MatchableImage, album: SmartAlbum): boolean {
  const r = album.rules
  if (r.favoriteOnly && !img.favorite) return false
  if (r.tagsAll && r.tagsAll.length > 0 && !r.tagsAll.every((t) => img.tags.includes(t))) return false
  if (r.tagsAny && r.tagsAny.length > 0 && !r.tagsAny.some((t) => img.tags.includes(t))) return false
  if (r.categoryIds && r.categoryIds.length > 0 && !(img.categoryId && r.categoryIds.includes(img.categoryId))) return false
  if (r.minWidth && img.width < r.minWidth) return false
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
