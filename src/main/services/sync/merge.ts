/**
 * 同步合并纯函数（无副作用，可单测）
 *
 * 模型：CRDT 风格 —— 每台设备各自发布完整清单快照，合并时对每条记录做 LWW，
 * 合并满足交换律/幂等，因此任意并发写入最终都能收敛，无需条件写（If-Match）。
 *
 * LWW 比较：updatedAt 大者胜；相等时按 updatedBy 字典序决胜（确定性，所有设备结论一致）
 */

import type {
  Category,
  ImageItem,
  SyncImageRecord,
  SyncManifest,
  SyncTombstone
} from '@shared/types'

/** 远端仅存同步字段；本地记录含 path/localFile 等设备态 */
export interface MergeInput {
  /** 本地全量记录 */
  localImages: ImageItem[]
  localCategories: Category[]
  /** 本地墓碑 */
  localTombstones: SyncTombstone[]
  /** 远端全部清单快照（含 base 压缩基线，全部参与合并） */
  remoteManifests: SyncManifest[]
}

export interface MergeOutput {
  images: ImageItem[]
  categories: Category[]
  /** 合并后的墓碑全集（写回本地下次发布） */
  tombstones: SyncTombstone[]
  /** 需要发布到远端的新清单（null = 与已发布状态无差异，可跳过写入） */
  manifestToPublish: SyncManifest | null
  /** 统计 */
  stats: { pulled: number; pushed: number; conflicts: number; deduped: number }
}

/** LWW 决胜：返回 true 表示 a 更新 */
function newer(a: { updatedAt: number; updatedBy?: string }, b: { updatedAt: number; updatedBy?: string }): boolean {
  if (a.updatedAt !== b.updatedAt) return a.updatedAt > b.updatedAt
  return String(a.updatedBy ?? '') > String(b.updatedBy ?? '')
}

/** 同一条记录两个版本取 LWW 胜者的同步字段，本地态（path/localFile）单独保留 */
function pickRecordFields<T extends { updatedAt: number; updatedBy?: string }>(a: T, b: T): T {
  return newer(a, b) ? a : b
}

/** ImageItem → SyncImageRecord（剥离本地态） */
export function toRecord(img: ImageItem): SyncImageRecord {
  const { id, fileName, hash, width, height, sizeBytes, format, categoryId, tags, favorite, addedAt, updatedAt } = img
  return { id, fileName, hash, width, height, sizeBytes, format, categoryId, tags, favorite, addedAt, updatedAt, updatedBy: img.updatedBy ?? '' }
}

