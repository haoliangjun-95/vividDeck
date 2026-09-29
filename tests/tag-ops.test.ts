/**
 * shared/tagOps.ts —— 标签管理操作的纯函数核心
 * 覆盖：相册规则改写（重命名撞名去重 / 合并交叉去重 / 删除过滤）、标签名校验
 */
import { describe, expect, it } from 'vitest'
import { normalizeTagName, rewriteAlbumsForTag, rewriteRulesForTag } from '@shared/tagOps'
import type { SmartAlbumRules } from '@shared/types'

const rules = (over: Partial<SmartAlbumRules>): SmartAlbumRules => over

describe('rewriteRulesForTag（重命名）', () => {
  it('tagsAll / tagsAny 中的旧名替换为新名', () => {
    const r = rewriteRulesForTag(rules({ tagsAll: ['a', '旧'], tagsAny: ['旧', 'b'] }), '旧', '新')
    expect(r.tagsAll).toEqual(['a', '新'])
    expect(r.tagsAny).toEqual(['新', 'b'])
  })

  it('重命名撞上既有标签 → 去重保序', () => {
    const r = rewriteRulesForTag(rules({ tagsAll: ['a', 'b'] }), 'a', 'b')
    expect(r.tagsAll).toEqual(['b'])
  })

  it('无命中的字段保持原引用（整份规则无命中时对象浅相等）', () => {
    const src = rules({ tagsAll: ['a'], tagsAny: ['x'] })
    const r = rewriteRulesForTag(src, '不存在', 'y')
    expect(r).toBe(src)
  })
})

describe('rewriteRulesForTag（删除 to=null）', () => {
  it('tagsAll/tagsAny 中移除该标签；空数组字段保留为空（匹配不到任何图）', () => {
    const r = rewriteRulesForTag(rules({ tagsAll: ['a', '旧'], tagsAny: ['旧', 'b'] }), '旧', null)
    expect(r.tagsAll).toEqual(['a'])
    expect(r.tagsAny).toEqual(['b'])
  })

  it('tagsAll 只剩该标签时变空数组（语义：该相册不再命中任何图）', () => {
    const r = rewriteRulesForTag(rules({ tagsAll: ['旧'] }), '旧', null)
    expect(r.tagsAll).toEqual([])
  })
})

describe('rewriteAlbumsForTag（相册集批量）', () => {
  const albums = [
    { id: '1', rules: rules({ tagsAny: ['a', 'b'] }) },
    { id: '2', rules: rules({ categoryIds: ['c1'] }) },
    { id: '3', rules: rules({ tagsAll: ['b'] }) }
  ]

  it('命中相册改写、未命中保持原对象引用；无命中整组返回原引用', () => {
    const out = rewriteAlbumsForTag(albums, 'b', 'x')
    expect(out[0].rules.tagsAny).toEqual(['a', 'x'])
    expect(out[1]).toBe(albums[1]) // 未命中 → 原引用
    expect(out[2].rules.tagsAll).toEqual(['x'])
    expect(rewriteAlbumsForTag(albums, 'zzz', 'x')).toBe(albums)
  })
})

describe('normalizeTagName', () => {
  it('去首尾空白；空串/超长拒绝', () => {
    expect(normalizeTagName('  旅行 ')).toBe('旅行')
    expect(normalizeTagName('   ')).toBeNull()
    expect(normalizeTagName('a'.repeat(51))).toBeNull()
    expect(normalizeTagName('a'.repeat(50))).toBe('a'.repeat(50))
  })
})
