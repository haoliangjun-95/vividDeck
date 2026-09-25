/**
 * A4（试点）worker 线程并行 sha1 哈希池：
 * - 真实集成测试：临时目录合成文件 + node:crypto 现算期望 sha1（不触生产数据）
 * - 覆盖：正确性 / 空列表 / 进度回调 / 缺失文件容错 / 并发参数 / 队列链式派发
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { hashFilesParallel, defaultConcurrency } from '@main/services/workers/hashPool'

function sha1(content: string): string {
  return crypto.createHash('sha1').update(content).digest('hex')
}

let tmpDir: string
/** 路径 → 内容（合成夹具） */
let files: Map<string, string>

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vd-hash-'))
  files = new Map()
})

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

/** 写一个合成文件并登记期望哈希 */
function makeFile(name: string, content: string): string {
  const p = path.join(tmpDir, name)
  fs.writeFileSync(p, content, 'utf-8')
  files.set(p, content)
  return p
}

describe('hashFilesParallel：worker 线程并行哈希', () => {
  it('空列表：返回空 Map，不抛错', async () => {
    await expect(hashFilesParallel([])).resolves.toEqual(new Map())
  })

  it('多文件结果与 node:crypto 现算 sha1 一致', async () => {
    const paths = [
      makeFile('a.txt', 'file-A'),
      makeFile('b.txt', 'file-B'),
      makeFile('c.bin', 'x'.repeat(10_000))
    ]
    const result = await hashFilesParallel(paths)
    expect(result.size).toBe(3)
    for (const [p, content] of files) {
      expect(result.get(p)).toBe(sha1(content))
    }
  })

  it('缺失文件：对应键不出现在结果中，其余正常、整体不 reject', async () => {
    const ok = makeFile('ok.txt', 'good')
    const missing = path.join(tmpDir, 'gone.txt')
    const result = await hashFilesParallel([ok, missing])
    expect(result.get(ok)).toBe(sha1('good'))
    expect(result.has(missing)).toBe(false)
  })

  it('进度回调：每文件一次，最终 (total, total)', async () => {
    const paths = Array.from({ length: 6 }, (_, i) => makeFile(`f${i}.txt`, `c${i}`))
    const calls: [number, number][] = []
    await hashFilesParallel(paths, { onProgress: (c, t) => calls.push([c, t]) })
    expect(calls).toHaveLength(6)
    expect(calls.every(([, t]) => t === 6)).toBe(true)
    expect(Math.max(...calls.map(([c]) => c))).toBe(6)
  })

  it('concurrency=1 串行也正确（队列链式派发）', async () => {
    const paths = Array.from({ length: 8 }, (_, i) => makeFile(`s${i}.txt`, `content-${i}`))
    const result = await hashFilesParallel(paths, { concurrency: 1 })
    expect(result.size).toBe(8)
    for (const [p, content] of files) {
      expect(result.get(p)).toBe(sha1(content))
    }
  })

  it('任务数多于并发数：20 文件 × 4 并发全部正确', async () => {
    const paths = Array.from({ length: 20 }, (_, i) => makeFile(`m${i}.txt`, `payload-${i * 7}`))
    const result = await hashFilesParallel(paths, { concurrency: 4 })
    expect(result.size).toBe(20)
    for (const [p, content] of files) {
      expect(result.get(p)).toBe(sha1(content))
    }
  })
})

describe('defaultConcurrency', () => {
  it('介于 1 与 4 之间（CPU 数派生、封顶）', () => {
    const c = defaultConcurrency()
    expect(c).toBeGreaterThanOrEqual(1)
    expect(c).toBeLessThanOrEqual(4)
  })
})
