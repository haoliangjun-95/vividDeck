/**
 * sync/health.ts —— 三方对账（清单 #12）
 * fs / S3(minio) / 库文件全部 vi.mock，夹具为合成数据（endpoint 'minio.test'、
 * accessKey 'ak-test'、桶键 'objects/hN'），不触真实磁盘与网络。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ImageItem } from '@shared/types'
import { makeImage, resetSeq } from './helpers'

const h = vi.hoisted(() => ({
  images: [] as unknown[],
  realFiles: new Set<string>(),
  existingObjects: new Set<string>(),
  bucketKeys: [] as string[],
  removedBatches: [] as string[][],
  prunedCount: 0,
  hasSecret: true,
  flushCalls: 0,
  hashResults: {} as Record<string, string>
}))

/** 伪造 minio listObjectsV2 的事件流（data → end） */
function fakeObjectStream(keys: string[]): {
  on: (ev: string, cb: (arg?: { name?: string }) => void) => unknown
} {
  return {
    on(ev, cb) {
      if (ev === 'data') setTimeout(() => keys.forEach((k) => cb({ name: k })), 0)
      if (ev === 'end') setTimeout(() => cb(), 20)
      return this
    }
  }
}

vi.mock('@main/services/library', () => ({
  getLibrary: (): { images: ImageItem[]; categories: []; tags: [] } => ({
    images: h.images as ImageItem[],
    categories: [],
    tags: []
  }),
  flushLibrary: (): void => {
    h.flushCalls++
  }
}))

vi.mock('@main/utils/fs', () => ({
  hashFile: (p: string): Promise<string> => Promise.resolve(h.hashResults[p] ?? 'corrupt-hash')
}))

vi.mock('@main/services/paths', () => ({
  isRealFile: (p: string): boolean => h.realFiles.has(p)
}))

vi.mock('@main/services/thumbnails', () => ({
  thumbPath: (img: { id: string }): string => `thumb://${img.id}`
}))

vi.mock('@main/services/tombstones', () => ({
  pruneExpiredTombstones: (): number => h.prunedCount
}))

vi.mock('@main/services/sync/store', () => ({
  getSyncConfig: () => ({
    enabled: true,
    endpoint: 'minio.test',
    port: 9000,
    useSSL: false,
    bucket: 'vividdeck',
    accessKey: 'ak-test',
    autoSync: false
  }),
  hasSecret: (): boolean => h.hasSecret,
  loadSecret: (): string => 'sk-test'
}))

vi.mock('@main/services/sync/client', () => ({
  createClient: () => ({
    listObjectsV2: (_bucket: string, prefix: string) =>
      fakeObjectStream(h.bucketKeys.filter((k) => k.startsWith(prefix))),
    removeObjects: (_bucket: string, keys: string[]): Promise<void> => {
      h.removedBatches.push([...keys])
      return Promise.resolve()
    }
  }),
  objectExists: (_c: unknown, _b: string, key: string): Promise<boolean> =>
    Promise.resolve(h.existingObjects.has(key))
}))

import {
  cleanupOrphanObjects,
  estimateDownload,
  repairLocalBroken,
  runHealthCheck,
  verifyIntegrity
} from '@main/services/sync/health'

beforeEach(() => {
  resetSeq()
  h.images = []
  h.realFiles.clear()
  h.existingObjects.clear()
  h.bucketKeys = []
  h.removedBatches = []
  h.prunedCount = 0
  h.hasSecret = true
  h.flushCalls = 0
  h.hashResults = {}
})

/** 让图片的缩略图与本地文件都"存在"，隔离无关断言 */
function markPresent(img: ImageItem): void {
  h.realFiles.add(`thumb://${img.id}`)
  if (img.localFile) h.realFiles.add(img.path)
}

describe('配置守卫', () => {
  it('未配置密钥时体检与清理都拒绝执行', async () => {
    h.hasSecret = false
    await expect(runHealthCheck()).rejects.toThrow('尚未配置同步连接')
    await expect(cleanupOrphanObjects(['objects/x'])).rejects.toThrow('尚未配置同步连接')
  })
})

