/**
 * shared/album.ts —— matchAlbum 组合语义（清单 #12）
 * 规则内全部条件 AND 叠加；缺省/空数组项不参与过滤。
 */
import { describe, expect, it } from 'vitest'
import { matchAlbum, matchAlbums } from '@shared/album'
import type { SmartAlbum, SmartAlbumRules } from '@shared/types'

interface Matchable {
  width: number
  height: number
  categoryId: string | null
  tags: string[]
  favorite: boolean
}

function img(overrides: Partial<Matchable> = {}): Matchable {
  return { width: 1920, height: 1080, categoryId: null, tags: [], favorite: false, ...overrides }
}

function album(rules: SmartAlbumRules, id = 'al-1'): SmartAlbum {
  return { id, name: '测试相册', rules, createdAt: 0, updatedAt: 0 }
}

describe('matchAlbum 缺省规则', () => {
  it('空规则匹配任何图片', () => {
    expect(matchAlbum(img(), album({}))).toBe(true)
    expect(matchAlbum(img({ width: 1, height: 99999 }), album({}))).toBe(true)
  })

  it('空数组条件不参与过滤', () => {
    const a = album({ tagsAll: [], tagsAny: [], categoryIds: [] })
    expect(matchAlbum(img({ categoryId: null, tags: [] }), a)).toBe(true)
  })
})

describe('matchAlbum favoriteOnly', () => {
  it('仅收藏图命中', () => {
    const a = album({ favoriteOnly: true })
    expect(matchAlbum(img({ favorite: true }), a)).toBe(true)
    expect(matchAlbum(img({ favorite: false }), a)).toBe(false)
  })

  it('favoriteOnly=false 不过滤', () => {
    expect(matchAlbum(img({ favorite: false }), album({ favoriteOnly: false }))).toBe(true)
  })
})

describe('matchAlbum 标签语义', () => {
  it('tagsAll 要求全部命中（交集）', () => {
    const a = album({ tagsAll: ['风景', '夜景'] })
    expect(matchAlbum(img({ tags: ['风景', '夜景', '城市'] }), a)).toBe(true)
    expect(matchAlbum(img({ tags: ['风景'] }), a)).toBe(false)
    expect(matchAlbum(img({ tags: [] }), a)).toBe(false)
  })

  it('tagsAny 要求任一命中（并集）', () => {
    const a = album({ tagsAny: ['猫', '狗'] })
    expect(matchAlbum(img({ tags: ['狗'] }), a)).toBe(true)
    expect(matchAlbum(img({ tags: ['鸟'] }), a)).toBe(false)
  })

  it('tagsAll 与 tagsAny 同时存在时 AND 叠加', () => {
    const a = album({ tagsAll: ['风景'], tagsAny: ['日出', '日落'] })
    expect(matchAlbum(img({ tags: ['风景', '日出'] }), a)).toBe(true)
    expect(matchAlbum(img({ tags: ['风景'] }), a)).toBe(false)
    expect(matchAlbum(img({ tags: ['日出'] }), a)).toBe(false)
  })
})

describe('matchAlbum 分类', () => {
  it('categoryIds 命中其一即可；未分类图片被排除', () => {
    const a = album({ categoryIds: ['c1', 'c2'] })
    expect(matchAlbum(img({ categoryId: 'c2' }), a)).toBe(true)
    expect(matchAlbum(img({ categoryId: 'c3' }), a)).toBe(false)
    expect(matchAlbum(img({ categoryId: null }), a)).toBe(false)
  })
})

describe('matchAlbum 尺寸与方向', () => {
  it('minWidth 为下界（等于命中，小于排除）', () => {
    const a = album({ minWidth: 1000 })
    expect(matchAlbum(img({ width: 1000 }), a)).toBe(true)
    expect(matchAlbum(img({ width: 999 }), a)).toBe(false)
  })

  it('orientation：宽>=高为横图，高>宽为竖图，正方形算横图', () => {
    const landscape = album({ orientation: 'landscape' })
    const portrait = album({ orientation: 'portrait' })
    expect(matchAlbum(img({ width: 1920, height: 1080 }), landscape)).toBe(true)
    expect(matchAlbum(img({ width: 1080, height: 1920 }), landscape)).toBe(false)
    expect(matchAlbum(img({ width: 1080, height: 1920 }), portrait)).toBe(true)
    expect(matchAlbum(img({ width: 1000, height: 1000 }), landscape)).toBe(true)
    expect(matchAlbum(img({ width: 1000, height: 1000 }), portrait)).toBe(false)
  })

  it('minAspect/maxAspect 为闭区间边界', () => {
    const ratio = 1920 / 1080
    expect(matchAlbum(img(), album({ minAspect: ratio }))).toBe(true)
    expect(matchAlbum(img(), album({ maxAspect: ratio }))).toBe(true)
    expect(matchAlbum(img(), album({ minAspect: ratio + 0.01 }))).toBe(false)
    expect(matchAlbum(img(), album({ maxAspect: ratio - 0.01 }))).toBe(false)
  })

  it('宽或高为 0 时跳过宽高比检查（防除零）', () => {
    expect(matchAlbum(img({ width: 0, height: 0 }), album({ minAspect: 2 }))).toBe(true)
  })
})

describe('matchAlbums', () => {
  it('返回全部命中的相册 id', () => {
    const albums = [
      album({ favoriteOnly: true }, 'fav'),
      album({ tagsAny: ['风景'] }, 'scenery'),
      album({ minWidth: 99999 }, 'huge')
    ]
    expect(matchAlbums(img({ favorite: true, tags: ['风景'] }), albums)).toEqual(['fav', 'scenery'])
    expect(matchAlbums(img(), albums)).toEqual([])
  })
})
