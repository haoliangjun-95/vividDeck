/**
 * 素材库服务：导入、元信息、分类、标签、收藏、重命名、删除
 * 所有文件操作收敛在本模块（UI 不直接碰文件），为二期 MinIO 同步预留边界。
 */
import { app, shell } from 'electron'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'
import {
  DEFAULT_CATEGORY_NAMES,
  SUPPORTED_EXTENSIONS,
  type Category,
  type CropRect,
  type ImageFormat,
  type ImageItem,
  type ImportResult,
  type LibraryData
} from '@shared/types'
import { JsonStore } from './store'
import { collectImageFiles, genId, hashFile, sanitizeFileName, splitFileName } from '../utils/fs'
import { libraryDir } from './paths'
import { ensureThumb, purgeCache } from './thumbnails'
import { getSettings } from './settings'
import { getDeviceId } from './device'
import { addTombstone } from './tombstones'
import type { SyncImageRecord } from '@shared/types'

// ---------- 持久化 ----------
const libraryStore = new JsonStore<LibraryData>('library', {
  images: [],
  categories: [],
  tags: []
})

/** 素材库变化监听（同步引擎注册，用于防抖触发增量同步） */
const changeListeners = new Set<() => void>()

export function onLibraryChanged(cb: () => void): () => void {
  changeListeners.add(cb)
  return () => changeListeners.delete(cb)
}

function notifyChanged(): void {
  for (const cb of changeListeners) {
    try {
      cb()
    } catch (err) {
      console.error('[library] 变更监听器执行失败:', err)
    }
  }
}

/** 记录时间戳（同步 LWW 依据） */
function stamp<T extends { updatedAt?: number; updatedBy?: string }>(record: T): void {
  record.updatedAt = Date.now()
  record.updatedBy = getDeviceId()
}

/** 首次启动：创建预置分类；并把一期旧记录补齐同步字段（updatedAt/localFile） */
function ensureDefaultCategories(): void {
  const data = libraryStore.get()
  if (data.categories.length === 0) {
    data.categories = DEFAULT_CATEGORY_NAMES.map((name, i) => ({
      id: genId(),
      name,
      createdAt: Date.now() + i,
      updatedAt: Date.now()
    }))
    libraryStore.flush()
  }
}
ensureDefaultCategories()

/** 二期字段 backfill：一期记录无 updatedAt / localFile，按本地文件实际存在情况补齐 */
function backfillSyncFields(): void {
  const data = libraryStore.get()
  let dirty = false
  data.categories.forEach((cat, index) => {
    if (cat.updatedAt === undefined) {
      cat.updatedAt = cat.createdAt
      dirty = true
    }
    if (cat.order === undefined) {
      cat.order = index
      dirty = true
    }
  })
  for (const img of data.images) {
    if (img.updatedAt === undefined) {
      img.updatedAt = img.addedAt
      dirty = true
    }
    if (img.localFile === undefined) {
      img.localFile = fs.existsSync(img.path)
      dirty = true
    }
  }
  if (dirty) libraryStore.flush()
}

/**
 * 路径自愈：存储目录迁移（v1.0 平铺布局 → storage/ 根目录、或用户更换存储位置）后，
 * 记录中的绝对路径可能仍指向旧位置——按文件名在当前媒体库目录找回并回写，
 * 同时修正 localFile 标记，避免"文件明明在本地却被标成云端"。
 */
function healLibraryPaths(): void {
  const data = libraryStore.get()
  let dirty = false
  for (const img of data.images) {
    if (fs.existsSync(img.path)) {
      if (!img.localFile) {
        img.localFile = true
        dirty = true
      }
      continue
    }
    // 路径失效：尝试当前媒体库目录下的同名文件
    const candidate = path.join(libraryDir(), path.basename(img.path))
    if (fs.existsSync(candidate)) {
      const wasReference = img.path !== img.sourcePath
      img.path = candidate
      if (!wasReference || !fs.existsSync(img.sourcePath)) img.sourcePath = candidate
      img.localFile = true
      dirty = true
    } else if (img.localFile) {
      // 确实找不到本地文件：如实标记为云端
      img.localFile = false
      dirty = true
    }
  }
  if (dirty) {
    libraryStore.flush()
    console.log(`[library] 路径自愈完成（${data.images.length} 条记录已检查）`)
  }
}
backfillSyncFields()
healLibraryPaths()
backfillSyncFields()

