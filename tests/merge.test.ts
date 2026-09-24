/**
 * sync/merge.ts —— LWW / 墓碑 / 同 hash 去重 / 分类相册合并 / 发布幂等（清单 #12）
 * 纯函数测试：不触磁盘与网络，全部合成夹具。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { mergeAll, toRecord } from '@main/services/sync/merge'
import type { MergeInput } from '@main/services/sync/merge'
import type { Category, SmartAlbum, SyncTombstone } from '@shared/types'
import { makeImage, makeManifest, makeRecord, resetSeq } from './helpers'

function input(overrides: Partial<MergeInput> = {}): MergeInput {
  return {
    localImages: [],
    localCategories: [],
    localAlbums: [],
    localTombstones: [],
    remoteManifests: [],
    ...overrides
  }
}

function cat(id: string, name: string, overrides: Partial<Category> = {}): Category {
  return { id, name, createdAt: 0, updatedAt: 1000, ...overrides }
}

function tomb(
  id: string,
  deletedAt: number,
  overrides: Partial<SyncTombstone> = {}
): SyncTombstone {
  return { id, kind: 'image', deletedAt, deletedBy: 'dev-A', ...overrides }
}

function album(id: string, name: string, updatedAt: number): SmartAlbum {
  return { id, name, rules: {}, createdAt: 0, updatedAt }
}

beforeEach(() => {
  resetSeq()
})

describe('toRecord 剥离本地态', () => {
  it('不包含 path/sourcePath/localFile，updatedBy 保留', () => {
    const rec = toRecord(makeImage())
    expect('path' in rec).toBe(false)
    expect('sourcePath' in rec).toBe(false)
    expect('localFile' in rec).toBe(false)
    expect(rec.updatedBy).toBe('dev-A')
  })

  it('updatedBy 缺省为空串', () => {
    expect(toRecord(makeImage({ updatedBy: undefined })).updatedBy).toBe('')
  })
})

describe('图片记录 LWW 合并', () => {
  it('远端更新 → 远端胜出，本地态（path/localFile）保留，pulled+1', () => {
    const local = makeImage({ id: 'x', updatedAt: 1000, fileName: 'local.jpg' })
    const rec = makeRecord(local, { updatedAt: 2000, fileName: 'remote.jpg' })
    const out = mergeAll(input({ localImages: [local], remoteManifests: [makeManifest([rec])] }))
    expect(out.images).toHaveLength(1)
    expect(out.images[0].fileName).toBe('remote.jpg')
    expect(out.images[0].path).toBe(local.path)
    expect(out.images[0].localFile).toBe(true)
    expect(out.stats.pulled).toBe(1)
    expect(out.stats.conflicts).toBe(0)
  })

  it('远端更旧 → 本地胜出，conflicts+1，需要发布理想态', () => {
    const local = makeImage({ id: 'x', updatedAt: 1000, fileName: 'local.jpg' })
    const rec = makeRecord(local, { updatedAt: 500, fileName: 'stale.jpg' })
    const out = mergeAll(input({ localImages: [local], remoteManifests: [makeManifest([rec])] }))
    expect(out.images[0].fileName).toBe('local.jpg')
    expect(out.stats.conflicts).toBe(1)
    expect(out.stats.pulled).toBe(0)
    expect(out.manifestToPublish).not.toBeNull()
    expect(out.manifestToPublish?.images[0].fileName).toBe('local.jpg')
    expect(out.stats.pushed).toBe(1)
  })

  it('updatedAt 打平时按 updatedBy 字典序决胜（各设备结论一致）', () => {
    // 本地 dev-B > 远端 dev-A → 本地胜（conflicts）
    const local = makeImage({ id: 'x', updatedBy: 'dev-B', fileName: 'local.jpg' })
    const recA = makeRecord(local, { updatedBy: 'dev-A', fileName: 'remote.jpg' })
    const outA = mergeAll(input({ localImages: [local], remoteManifests: [makeManifest([recA])] }))
    expect(outA.images[0].fileName).toBe('local.jpg')
    expect(outA.stats.conflicts).toBe(1)

    // 本地 dev-A < 远端 dev-B → 远端胜（pulled）
    const recB = makeRecord(local, { updatedBy: 'dev-B', fileName: 'remote.jpg' })
    const outB = mergeAll(input({ localImages: [local], remoteManifests: [makeManifest([recB])] }))
    expect(outB.images[0].fileName).toBe('remote.jpg')
    expect(outB.stats.pulled).toBe(1)
  })

  it('远端-only 新图 → localFile=false、path 为空', () => {
    const rec = makeRecord(makeImage({ id: 'cloud-1' }))
    const out = mergeAll(input({ remoteManifests: [makeManifest([rec])] }))
    expect(out.images).toHaveLength(1)
    expect(out.images[0].localFile).toBe(false)
    expect(out.images[0].path).toBe('')
    expect(out.stats.pulled).toBe(1)
  })
})

describe('墓碑语义', () => {
  it('本地墓碑杀死本地图片，且墓碑随输出传播', () => {
    const local = makeImage({ id: 'x' })
    const out = mergeAll(input({ localImages: [local], localTombstones: [tomb('x', 5)] }))
    expect(out.images).toHaveLength(0)
    expect(out.tombstones.map((t) => t.id)).toContain('x')
  })

  it('远端清单内墓碑压制同清单记录', () => {
    const rec = makeRecord(makeImage({ id: 'x' }))
    const out = mergeAll(
      input({
        remoteManifests: [
          makeManifest([rec], { tombstones: [tomb('x', 9, { deletedBy: 'dev-B' })] })
        ]
      })
    )
    expect(out.images).toHaveLength(0)
    expect(out.stats.pulled).toBe(0)
  })

  it('同 id 多方墓碑取最大 deletedAt', () => {
    const out = mergeAll(
      input({
        localTombstones: [tomb('x', 5)],
        remoteManifests: [makeManifest([], { tombstones: [tomb('x', 9, { deletedBy: 'dev-B' })] })]
      })
    )
    expect(out.tombstones).toHaveLength(1)
    expect(out.tombstones[0].deletedAt).toBe(9)
  })

  it('输出墓碑按 deletedAt 升序', () => {
    const out = mergeAll(input({ localTombstones: [tomb('a', 9), tomb('b', 5)] }))
    expect(out.tombstones.map((t) => t.deletedAt)).toEqual([5, 9])
  })
})

describe('同 hash 去重（跨设备重复导入）', () => {
  it('早入库者为规范：收藏取或、标签并集、LWW 字段取新、败者写 dedup 墓碑', () => {
    const early = makeImage({
      hash: 'same',
      addedAt: 1000,
      updatedAt: 1000,
      tags: ['a'],
      favorite: false,
      fileName: 'early.jpg'
    })
    const late = makeImage({
      hash: 'same',
      addedAt: 2000,
      updatedAt: 2000,
      tags: ['b'],
      favorite: true,
      fileName: 'late.jpg'
    })
    const out = mergeAll(input({ localImages: [early, late] }))
    expect(out.images).toHaveLength(1)
    const winner = out.images[0]
    expect(winner.id).toBe(early.id)
    expect(winner.fileName).toBe('late.jpg')
    expect(winner.favorite).toBe(true)
    expect(winner.tags).toEqual(['a', 'b'])
    expect(winner.updatedAt).toBe(2000)
    expect(winner.localFile).toBe(true)
    const loserTomb = out.tombstones.find((t) => t.id === late.id)
    expect(loserTomb?.kind).toBe('image')
    expect(loserTomb?.deletedBy).toBe('dedup')
    expect(out.stats.deduped).toBe(1)
  })

  it('addedAt 打平时取小 id 为规范（确定性）', () => {
    const b = makeImage({ id: 'b-2', hash: 'same', addedAt: 1000 })
    const a = makeImage({ id: 'a-1', hash: 'same', addedAt: 1000 })
    const out = mergeAll(input({ localImages: [b, a] }))
    expect(out.images).toHaveLength(1)
    expect(out.images[0].id).toBe('a-1')
  })

  it('败者的本地文件信息转移给云端规范记录', () => {
    const local = makeImage({ hash: 'same', addedAt: 2000 })
    const cloudRec = makeRecord(makeImage({ id: 'cloud-1', hash: 'same', addedAt: 500 }))
    const out = mergeAll(
      input({ localImages: [local], remoteManifests: [makeManifest([cloudRec])] })
    )
    expect(out.images).toHaveLength(1)
    expect(out.images[0].id).toBe('cloud-1')
    expect(out.images[0].localFile).toBe(true)
    expect(out.images[0].path).toBe(local.path)
    expect(out.stats.deduped).toBe(1)
  })
})

describe('分类合并', () => {
  it('同 id 分类 LWW 取新', () => {
    const out = mergeAll(
      input({
        localCategories: [cat('c1', '旧名', { updatedAt: 1000 })],
        remoteManifests: [
          makeManifest([], { categories: [cat('c1', '新名', { updatedAt: 2000 })] })
        ]
      })
    )
    expect(out.categories).toHaveLength(1)
    expect(out.categories[0].name).toBe('新名')
  })

  it('输出按 order 排序，缺省 order 排最后（同缺省按 id）', () => {
    const out = mergeAll(
      input({
        localCategories: [
          cat('c-b', '乙'),
          cat('c-a', '甲', { order: 2 }),
          cat('c-c', '丙', { order: 1 })
        ]
      })
    )
    expect(out.categories.map((c) => c.id)).toEqual(['c-c', 'c-a', 'c-b'])
  })

  it('同名分类去重：保留 LWW 胜者，图片改挂并打新时间戳，败者写 category 墓碑', () => {
    const local = makeImage({ categoryId: 'c-local', updatedAt: 1000 })
    const out = mergeAll(
      input({
        localImages: [local],
        localCategories: [cat('c-local', '风景', { updatedAt: 1000 })],
        remoteManifests: [
          makeManifest([], { categories: [cat('c-remote', '风景', { updatedAt: 2000 })] })
        ]
      })
    )
    expect(out.categories.map((c) => c.id)).toEqual(['c-remote'])
    expect(out.images[0].categoryId).toBe('c-remote')
    // 改挂记录必须打新时间戳，否则 LWW 打平时旧引用会胜回（孤儿引用）
    expect(out.images[0].updatedAt).toBeGreaterThan(1000)
    const loserTomb = out.tombstones.find((t) => t.id === 'c-local')
    expect(loserTomb?.kind).toBe('category')
    expect(loserTomb?.deletedBy).toBe('dedup')
    expect(out.stats.deduped).toBe(1)
  })

  it('孤儿分类引用兜底为 null（图片保持可见）', () => {
    const local = makeImage({ categoryId: 'gone' })
    const out = mergeAll(input({ localImages: [local], localCategories: [] }))
    expect(out.images[0].categoryId).toBeNull()
  })
})

describe('智能相册合并', () => {
  it('id 维度 LWW，输出按 id 排序', () => {
    const out = mergeAll(
      input({
        localAlbums: [album('al-2', '本地旧名', 1000)],
        remoteManifests: [
          makeManifest([], {
            albums: [album('al-1', '远端新册', 1000), album('al-2', '远端新名', 2000)]
          })
        ]
      })
    )
    expect(out.albums.map((a) => a.id)).toEqual(['al-1', 'al-2'])
    expect(out.albums[1].name).toBe('远端新名')
  })

  it('相册墓碑生效', () => {
    const out = mergeAll(
      input({ localAlbums: [album('al-1', '已删', 1000)], localTombstones: [tomb('al-1', 50)] })
    )
    expect(out.albums).toHaveLength(0)
  })
})

describe('manifestToPublish 幂等', () => {
  it('远端清单已等于理想态 → 无需发布（null），pulled 计数正常', () => {
    const recA = makeRecord(makeImage({ id: 'a' }))
    const recB = makeRecord(makeImage({ id: 'b' }))
    const out = mergeAll(input({ remoteManifests: [makeManifest([recA, recB])] }))
    expect(out.stats.pulled).toBe(2)
    expect(out.manifestToPublish).toBeNull()
    expect(out.stats.pushed).toBe(0)
  })

  it('存在差异 → 发布合并后的理想态，pushed=记录数', () => {
    const local = makeImage({ id: 'x', updatedAt: 2000 })
    const rec = makeRecord(local, { updatedAt: 1000, fileName: 'stale.jpg' })
    const out = mergeAll(input({ localImages: [local], remoteManifests: [makeManifest([rec])] }))
    expect(out.manifestToPublish).not.toBeNull()
    expect(out.manifestToPublish?.images).toHaveLength(1)
    expect(out.manifestToPublish?.images[0].fileName).toBe(local.fileName)
    expect(out.manifestToPublish?.updatedBy).toBe('')
    expect(out.stats.pushed).toBe(1)
  })
})
