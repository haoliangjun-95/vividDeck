/**
 * 远端墓碑保险丝（#10）：纯函数模块，同步引擎（主进程）与确认 UI（渲染层）共用口径。
 * 单次同步中「纯远端墓碑」导致的删除超过阈值时暂停合并、保留同步前状态，
 * 等待用户确认，防止一台被攻破/故障设备批量删除后清空其他设备的全库。
 * 断言见 tests/tombstone-fuse.test.ts。
 */
import type { ImageItem, SyncManifest, SyncTombstone } from './types'

/** 保险丝生效的最小绝对条数：低于该值即使占比超标也不触发（小库少量删除防误报） */
export const FUSE_MIN_COUNT = 10
/** 占比红线：纯远端删除数 / 本地图片总数 严格大于该值（且条数达标）时触发 */
export const FUSE_RATIO = 0.1
/** 绝对红线：纯远端删除数达到该值即触发，不论占比多低 */
export const FUSE_MAX_COUNT = 200

/**
 * 列出会被「纯远端墓碑」删除的本地存活图片 id。
 * 纯远端墓碑 = 出现在任一远端清单、且本地墓碑中不存在同 id（本地对这次删除毫不知情）。
 * 本地自己发起的删除会同时存在于本地墓碑，天然不计入。
 */
export function remoteOnlyDeletions(
  localImages: readonly ImageItem[],
  localTombstones: readonly SyncTombstone[],
  remoteManifests: readonly SyncManifest[]
): string[] {
  const knownDead = new Set(localTombstones.map((t) => t.id))
  const remoteDead = new Set<string>()
  for (const m of remoteManifests) {
    for (const t of m.tombstones) {
      if (!knownDead.has(t.id)) remoteDead.add(t.id)
    }
  }
  if (remoteDead.size === 0) return []
  return localImages.filter((img) => remoteDead.has(img.id)).map((img) => img.id)
}

/** 保险丝判定：true = 触发（暂停合并，保留同步前状态，要求用户确认后以 force 重跑） */
export function tombstoneFuseTripped(localCount: number, deletedCount: number): boolean {
  if (deletedCount >= FUSE_MAX_COUNT) return true
  if (deletedCount < FUSE_MIN_COUNT || localCount <= 0) return false
  return deletedCount / localCount > FUSE_RATIO
}
