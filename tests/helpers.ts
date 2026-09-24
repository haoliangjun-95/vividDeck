/**
 * 测试夹具工厂（全合成数据：id 形如 img-N、hash 形如 hash-N、时间戳为小整数，
 * 不含任何生产数据；无日期字符串，时间均为 epoch 毫秒数值）
 */
import type { ImageItem, SyncImageRecord, SyncManifest } from '@shared/types'
import { toRecord } from '@main/services/sync/merge'

let seq = 0

/** 重置自增序列（beforeEach 调用，保证 id 可预期：img-1、img-2…） */
export function resetSeq(): void {
  seq = 0
}

/** 构造完整的本地图片记录（可用 overrides 覆盖任意字段） */
export function makeImage(overrides: Partial<ImageItem> = {}): ImageItem {
  seq++
  return {
    id: `img-${seq}`,
    fileName: `photo-${seq}.jpg`,
    path: `/media/photo-${seq}.jpg`,
    sourcePath: `/media/photo-${seq}.jpg`,
    hash: `hash-${seq}`,
    width: 1920,
    height: 1080,
    sizeBytes: 1024,
    format: 'jpeg',
    categoryId: null,
    tags: [],
    favorite: false,
    addedAt: 1000,
    updatedAt: 1000,
    updatedBy: 'dev-A',
    localFile: true,
    ...overrides
  }
}

/** 构造远端同步记录（默认从本地记录剥离本地态） */
export function makeRecord(
  img: ImageItem,
  overrides: Partial<SyncImageRecord> = {}
): SyncImageRecord {
  return { ...toRecord(img), ...overrides }
}

/** 构造远端清单快照 */
export function makeManifest(
  images: SyncImageRecord[],
  extra: Partial<SyncManifest> = {}
): SyncManifest {
  return {
    version: 1,
    updatedAt: 0,
    updatedBy: 'dev-B',
    images,
    categories: [],
    tombstones: [],
    ...extra
  }
}