export function mergeAll(input: MergeInput): MergeOutput {
  const { localImages, localCategories, localTombstones, remoteManifests } = input
  const stats = { pulled: 0, pushed: 0, conflicts: 0, deduped: 0 }

  // ---------- 1) 汇总墓碑（本地 + 全部远端清单） ----------
  const tombstoneMap = new Map<string, SyncTombstone>()
  for (const t of localTombstones) tombstoneMap.set(t.id, t)
  for (const m of remoteManifests) {
    for (const t of m.tombstones) {
      const existing = tombstoneMap.get(t.id)
      if (!existing || t.deletedAt > existing.deletedAt) tombstoneMap.set(t.id, t)
    }
  }
  const isDead = (id: string): boolean => tombstoneMap.has(id)

  // ---------- 2) 图片记录合并（id 维度 LWW） ----------
  // remoteFirst：全部远端清单之间的胜者；local 记录的同步字段参与同场竞技
  interface Slot {
    record: SyncImageRecord
    /** 本地态（仅本地记录有） */
    local?: { path: string; sourcePath: string; localFile: boolean }
  }
  const slots = new Map<string, Slot>()

  for (const img of localImages) {
    if (isDead(img.id)) continue
    slots.set(img.id, {
      record: toRecord(img),
      local: { path: img.path, sourcePath: img.sourcePath, localFile: img.localFile }
    })
  }

  for (const m of remoteManifests) {
    for (const rec of m.images) {
      if (isDead(rec.id)) continue
      const existing = slots.get(rec.id)
      if (!existing) {
        slots.set(rec.id, { record: rec })
        stats.pulled++
      } else {
        const before = existing.record
        existing.record = pickRecordFields(existing.record, rec)
        if (existing.record !== before) stats.pulled++
        else stats.conflicts++ // 远端版本更旧（本地胜出，需推送）
      }
    }
  }

  // ---------- 3) 同 hash 去重合并（跨设备各自导入同一文件的场景） ----------
  const byHash = new Map<string, string[]>()
  for (const [id, slot] of slots) {
    const list = byHash.get(slot.record.hash) ?? []
    list.push(id)
    byHash.set(slot.record.hash, list)
  }
  const dedupLosers = new Set<string>()
  for (const [, ids] of byHash) {
    if (ids.length < 2) continue
    // 规范记录 = 早入库者（并列取小 id，保证各设备结论一致）
    const canonical = ids
      .map((id) => slots.get(id)!.record)
      .sort((a, b) => a.addedAt - b.addedAt || (a.id < b.id ? -1 : 1))[0]
    for (const id of ids) {
      if (id === canonical.id) continue
      const loser = slots.get(id)!.record
      const winner = slots.get(canonical.id)!
      // 注意：canonical 变量捕获的是循环开始时的记录对象，winner.record 每轮被替换，
      // 必须重读当前值参与合并，否则三份以上重复会丢掉前几轮并入的收藏/标签
      const current = winner.record
      const mergedFavorite = current.favorite || loser.favorite
      const mergedTags = Array.from(new Set([...current.tags, ...loser.tags]))
      const lww = pickRecordFields(current, loser)
      winner.record = {
        ...lww,
        favorite: mergedFavorite,
        tags: mergedTags,
        updatedAt: Math.max(current.updatedAt, loser.updatedAt)
      }
      // 本地文件信息转移到规范记录（ loser 本地有文件而 canonical 没有）
      if (!winner.local && slots.get(id)!.local) {
        winner.local = slots.get(id)!.local
      }
      dedupLosers.add(id)
      stats.deduped++
    }
  }
  // 去重淘汰者写墓碑，传播删除到其他设备
  const now = Date.now()
  for (const id of dedupLosers) {
    tombstoneMap.set(id, { id, kind: 'image', deletedAt: now, deletedBy: 'dedup' })
    slots.delete(id)
  }

  // ---------- 4) 分类合并 ----------
  const catMap = new Map<string, Category>()
  for (const c of localCategories) {
    if (isDead(c.id)) continue
    catMap.set(c.id, c)
  }
  for (const m of remoteManifests) {
    for (const c of m.categories) {
      if (isDead(c.id)) continue
      const existing = catMap.get(c.id)
      if (!existing) {
        catMap.set(c.id, c)
        stats.pulled++
      } else {
        const winner = pickRecordFields(existing, c)
        if (winner !== existing) {
          catMap.set(c.id, winner)
          stats.pulled++
        }
      }
    }
  }

  // ---------- 5) 产出本地 ImageItem（保留本地态；远端-only 标记 localFile=false） ----------
  const images: ImageItem[] = Array.from(slots.entries()).map(([id, slot]) => ({
    id,
    fileName: slot.record.fileName,
    hash: slot.record.hash,
    width: slot.record.width,
    height: slot.record.height,
    sizeBytes: slot.record.sizeBytes,
    format: slot.record.format,
    categoryId: slot.record.categoryId,
    tags: slot.record.tags,
    favorite: slot.record.favorite,
    addedAt: slot.record.addedAt,
    updatedAt: slot.record.updatedAt,
    updatedBy: slot.record.updatedBy,
    path: slot.local?.path ?? '',
    sourcePath: slot.local?.sourcePath ?? '',
    localFile: slot.local?.localFile ?? false
  }))

  // 按 order 排序（缺省排最后），保证各设备分类顺序一致
  let categories = Array.from(catMap.values()).sort(
    (a, b) => (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER) || (a.id < b.id ? -1 : 1)
  )

  // ---------- 5.5) 同名分类去重 ----------
  // 各设备首次启动都会生成同名预置分类（id 各自随机），按 id 合并必产生同名重复；
  // 保留 LWW 胜者（全平局取小 id 保证各设备结论一致），图片引用改指保留者，败者写墓碑防复活。
  {
    const catByName = new Map<string, Category[]>()
    for (const c of categories) {
      const list = catByName.get(c.name) ?? []
      list.push(c)
      catByName.set(c.name, list)
    }
    const catRemap = new Map<string, string>()
    for (const [, list] of catByName) {
      if (list.length < 2) continue
      const keeper = list
        .slice()
        .sort((a, b) => (newer(a, b) ? -1 : newer(b, a) ? 1 : a.id < b.id ? -1 : 1))[0]
      for (const c of list) {
        if (c.id === keeper.id) continue
        catRemap.set(c.id, keeper.id)
        tombstoneMap.set(c.id, { id: c.id, kind: 'category', deletedAt: now, deletedBy: 'dedup' })
        stats.deduped++
      }
    }
    if (catRemap.size > 0) {
      for (const img of images) {
        if (img.categoryId == null) continue
        const mapped = catRemap.get(img.categoryId)
        if (mapped) {
          img.categoryId = mapped
          // 打新时间戳让改挂在 LWW 中胜出：否则对端本地记录与改挂版本 updatedAt
          // 打平、旧 categoryId 胜回，图片会指向已被墓碑的败者分类（孤儿引用）
          img.updatedAt = now
        }
      }
      categories = categories.filter((c) => !catRemap.has(c.id))
    }
  }

  // ---------- 5.6) 孤儿分类引用兜底 ----------
  // 重定向映射只存在于本次合并内存中；离线设备稍后上传的新图可能仍引用
  // 已被去重/删除的旧分类 id——统一回落到"未分类"，保证图片始终可见。
  {
    const catIds = new Set(categories.map((c) => c.id))
    for (const img of images) {
      if (img.categoryId != null && !catIds.has(img.categoryId)) {
        img.categoryId = null
      }
    }
  }

  // ---------- 6) 是否需要发布新清单 ----------
  // 计算合并后的"远端理想态"：全部 slots 记录 + 分类 + 墓碑
  const tombstones = Array.from(tombstoneMap.values()).sort((a, b) => a.deletedAt - b.deletedAt)
  const idealRecords = images.map(toRecord).sort((a, b) => (a.id < b.id ? -1 : 1))
  const idealCategories = [...categories].sort((a, b) => (a.id < b.id ? -1 : 1))
  const idealTombstones = [...tombstones].sort((a, b) => (a.id < b.id ? -1 : 1))

  const sameAs = (m: SyncManifest): boolean =>
    JSON.stringify([m.images, m.categories, m.tombstones]) ===
    JSON.stringify([idealRecords, idealCategories, idealTombstones])

  // 远端任一清单已等于理想态且本设备最后发布也在其中 → 无需重复发布
  const manifestToPublish: SyncManifest | null = remoteManifests.some(sameAs)
    ? null
    : {
        version: 1,
        updatedAt: now,
        updatedBy: '', // engine 填 deviceId
        images: idealRecords,
        categories: idealCategories,
        tombstones: idealTombstones
      }

  stats.pushed = manifestToPublish ? idealRecords.length : 0

  return { images, categories, tombstones, manifestToPublish, stats }
}
