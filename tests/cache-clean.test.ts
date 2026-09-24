/**
 * 缓存清理（清单 #8：缩略图孤儿清理 + 设置入口）
 * - findOrphanCacheFiles / isAppliedCacheFile：纯函数，孤儿识别规则
 * - cleanCache：真实临时目录集成（paths/thumbnails/library 均 vi.mock 指向 tmp）
 * 孤儿 = 不在库中任何图片"当前精确文件名"集合内的缓存（含已删图片与编辑后旧哈希）；
 * 非应用命名格式的未知文件（.DS_Store 等）一律保留。
 */
import { mkdtempSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  dirs: { thumb: '', preview: '', applied: '' },
  images: [] as { id: string; hash: string }[]
}))

vi.mock('@main/services/paths', async () => {
  const fs = await import('node:fs')
  const p = await import('node:path')
  const dirSize = async (dir: string): Promise<number> => {
    let total = 0
    let entries: fs.Dirent[]
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true })
    } catch {
      return 0
    }
    for (const e of entries) {
      const full = p.join(dir, e.name)
      if (e.isDirectory()) total += await dirSize(full)
      else if (e.isFile()) total += (await fs.promises.stat(full)).size
    }
    return total
  }
  return {
    thumbDir: () => h.dirs.thumb,
    previewDir: () => h.dirs.preview,
    appliedDir: () => h.dirs.applied,
    dirSize
  }
})

vi.mock('@main/services/thumbnails', async () => {
  const p = await import('node:path')
  return {
    thumbPath: (img: { id: string; hash: string }) =>
      p.join(h.dirs.thumb, `${img.id}_${img.hash.slice(0, 8)}.webp`),
    previewPath: (img: { id: string; hash: string }) =>
      p.join(h.dirs.preview, `${img.id}_${img.hash.slice(0, 8)}.jpg`)
  }
})

vi.mock('@main/services/library', () => ({
  getLibrary: () => ({ images: h.images })
}))

import { cleanCache, findOrphanCacheFiles, isAppliedCacheFile } from '@main/services/cache'

describe('findOrphanCacheFiles 孤儿识别', () => {
  const valid = new Set(['aaa111_deadbeef.webp', 'aaa111_deadbeef.jpg'])

  it('不在有效集合内的规范命名文件判为孤儿', () => {
    const names = ['bbb222_cafebabe.webp', 'aaa111_deadbeef.webp']
    expect(findOrphanCacheFiles(names, valid)).toEqual(['bbb222_cafebabe.webp'])
  })

  it('同 id 旧哈希（图片编辑后残留）判为孤儿', () => {
    expect(findOrphanCacheFiles(['aaa111_0000ffff.webp'], valid)).toEqual(['aaa111_0000ffff.webp'])
  })

  it('非应用命名格式的未知文件一律保留', () => {
    const names = ['.DS_Store', 'notes.txt', 'photo.jpg', 'x_NOTHEX00.webp', 'aaa111_deadbee.webp']
    expect(findOrphanCacheFiles(names, valid)).toEqual([])
  })

  it('webp 与 jpg 混合、空输入', () => {
    expect(findOrphanCacheFiles(['z9_0123abcd.jpg', 'aaa111_deadbeef.jpg'], valid)).toEqual([
      'z9_0123abcd.jpg'
    ])
    expect(findOrphanCacheFiles([], valid)).toEqual([])
  })
})

describe('isAppliedCacheFile 预渲染缓存识别', () => {
  it('16 位十六进制 .jpg 为预渲染缓存（可整体再生）', () => {
    expect(isAppliedCacheFile('0123456789abcdef.jpg')).toBe(true)
    expect(isAppliedCacheFile('abc.jpg')).toBe(false)
    expect(isAppliedCacheFile('0123456789abcdef.webp')).toBe(false)
    expect(isAppliedCacheFile('.DS_Store')).toBe(false)
  })
})

describe('cleanCache 临时目录集成', () => {
  beforeAll(() => {
    const root = mkdtempSync(path.join(tmpdir(), 'vd-cache-'))
    h.dirs.thumb = path.join(root, 'thumbnails')
    h.dirs.preview = path.join(root, 'previews')
    h.dirs.applied = path.join(root, 'applied')
    for (const d of Object.values(h.dirs)) mkdirSync(d, { recursive: true })
  })

  afterEach(() => {
    for (const d of Object.values(h.dirs)) {
      rmSync(d, { recursive: true, force: true })
      mkdirSync(d, { recursive: true })
    }
    h.images = []
  })

  it('删除孤儿缩略图/预览与全部预渲染缓存，保留有效缓存与未知文件', async () => {
    h.images = [{ id: 'aaa111', hash: 'deadbeefcafe0000' }]
    // 有效缓存（id 存在且哈希前 8 位精确匹配）
    writeFileSync(path.join(h.dirs.thumb, 'aaa111_deadbeef.webp'), 'valid')
    writeFileSync(path.join(h.dirs.preview, 'aaa111_deadbeef.jpg'), 'valid')
    // 孤儿：已删图片、旧哈希残留
    writeFileSync(path.join(h.dirs.thumb, 'bbb222_cafebabe.webp'), 'orphan-orphan')
    writeFileSync(path.join(h.dirs.thumb, 'aaa111_0000ffff.webp'), 'stale')
    writeFileSync(path.join(h.dirs.preview, 'bbb222_cafebabe.jpg'), 'orphan')
    // 未知文件不动
    writeFileSync(path.join(h.dirs.thumb, '.DS_Store'), 'keep')
    // 预渲染缓存整体可再生
    writeFileSync(path.join(h.dirs.applied, '0123456789abcdef.jpg'), 'applied-applied')

    const r = await cleanCache()

    expect(r.removed).toBe(4)
    expect(r.freedBytes).toBeGreaterThan(0)
    expect(existsSync(path.join(h.dirs.thumb, 'aaa111_deadbeef.webp'))).toBe(true)
    expect(existsSync(path.join(h.dirs.preview, 'aaa111_deadbeef.jpg'))).toBe(true)
    expect(existsSync(path.join(h.dirs.thumb, '.DS_Store'))).toBe(true)
    expect(existsSync(path.join(h.dirs.thumb, 'bbb222_cafebabe.webp'))).toBe(false)
    expect(existsSync(path.join(h.dirs.thumb, 'aaa111_0000ffff.webp'))).toBe(false)
    expect(existsSync(path.join(h.dirs.preview, 'bbb222_cafebabe.jpg'))).toBe(false)
    expect(existsSync(path.join(h.dirs.applied, '0123456789abcdef.jpg'))).toBe(false)
    // cacheBytes = 清理后剩余占用（.DS_Store 4 字节 + 两个有效缓存各 5 字节）
    expect(r.cacheBytes).toBe(14)
  })

  it('空库时清空全部规范命名缓存', async () => {
    writeFileSync(path.join(h.dirs.thumb, 'aaa111_deadbeef.webp'), 'x')
    const r = await cleanCache()
    expect(r.removed).toBe(1)
    expect(existsSync(path.join(h.dirs.thumb, 'aaa111_deadbeef.webp'))).toBe(false)
  })
})
