/**
 * shared/dhash.ts —— dHash 感知哈希纯函数
 */
import { describe, expect, it } from 'vitest'
import { dHashFromPixels, groupSimilar, hammingDistanceHex } from '@shared/dhash'

/** 构造 9×8 灰度行：pattern 为 9 个 0/255 值，重复 8 行 */
function grid(pattern: number[]): Uint8Array {
  const out = new Uint8Array(72)
  for (let r = 0; r < 8; r++) pattern.forEach((v, c) => (out[r * 9 + c] = v))
  return out
}

describe('dHashFromPixels', () => {
  it('左亮右暗全 1 → 0xAA×8；反之全 0', () => {
    // 交替 255,0,255,...,0（9 值）：每对相邻比较 左>右 与 右<左 交替 → 10101010 = 0xAA
    expect(dHashFromPixels(grid([255, 0, 255, 0, 255, 0, 255, 0, 255]))).toBe('aaaaaaaaaaaaaaaa')
    // 反向交替：0,1,0,1… = 0x55
    expect(dHashFromPixels(grid([0, 255, 0, 255, 0, 255, 0, 255, 0]))).toBe('5555555555555555')
  })

  it('输入不足 72 字节返回 null（防截断数据产出伪哈希）', () => {
    expect(dHashFromPixels(new Uint8Array(71))).toBeNull()
    expect(dHashFromPixels(new Uint8Array(0))).toBeNull()
  })
})

describe('hammingDistanceHex', () => {
  it('自比 0；单 bit 差为 1', () => {
    const h = 'aaaaaaaaaaaaaaaa'
    expect(hammingDistanceHex(h, h)).toBe(0)
    // 0xAA ^ 0xAB = 0x02（1 bit）
    expect(hammingDistanceHex(h, 'ab' + h.slice(2))).toBe(1)
  })

  it('多 bit 差累加；跨 32 位半区也累计', () => {
    // 0xAA ^ 0x55 = 0xFF（8 bit）
    expect(hammingDistanceHex('aaaaaaaaaaaaaaaa', '5555555555555555')).toBe(64)
    // 只改后 8 hex（第二个 32 位半区）
    expect(hammingDistanceHex('aaaaaaaaaaaaaaaa', 'aaaaaaaa55555555')).toBe(32)
  })

  it('长度不符返回 Infinity（视为不相似，绝不误聚）', () => {
    expect(hammingDistanceHex('aaaa', 'aaaa')).toBe(Number.POSITIVE_INFINITY)
    expect(hammingDistanceHex('aaaaaaaaaaaaaaaa', 'aaaa')).toBe(Number.POSITIVE_INFINITY)
  })
})

describe('groupSimilar（并查集聚簇）', () => {
  const H0 = 'aaaaaaaaaaaaaaaa'
  const H1 = 'ab' + H0.slice(2) // 距 H0 = 1
  const H2 = '5555555555555555' // 与其余全部相距 64 bit（真·不相似）
  const H3 = H0.slice(0, 15) + 'b' // 距 H0 = 1

  it('阈值内聚簇、阈值外分开；返回 ≥2 成员的簇且按大小降序', () => {
    const items = [
      { id: 'a', hash: H0 },
      { id: 'b', hash: H1 },
      { id: 'c', hash: H2 },
      { id: 'd', hash: H3 }
    ]
    const groups = groupSimilar(items, 1)
    expect(groups).toEqual([['a', 'b', 'd']])
    expect(groupSimilar(items, 0)).toEqual([]) // 阈值 0：完全同哈希才聚
  })

  it('传递性：A~B、B~C 同组（编辑链常见形态）', () => {
    // 构造链：H 与 H+1bit 距 1；H+1bit 与 H+2bit（不同位）距 2
    const items = [
      { id: 'A', hash: H0 },
      { id: 'B', hash: H1 },
      { id: 'C', hash: 'ba' + H0.slice(2) } // 距 H1 = 2、距 H0 = 2
    ]
    expect(groupSimilar(items, 2)).toEqual([['A', 'B', 'C']])
  })

  it('空输入/单元素返回空', () => {
    expect(groupSimilar([], 6)).toEqual([])
    expect(groupSimilar([{ id: 'x', hash: H0 }], 6)).toEqual([])
  })
})