export function getLibrary(): LibraryData {
  return libraryStore.get()
}

/** 保存并返回最新数据（标签列表从图片自动归并） */
function commit(mutator: (data: LibraryData) => void): LibraryData {
  const data = libraryStore.get()
  mutator(data)
  // 标签列表始终由图片记录归并，避免悬挂标签
  data.tags = Array.from(new Set(data.images.flatMap((img) => img.tags))).sort((a, b) =>
    a.localeCompare(b, 'zh-CN')
  )
  libraryStore.flush()
  notifyChanged()
  return { ...data }
}

// ---------- 导入 ----------

/** 读取单张图片元信息（sharp 解码，HEIC 不依赖系统编解码器） */
async function buildImageRecord(srcPath: string): Promise<Omit<ImageItem, 'id' | 'categoryId' | 'tags' | 'favorite' | 'addedAt' | 'updatedAt' | 'updatedBy' | 'localFile'>> {
  const meta = await sharp(srcPath).metadata()
  const stat = await fsp.stat(srcPath)
  const ext = path.extname(srcPath).toLowerCase()
  // heif/heic 归一化为 heic 展示
  const format = (ext === '.heif' ? 'heic' : ext.replace('.', '')) as ImageFormat
  return {
    fileName: path.basename(srcPath),
    path: srcPath,
    sourcePath: srcPath,
    hash: await hashFile(srcPath),
    width: meta.width ?? 0,
    height: meta.height ?? 0,
    sizeBytes: stat.size,
    format
  }
}

/**
 * 批量导入图片（文件或文件夹混合）
 * - copy 模式：复制到 userData/library/ 统一管理（默认）
 * - reference 模式：仅记录原路径，不复制文件
 * - 依据内容哈希去重，重复图片自动跳过
 */
export async function importPaths(paths: string[]): Promise<ImportResult> {
  // 展开文件夹
  const files: string[] = []
  for (const p of paths) {
    const stat = fs.statSync(p, { throwIfNoEntry: false })
    if (!stat) continue
    if (stat.isDirectory()) files.push(...collectImageFiles(p, SUPPORTED_EXTENSIONS))
    else if (SUPPORTED_EXTENSIONS.includes(path.extname(p).toLowerCase())) files.push(p)
  }

  const result: ImportResult = { added: 0, skipped: 0, reasons: [] }
  const importMode = getSettings().importMode
  const existingHashes = new Set(getLibrary().images.map((img) => img.hash))

  for (const src of files) {
    const base = path.basename(src)
    try {
      const record = await buildImageRecord(src)
      if (existingHashes.has(record.hash)) {
        result.skipped++
        result.reasons.push(`${base}：内容重复，已跳过`)
        continue
      }

      // 复制模式：入库保存（文件名冲突时追加短 ID）
      let storedPath = src
      if (importMode === 'copy') {
        const { base: nameOnly, ext } = splitFileName(base)
        let target = path.join(libraryDir(), sanitizeFileName(base))
        if (fs.existsSync(target)) target = path.join(libraryDir(), `${sanitizeFileName(nameOnly)}_${genId().slice(-6)}${ext}`)
        await fsp.copyFile(src, target)
        storedPath = target
      }

      const image: ImageItem = {
        id: genId(),
        ...record,
        path: storedPath,
        fileName: path.basename(storedPath),
        categoryId: null,
        tags: [],
        favorite: false,
        addedAt: Date.now(),
        updatedAt: Date.now(),
        updatedBy: getDeviceId(),
        localFile: true
      }
      existingHashes.add(image.hash)
      commit((data) => data.images.push(image))
      // 预生成缩略图，画廊首屏即有图
      await ensureThumb(image).catch(() => undefined)
      result.added++
    } catch (err) {
      result.skipped++
      result.reasons.push(`${base}：无法解析（可能已损坏或格式不受支持）`)
      console.error('[library] 导入失败:', src, err)
    }
  }
  return result
}

// ---------- 图片操作 ----------