describe('runHealthCheck 对账', () => {
  it('cloud-only 记录在桶中无二进制 → missingBinaries', async () => {
    const img = makeImage({ id: 'cloud-1', hash: 'h1', localFile: false, path: '' })
    markPresent(img)
    h.images = [img]
    const report = await runHealthCheck()
    expect(report.missingBinaries).toEqual([{ id: 'cloud-1', fileName: img.fileName }])

    h.existingObjects.add('objects/h1')
    const report2 = await runHealthCheck()
    expect(report2.missingBinaries).toEqual([])
  })

  it('localFile=true 但磁盘文件丢失 → localBroken', async () => {
    const img = makeImage({ id: 'loc-1' })
    h.realFiles.add(`thumb://${img.id}`) // 仅缩略图存在，原文件缺失
    h.images = [img]
    const report = await runHealthCheck()
    expect(report.localBroken).toEqual([{ id: 'loc-1', fileName: img.fileName, path: img.path }])

    h.realFiles.add(img.path)
    const report2 = await runHealthCheck()
    expect(report2.localBroken).toEqual([])
  })

  it('缩略图缺失 → missingThumbs', async () => {
    const img = makeImage({ id: 't-1' })
    h.realFiles.add(img.path)
    h.images = [img]
    const report = await runHealthCheck()
    expect(report.missingThumbs).toEqual([{ id: 't-1', fileName: img.fileName }])

    markPresent(img)
    const report2 = await runHealthCheck()
    expect(report2.missingThumbs).toEqual([])
  })

  it('云端孤儿对象：仅列 objects/ 前缀，且排除本地库已知 hash', async () => {
    const img = makeImage({ id: 'k-1', hash: 'h1' })
    markPresent(img)
    h.images = [img]
    h.bucketKeys = ['objects/h1', 'objects/h2', 'thumbs/h9']
    const report = await runHealthCheck()
    expect(report.cloudOrphanObjects).toEqual(['objects/h2'])
  })

  it('顺带执行过期墓碑清理并透传数量', async () => {
    h.prunedCount = 7
    const report = await runHealthCheck()
    expect(report.expiredTombstonesCleaned).toBe(7)
    expect(report.checkedAt).toBeGreaterThan(0)
  })
})

describe('repairLocalBroken', () => {
  it('命中的断链记录标记为云端并落库', async () => {
    const a = makeImage({ id: 'a' })
    const b = makeImage({ id: 'b' })
    h.images = [a, b]
    const fixed = await repairLocalBroken(['a', 'unknown'])
    expect(fixed).toBe(1)
    expect((h.images[0] as ImageItem).localFile).toBe(false)
    expect((h.images[0] as ImageItem).path).toBe('')
    expect((h.images[1] as ImageItem).localFile).toBe(true)
    expect(h.flushCalls).toBe(1)
  })

  it('无可修复项时不触发落库', async () => {
    h.images = [makeImage({ id: 'a', localFile: false, path: '' })]
    expect(await repairLocalBroken(['a'])).toBe(0)
    expect(h.flushCalls).toBe(0)
  })
})

describe('estimateDownload', () => {
  it('仅统计 cloud-only 记录的数量与字节', async () => {
    h.images = [
      makeImage({ localFile: false, sizeBytes: 100 }),
      makeImage({ localFile: false, sizeBytes: 200 }),
      makeImage({ localFile: true, sizeBytes: 400 })
    ]
    expect(await estimateDownload()).toEqual({ count: 2, sizeBytes: 300 })
  })
})

describe('cleanupOrphanObjects', () => {
  it('按 100 个一批调用 removeObjects', async () => {
    const keys = Array.from({ length: 250 }, (_, i) => `objects/orphan-${i}`)
    const cleaned = await cleanupOrphanObjects(keys)
    expect(cleaned).toBe(250)
    expect(h.removedBatches).toHaveLength(3)
    expect(h.removedBatches.map((b) => b.length)).toEqual([100, 100, 50])
  })
})

describe('verifyIntegrity', () => {
  it('hash 一致返回空清单，并逐张上报进度', async () => {
    const img = makeImage({ id: 'v-1', hash: 'h1' })
    markPresent(img)
    h.images = [img]
    h.hashResults[img.path] = 'h1'
    const progress: [number, number][] = []
    const bad = await verifyIntegrity((cur, total) => progress.push([cur, total]))
    expect(bad).toEqual([])
    expect(progress).toEqual([[1, 1]])
  })

  it('hash 不一致的记录进入坏清单', async () => {
    const img = makeImage({ id: 'v-1', hash: 'h1' })
    markPresent(img)
    h.images = [img]
    h.hashResults[img.path] = 'wrong'
    const bad = await verifyIntegrity()
    expect(bad).toEqual([{ id: 'v-1', fileName: img.fileName }])
  })

  it('本地文件缺失的记录不参与校验（属断链范畴）', async () => {
    const img = makeImage({ id: 'v-1', hash: 'h1' })
    h.images = [img] // realFiles 为空 → 不算 local
    expect(await verifyIntegrity()).toEqual([])
  })
})
