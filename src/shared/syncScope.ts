/**
 * 选择性同步范围判定（#9）：图片是否落在配置的同步范围内。
 * 范围只约束二进制原图与缩略图的上传/自动下载；元数据清单始终全量同步。
 * 纯函数（主进程同步引擎调用），断言见 tests/sync-scope.test.ts。
 */
import type { ImageItem, SmartAlbum, SyncScope } from './types'
import { matchAlbum } from './album'

/**
 * 判定图片是否在同步范围内。
 * - scope 缺失或类型未知（旧配置/异常数据）：一律视为全量，优雅降级
 * - categories：图片分类在选中集合内（未分类图片不在任何分类范围）
 * - albums：命中任一选中相册的智能规则；相册已删除则该规则自然失效
 */
export function imageInSyncScope(
  img: ImageItem,
  scope: SyncScope | undefined,
  albums: readonly SmartAlbum[]
): boolean {
  if (!scope || scope.type === 'all') return true
  if (scope.type === 'categories') {
    return img.categoryId !== null && scope.ids.includes(img.categoryId)
  }
  if (scope.type === 'albums') {
    return albums.some((a) => scope.ids.includes(a.id) && matchAlbum(img, a))
  }
  return true
}