/** 重命名：复制模式同步重命名库内文件；引用模式仅更新显示名（不动用户原文件） */
export function renameImage(id: string, newFileName: string): LibraryData {
  const image = getLibrary().images.find((img) => img.id === id)
  if (!image) return getLibrary()
  const safe = sanitizeFileName(newFileName)
  const { ext } = splitFileName(image.fileName)
  const nextName = ext && !safe.toLowerCase().endsWith(ext) ? `${safe}${ext}` : safe

  if (image.path === image.sourcePath) {
    // 引用模式：只改记录
    return commit((data) => {
      const target = data.images.find((img) => img.id === id)
      if (target) {
        target.fileName = nextName
        stamp(target)
      }
    })
  }
  const target = path.join(path.dirname(image.path), nextName)
  fs.renameSync(image.path, target)
  return commit((data) => {
    const item = data.images.find((img) => img.id === id)
    if (item) {
      item.path = target
      item.fileName = nextName
      stamp(item)
    }
  })
}

/**
 * 删除图片记录：
 * - 复制模式：库内文件移入系统废纸篓（可恢复）
 * - 引用模式：仅移除记录，不删除用户磁盘上的原文件
 * - 写入墓碑，经同步传播到其他设备
 */
export async function deleteImage(id: string): Promise<LibraryData> {
  const image = getLibrary().images.find((img) => img.id === id)
  if (image && image.path !== image.sourcePath) {
    await shell.trashItem(image.path).catch((err) => console.error('[library] 移入废纸篓失败:', err))
  }
  purgeCache(id)
  addTombstone(id, 'image')
  return commit((data) => {
    data.images = data.images.filter((img) => img.id !== id)
  })
}

/** 更新图片属性（收藏 / 分类 / 标签） */
export function updateImage(id: string, patch: Partial<Pick<ImageItem, 'favorite' | 'categoryId' | 'tags'>>): LibraryData {
  return commit((data) => {
    const target = data.images.find((img) => img.id === id)
    if (!target) return
    if (patch.favorite !== undefined) target.favorite = patch.favorite
    if (patch.categoryId !== undefined) target.categoryId = patch.categoryId
    if (patch.tags !== undefined) target.tags = Array.from(new Set(patch.tags.map((t) => t.trim()).filter(Boolean)))
    stamp(target)
  })
}

/** 批量按图设置标签（每张图可不同，支持增/删混合语义；单次事务） */
export function setTagsMany(entries: { id: string; tags: string[] }[]): LibraryData {
  const map = new Map(entries.map((e) => [e.id, e.tags]))
  return commit((data) => {
    for (const target of data.images) {
      const tags = map.get(target.id)
      if (!tags) continue
      target.tags = Array.from(new Set(tags.map((t) => t.trim()).filter(Boolean)))
      stamp(target)
    }
  })
}

/** 批量更新属性（单次事务：一次 commit 一次落盘，时间戳统一） */
export function updateImages(ids: string[], patch: Partial<Pick<ImageItem, 'favorite' | 'categoryId' | 'tags'>>): LibraryData {
  const idSet = new Set(ids)
  return commit((data) => {
    for (const target of data.images) {
      if (!idSet.has(target.id)) continue
      if (patch.favorite !== undefined) target.favorite = patch.favorite
      if (patch.categoryId !== undefined) target.categoryId = patch.categoryId
      if (patch.tags !== undefined) target.tags = Array.from(new Set(patch.tags.map((t) => t.trim()).filter(Boolean)))
      stamp(target)
    }
  })
}

/** 批量删除：单次事务移除记录 + 批量写墓碑（同步传播）+ 清理缓存与文件 */
export async function deleteImages(ids: string[]): Promise<LibraryData> {
  const idSet = new Set(ids)
  const targets = getLibrary().images.filter((img) => idSet.has(img.id))
  for (const image of targets) {
    if (image.path !== image.sourcePath) {
      await shell.trashItem(image.path).catch((err) => console.error('[library] 移入废纸篓失败:', err))
    }
    purgeCache(image.id)
    addTombstone(image.id, 'image')
  }
  return commit((data) => {
    data.images = data.images.filter((img) => !idSet.has(img.id))
  })
}

