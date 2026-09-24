/**
 * 选择性同步范围纯函数（清单 #9：按分类/相册圈定同步范围）
 * imageInSyncScope：范围只约束二进制与缩略图传输，元数据清单始终全量同步。
 * 夹具全合成（tests/helpers.ts），相册规则复用 @shared/album 的 matchAlbum。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { imageInSyncScope } from '@shared/syncScope'
import type { SmartAlbum, SmartAlbumRules, SyncScope } from '@shared/types'
import { makeImage, resetSeq } from './helpers'

function album(id: string, rules: SmartAlbumRules): SmartAlbum {
  return { id, name: id, rules, createdAt: 0, updatedAt: 0 }
}

describe('imageInSyncScope 同步范围判定', () => {
  beforeEach(resetSeq)

  it('all / 缺失 / 未知类型一律视为全量（旧配置优雅降级）', () => {
    const img = makeImage()
    expect(imageInSyncScope(img, { type: 'all' }, [])).toBe(true)
    expect(imageInSyncScope(img, undefined, [])).toBe(true)
    expect(imageInSyncScope(img, { type: 'bogus' } as unknown as SyncScope, [])).toBe(true)
  })

  it('categories：选中分类内命中，其余分类与未分类均不命中', () => {
    const inCat = makeImage({ categoryId: 'cat-1' })
    const otherCat = makeImage({ categoryId: 'cat-2' })
    const noCat = makeImage({ categoryId: null })
    const scope: SyncScope = { type: 'categories', ids: ['cat-1'] }
    expect(imageInSyncScope(inCat, scope, [])).toBe(true)
    expect(imageInSyncScope(otherCat, scope, [])).toBe(false)
    expect(imageInSyncScope(noCat, scope, [])).toBe(false)
  })

  it('categories：空选择 = 全部不同步', () => {
    const scope: SyncScope = { type: 'categories', ids: [] }
    expect(imageInSyncScope(makeImage({ categoryId: 'cat-1' }), scope, [])).toBe(false)
  })

  it('albums：命中任一选中相册的规则即在范围内', () => {
    const fav = makeImage({ favorite: true })
    const plain = makeImage()
    const albums = [album('al-fav', { favoriteOnly: true }), album('al-tag', { tagsAny: ['x'] })]
    const scope: SyncScope = { type: 'albums', ids: ['al-fav'] }
    expect(imageInSyncScope(fav, scope, albums)).toBe(true)
    expect(imageInSyncScope(plain, scope, albums)).toBe(false)
  })

  it('albums：未选中的相册即使规则命中也不放行', () => {
    const tagged = makeImage({ tags: ['x'] })
    const albums = [album('al-tag', { tagsAny: ['x'] })]
    expect(imageInSyncScope(tagged, { type: 'albums', ids: ['al-other'] }, albums)).toBe(false)
  })

  it('albums：选中相册已被删除时优雅降级为不命中', () => {
    const fav = makeImage({ favorite: true })
    expect(imageInSyncScope(fav, { type: 'albums', ids: ['al-fav'] }, [])).toBe(false)
  })
})
