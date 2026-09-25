/**
 * 远端墓碑保险丝（清单 #10）：纯远端墓碑删除统计与阈值判定纯函数。
 * 防止一台被攻破/故障设备批量删除并发布墓碑，把其他设备的全库清空；
 * 触发阈值时同步暂停合并、保留同步前状态，等待用户确认。
 * 夹具全合成（tests/helpers.ts），时间为 epoch 毫秒数值。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import {
  FUSE_MAX_COUNT,
  FUSE_MIN_COUNT,
  remoteOnlyDeletions,
  tombstoneFuseTripped
} from '@shared/syncFuse'
import type { ImageItem, SyncManifest, SyncTombstone } from '@shared/types'
import { makeImage, makeManifest, resetSeq } from './helpers'

function tomb(id: string, overrides: Partial<SyncTombstone> = {}): SyncTombstone {
  return { id, kind: 'image', deletedAt: 2000, deletedBy: 'dev-B', ...overrides }
}

function manifestWith(tombstones: SyncTombstone[]): SyncManifest {
  return makeManifest([], { tombstones })
}

describe('remoteOnlyDeletions 纯远端墓碑命中统计', () => {
  beforeEach(resetSeq)

  it('无远端清单时返回空', () => {
    const imgs: ImageItem[] = [makeImage(), makeImage()]
    expect(remoteOnlyDeletions(imgs, [tomb(imgs[0].id)], [])).toEqual([])
  })

  it('本地已知的删除（本地墓碑存在同 id）不计入纯远端', () => {
    const a = makeImage()
    const b = makeImage()
    const localTombs = [tomb(a.id, { deletedBy: 'dev-A' })]
    const remote = [manifestWith([tomb(a.id), tomb(b.id)])]
    expect(remoteOnlyDeletions([a, b], localTombs, remote)).toEqual([b.id])
  })

  it('只统计本地存活的图片：远端墓碑指向本地不存在的 id 时忽略', () => {
    const a = makeImage()
    const remote = [manifestWith([tomb(a.id), tomb('img-ghost')])]
    expect(remoteOnlyDeletions([a], [], remote)).toEqual([a.id])
  })

  it('多份远端清单的墓碑合并统计（去重）', () => {
    const a = makeImage()
    const b = makeImage()
    const remote = [manifestWith([tomb(a.id)]), manifestWith([tomb(b.id), tomb(a.id)])]
    expect(remoteOnlyDeletions([a, b], [], remote).sort()).toEqual([a.id, b.id].sort())
  })
})

describe('tombstoneFuseTripped 阈值判定', () => {
  it('零删除或空库不触发', () => {
    expect(tombstoneFuseTripped(100, 0)).toBe(false)
    expect(tombstoneFuseTripped(0, 0)).toBe(false)
  })

  it('低于最小绝对数不触发（小库少量删除即使占比高也不误报）', () => {
    expect(tombstoneFuseTripped(5, 2)).toBe(false) // 40% 但仅 2 条
    expect(tombstoneFuseTripped(100, FUSE_MIN_COUNT - 1)).toBe(false)
  })

  it('达到最小条数且占比超过红线时触发', () => {
    expect(tombstoneFuseTripped(50, FUSE_MIN_COUNT)).toBe(true) // 10/50 = 20% > 10%
    expect(tombstoneFuseTripped(100, FUSE_MIN_COUNT + 1)).toBe(true) // 11%
  })

  it('占比恰好等于红线不触发（严格大于）', () => {
    expect(tombstoneFuseTripped(100, FUSE_MIN_COUNT)).toBe(false) // 10/100 = 10%
  })

  it('绝对红线：达到 FUSE_MAX_COUNT 条即触发，不论占比多低', () => {
    expect(tombstoneFuseTripped(100000, FUSE_MAX_COUNT)).toBe(true) // 0.2%
    expect(tombstoneFuseTripped(1000, 50)).toBe(false) // 5% 且 < 200 条
  })
})