/** 基于原图裁剪并另存为新图片（sharp 在原图上执行，保证画质） */
export async function cropToNewImage(imageId: string, rect: CropRect, label: string): Promise<ImageItem> {
  const image = getLibrary().images.find((img) => img.id === imageId)
  if (!image) throw new Error('原图不存在')
  const { base } = splitFileName(image.fileName)
  const newName = `${sanitizeFileName(label || `${base}_裁剪`)}_${genId().slice(-4)}.jpg`
  const target = path.join(libraryDir(), newName)
  await sharp(image.path)
    .extract({ left: Math.round(rect.x), top: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) })
    .jpeg({ quality: 95 })
    .toFile(target)

  const stat = await fsp.stat(target)
  const newImage: ImageItem = {
    id: genId(),
    fileName: newName,
    path: target,
    sourcePath: target,
    hash: await hashFile(target),
    width: Math.round(rect.width),
    height: Math.round(rect.height),
    sizeBytes: stat.size,
    format: 'jpeg',
    categoryId: image.categoryId,
    tags: [...image.tags],
    favorite: false,
    addedAt: Date.now(),
    updatedAt: Date.now(),
    updatedBy: getDeviceId(),
    localFile: true
  }
  commit((data) => data.images.push(newImage))
  await ensureThumb(newImage).catch(() => undefined)
  return newImage
}

// ---------- 分类 ----------

export function addCategory(name: string): LibraryData {
  const safe = name.trim()
  if (!safe) return getLibrary()
  return commit((data) => {
    if (data.categories.some((c) => c.name === safe)) return
    data.categories.push({ id: genId(), name: safe, createdAt: Date.now(), updatedAt: Date.now() })
  })
}

export function renameCategory(id: string, name: string): LibraryData {
  return commit((data) => {
    const target = data.categories.find((c) => c.id === id)
    if (target && name.trim()) {
      target.name = name.trim()
      target.updatedAt = Date.now()
    }
  })
}

/** 拖拽排序：按给定 id 顺序重排并落 order 字段（同步传播；单次事务） */
export function reorderCategories(idsInOrder: string[]): LibraryData {
  return commit((data) => {
    const pos = new Map(idsInOrder.map((id, i) => [id, i]))
    const reordered = [...data.categories].sort(
      (a, b) => (pos.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (pos.get(b.id) ?? Number.MAX_SAFE_INTEGER)
    )
    reordered.forEach((cat, index) => {
      if (cat.order !== index) {
        cat.order = index
        cat.updatedAt = Date.now()
      }
    })
    data.categories = reordered
  })
}

/** 删除分类：该分类下图片回到"未分类"，不删除任何图片文件；墓碑同步传播 */
export function deleteCategory(id: string): LibraryData {
  addTombstone(id, 'category')
  return commit((data) => {
    data.categories = data.categories.filter((c) => c.id !== id)
    for (const img of data.images) {
      if (img.categoryId === id) {
        img.categoryId = null
        stamp(img)
      }
    }
  })
}

// ---------- 同步引擎专用入口 ----------

/**
 * 应用远端合并结果（sync/engine 调用）：
 * 本地有文件的记录保留本地 path/localFile，其余按合并结果落地。
 */
export function applySyncMerge(images: ImageItem[], categories: Category[]): LibraryData {
  return commit((data) => {
    data.images = images
    data.categories = categories
  })
}

/** 按需下载完成后回填本地文件路径（sync 引擎调用） */
export function markLocalFile(id: string, filePath: string): void {
  commit((data) => {
    const target = data.images.find((img) => img.id === id)
    if (target) {
      target.path = filePath
      target.sourcePath = filePath
      target.localFile = true
      // 仅回填文件路径，不更新 updatedAt（避免覆盖远端元数据的时间戳）
    }
  })
}

/** ImageItem → 同步传输记录（剥离本地路径等设备相关字段） */
export function toSyncRecord(img: ImageItem): SyncImageRecord {
  return {
    id: img.id,
    fileName: img.fileName,
    hash: img.hash,
    width: img.width,
    height: img.height,
    sizeBytes: img.sizeBytes,
    format: img.format,
    categoryId: img.categoryId,
    tags: img.tags,
    favorite: img.favorite,
    addedAt: img.addedAt,
    updatedAt: img.updatedAt,
    updatedBy: img.updatedBy ?? ''
  }
}

/** 退出前落盘 */
export function flushLibrary(): void {
  libraryStore.flush()
}

export type { Category }
