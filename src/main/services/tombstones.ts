/**
 * 删除墓碑（多设备同步）
 * 本地删除图片/分类时写入墓碑；同步引擎把墓碑传到远端 manifest，
 * 其他设备据此删除对应记录。墓碑保留 90 天，过期由任一设备清理。
 */
import type { SyncTombstone } from '@shared/types'
import { JsonStore } from './store'
import { getDeviceId } from './device'

const TOMBSTONE_TTL_MS = 90 * 24 * 3600 * 1000

const tombstoneStore = new JsonStore<{ items: SyncTombstone[] }>('tombstones', { items: [] })

export function addTombstone(id: string, kind: SyncTombstone['kind']): void {
  const items = [
    ...tombstoneStore.get().items.filter((t) => t.id !== id),
    { id, kind, deletedAt: Date.now(), deletedBy: getDeviceId() }
  ]
  tombstoneStore.replace({ items })
  tombstoneStore.flush()
}

export function listTombstones(): SyncTombstone[] {
  return tombstoneStore.get().items
}

/** 本地记录是否已被墓碑删除 */
export function isTombstoned(id: string): boolean {
  return tombstoneStore.get().items.some((t) => t.id === id)
}

/** 丢弃墓碑（远端已确认或过期清理） */
export function removeTombstones(ids: string[]): void {
  const set = new Set(ids)
  tombstoneStore.replace({ items: tombstoneStore.get().items.filter((t) => !set.has(t.id)) })
  tombstoneStore.flush()
}

/** 整体替换墓碑集合（同步引擎合并后落地） */
export function replaceTombstones(items: SyncTombstone[]): void {
  tombstoneStore.replace({ items })
  tombstoneStore.flush()
}

/** 清理过期墓碑（合并阶段调用；返回被清理的 id 供远端同步） */
export function pruneExpiredTombstones(): string[] {
  const cutoff = Date.now() - TOMBSTONE_TTL_MS
  const keep: SyncTombstone[] = []
  const removed: string[] = []
  for (const t of tombstoneStore.get().items) {
    if (t.deletedAt < cutoff) removed.push(t.id)
    else keep.push(t)
  }
  if (removed.length > 0) {
    tombstoneStore.replace({ items: keep })
    tombstoneStore.flush()
  }
  return removed
}
