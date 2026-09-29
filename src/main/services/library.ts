/**
 * 素材库服务：导入、元信息、分类、标签、收藏、重命名、删除
 * 所有文件操作收敛在本模块（UI 不直接碰文件），为二期 MinIO 同步预留边界。
 */
import { shell } from 'electron'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'
import {
  DEFAULT_CATEGORY_NAMES,
  type SmartAlbum,
  type SmartAlbumRules,
  SUPPORTED_EXTENSIONS,
  type Category,
  type CropRect,
  type ImageFormat,
  type ImageItem,
  type ImportResult,
  type LibraryData
} from '@shared/types'
import { LibraryDbStore } from './db'
import {
  assertInside,
  collectImageFiles,
  genId,
  hashFile,
  sanitizeFileName,
  sanitizeIdSegment,
  splitFileName
} from '../utils/fs'
import { readTakenAt } from '../utils/exif'
import { runPool } from '../utils/concurrency'
import { dataDir, isRealFile, libraryDir, storageRoot, trashStagingDir } from './paths'
import { ensureThumb, purgeCache } from './thumbnails'
import { getSettings } from './settings'
import { getDeviceId } from './device'
import { matchAlbum } from '@shared/album'
import { normalizeTagName, rewriteAlbumsForTag } from '@shared/tagOps'
import { addTombstone, removeTombstones } from './tombstones'
import type { SyncImageRecord } from '@shared/types'

// ---------- 持久化（A5：SQLite，首次启动自动迁移旧 library.json 并保留 .migrated 备份） ----------
const libraryStore = new LibraryDbStore(
  path.join(dataDir(), 'library.db'),
  { images: [], categories: [], tags: [], albums: [] },
  path.join(dataDir(), 'library.json')
)

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

/** 旧数据 albums 字段兜底 */
function ensureAlbumsField(): void {
  const data = libraryStore.get()
  if (!data.albums) {
    libraryStore.set({ albums: [] } as Partial<LibraryData>)
    libraryStore.flush()
  }
}
ensureAlbumsField()

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
      img.localFile = isRealFile(img.path)
      dirty = true
    }
  }
  if (dirty) libraryStore.flush()
}

/**
 * 路径自愈：存储目录迁移（v1.0 平铺布局 → storage/ 根目录、或用户更换存储位置）后，
 * 记录中的绝对路径可能仍指向旧位置——按文件名在当前媒体库目录找回并回写，
 * 同时修正 localFile 标记，避免"文件明明在本地却被标成云端"。
 *
 * 注意：判断一律用 isRealFile（必须是文件，目录不算）——云端记录 path 为空串时
 * basename 也是空串，join 出媒体库目录本身，若用 existsSync 会被目录骗过，
 * 把云端记录错标成本地（path 还被写成目录路径，点击 404、下载入口消失）。
 */
function healLibraryPaths(): void {
  const data = libraryStore.get()
  let dirty = false
  const catIds = new Set(data.categories.map((c) => c.id))
  for (const img of data.images) {
    // 孤儿分类引用：指向已不存在的分类 → 回到未分类（图片不再从视图中消失）
    if (img.categoryId != null && !catIds.has(img.categoryId)) {
      img.categoryId = null
      dirty = true
    }

    // 库内路径但不在当前存储根（更换存储位置为"复制"后旧目录仍存在）：
    // 显式改写到当前媒体库，避免之后清理旧目录时批量断链
    const name = path.basename(img.path)
    const candidate = name ? path.join(libraryDir(), name) : ''
    const looksLikeLibraryPath = /[\\/]vividdeck[\\/]storage[\\/]library[\\/]/i.test(img.path)
    if (
      looksLikeLibraryPath &&
      candidate &&
      isRealFile(candidate) &&
      path.resolve(candidate) !== path.resolve(img.path)
    ) {
      img.path = candidate
      img.sourcePath = candidate
      img.localFile = true
      dirty = true
      continue
    }

    if (isRealFile(img.path)) {
      if (!img.localFile) {
        img.localFile = true
        dirty = true
      }
      continue
    }
    // 路径失效：尝试当前媒体库目录下的同名文件（空 basename 跳过，避免匹配到目录）
    if (candidate && isRealFile(candidate)) {
      const wasReference = img.path !== img.sourcePath
      img.path = candidate
      if (!wasReference || !fs.existsSync(img.sourcePath)) img.sourcePath = candidate
      img.localFile = true
      dirty = true
    } else if (img.localFile) {
      // 确实找不到本地文件：如实标记为云端，清掉无效路径（按需下载后回填）
      img.localFile = false
      img.path = ''
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

/**
 * 保存并返回最新数据（标签列表从图片自动归并）。
 * C2：落盘走防抖 scheduleSave（300ms 合并）而非同步 flush ——
 * 逐图 commit 的批量操作（导入/下载回填/恢复）不再每次全量重写文件；
 * 退出与迁移路径仍由 flushLibrary() 强制落盘。
 */
function commit(mutator: (data: LibraryData) => void): LibraryData {
  const data = libraryStore.get()
  mutator(data)
  // 标签列表始终由图片记录归并，避免悬挂标签
  data.tags = Array.from(new Set(data.images.flatMap((img) => img.tags))).sort((a, b) =>
    a.localeCompare(b, 'zh-CN')
  )
  libraryStore.save()
  notifyChanged()
  return { ...data }
}

// ---------- 导入 ----------

/** 读取单张图片元信息（sharp 解码，HEIC 不依赖系统编解码器） */
async function buildImageRecord(
  srcPath: string
): Promise<
  Omit<
    ImageItem,
    'id' | 'categoryId' | 'tags' | 'favorite' | 'addedAt' | 'updatedAt' | 'updatedBy' | 'localFile'
  >
> {
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
    format,
    takenAt: readTakenAt(meta.exif)
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
        if (fs.existsSync(target))
          target = path.join(
            libraryDir(),
            `${sanitizeFileName(nameOnly)}_${genId().slice(-6)}${ext}`
          )
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
  // 目标文件名唯一化：避免 rename 静默覆盖库内已有文件（POSIX rename 语义）
  // 例外：仅大小写变化视为同一文件（大小不敏感卷上 existsSync 会误报冲突）
  let target = path.join(path.dirname(image.path), nextName)
  if (
    fs.existsSync(target) &&
    path.resolve(target).toLowerCase() !== path.resolve(image.path).toLowerCase()
  ) {
    const { base: nameOnly, ext } = splitFileName(nextName)
    target = path.join(
      path.dirname(image.path),
      `${sanitizeFileName(nameOnly)}_${genId().slice(-6)}${ext}`
    )
  }
  fs.renameSync(image.path, target)
  return commit((data) => {
    const item = data.images.find((img) => img.id === id)
    if (item) {
      item.path = target
      item.fileName = path.basename(target)
      stamp(item)
    }
  })
}

/**
 * 删除单张图片：委托批量路径（H9）。
 * 旧实现用 path !== sourcePath 启发式判断复制模式 —— 同步合并/自愈后
 * 复制记录的 sourcePath 已归一化为库路径，原图永不进回收站（孤儿文件），
 * 且绕过 staging 无法撤销。批量路径以 isLibraryFile 判断，行为正确。
 */
export async function deleteImage(id: string): Promise<LibraryData> {
  return deleteImages([id], 'all')
}

/** 更新图片属性（收藏 / 分类 / 标签） */
export function updateImage(
  id: string,
  patch: Partial<Pick<ImageItem, 'favorite' | 'categoryId' | 'tags'>>
): LibraryData {
  return commit((data) => {
    const target = data.images.find((img) => img.id === id)
    if (!target) return
    if (patch.favorite !== undefined) target.favorite = patch.favorite
    if (patch.categoryId !== undefined) target.categoryId = patch.categoryId
    if (patch.tags !== undefined)
      target.tags = Array.from(new Set(patch.tags.map((t) => t.trim()).filter(Boolean)))
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
export function updateImages(
  ids: string[],
  patch: Partial<Pick<ImageItem, 'favorite' | 'categoryId' | 'tags'>>
): LibraryData {
  const idSet = new Set(ids)
  return commit((data) => {
    for (const target of data.images) {
      if (!idSet.has(target.id)) continue
      if (patch.favorite !== undefined) target.favorite = patch.favorite
      if (patch.categoryId !== undefined) target.categoryId = patch.categoryId
      if (patch.tags !== undefined)
        target.tags = Array.from(new Set(patch.tags.map((t) => t.trim()).filter(Boolean)))
      stamp(target)
    }
  })
}

// ---------- 标签管理（重命名 / 合并 / 删除，规则改写见 shared/tagOps） ----------

/** 重命名标签：全库图片 tags 替换（撞名合并去重），相册规则同步改写；返回受影响图片数 */
export function renameTag(from: string, to: string): { renamed: number } {
  const name = normalizeTagName(to)
  if (!name || name === from) throw new Error('新标签名不合法')
  let renamed = 0
  commit((data) => {
    for (const img of data.images) {
      if (!img.tags.includes(from)) continue
      img.tags = Array.from(new Set(img.tags.map((t) => (t === from ? name : t))))
      stamp(img)
      renamed++
    }
    data.albums = rewriteAlbumsForTag(data.albums ?? [], from, name)
  })
  return { renamed }
}

/** 合并标签：sources 并入 into（去重），相册规则改写；返回受影响图片数 */
export function mergeTags(sources: string[], into: string): { merged: number } {
  const target = normalizeTagName(into)
  if (!target) throw new Error('目标标签名不合法')
  const srcSet = new Set(sources.map((s) => s.trim()).filter((s) => s && s !== target))
  if (srcSet.size === 0) throw new Error('没有可合并的源标签')
  let merged = 0
  commit((data) => {
    for (const img of data.images) {
      if (!img.tags.some((t) => srcSet.has(t))) continue
      img.tags = Array.from(new Set([...img.tags.filter((t) => !srcSet.has(t)), target]))
      stamp(img)
      merged++
    }
    for (const from of srcSet) {
      data.albums = rewriteAlbumsForTag(data.albums ?? [], from, target)
    }
  })
  return { merged }
}

/** 删除标签：从全库图片与相册规则中移除；返回受影响图片数 */
export function deleteTag(tag: string): { removed: number } {
  let removed = 0
  commit((data) => {
    for (const img of data.images) {
      if (!img.tags.includes(tag)) continue
      img.tags = img.tags.filter((t) => t !== tag)
      stamp(img)
      removed++
    }
    data.albums = rewriteAlbumsForTag(data.albums ?? [], tag, null)
  })
  return { removed }
}

/** 删除模式：all = 所有设备（墓碑同步传播）；local = 仅清理本地副本（不同步） */
export type DeleteMode = 'all' | 'local'

/** 该记录的文件是否由媒体库管理（位于 library/ 目录内；引用模式文件在库外） */
function isLibraryFile(filePath: string): boolean {
  return filePath.startsWith(libraryDir() + path.sep)
}

/** 把库内文件移入删除暂存区（返回 staging 路径；库外引用文件/文件缺失返回 null）
 *  注意：不能再用 path===sourcePath 判断引用模式——经同步合并/自愈后
 *  复制模式记录的 sourcePath 也已归一化为库路径 */
async function moveToStaging(image: ImageItem): Promise<string | null> {
  if (!isLibraryFile(image.path)) return null
  if (!isRealFile(image.path)) return null
  // H4/C1：id 与文件名均净化后再拼接，并断言落点在暂存区内
  const staging = trashStagingDir()
  const staged = assertInside(
    staging,
    path.join(
      staging,
      `${sanitizeIdSegment(image.id)}_${sanitizeFileName(path.basename(image.path))}`
    )
  )
  await fsp.rename(image.path, staged).catch(async (err) => {
    console.error('[library] 移入暂存区失败（跨卷回退复制）:', err)
    await fsp.copyFile(image.path, staged).catch(() => undefined)
    await fsp.unlink(image.path).catch(() => undefined)
  })
  return staged
}

/**
 * 批量删除（单次事务）：
 * - all：文件入暂存区（当次会话可撤销）+ 墓碑 + 移除记录
 * - local：仅清理本地副本——文件入暂存区、记录保留 localFile=false、不写墓碑
 */
export async function deleteImages(ids: string[], mode: DeleteMode = 'all'): Promise<LibraryData> {
  const idSet = new Set(ids)
  const targets = getLibrary().images.filter((img) => idSet.has(img.id))
  for (const image of targets) {
    await moveToStaging(image)
    purgeCache(image.id)
    if (mode === 'all') addTombstone(image.id, 'image')
  }
  if (mode === 'all') {
    for (const image of targets) recentDeletedRecords.set(image.id, { ...image })
    return commit((data) => {
      data.images = data.images.filter((img) => !idSet.has(img.id))
    })
  }
  return commit((data) => {
    for (const img of data.images) {
      if (!idSet.has(img.id)) continue
      img.localFile = false
      img.path = ''
    }
  })
}

/** 批量按图恢复属性（撤销逆操作；单次事务，重打时间戳以在 LWW 中胜出）
 *  A2：patch 放宽为 Partial —— 与 IPC 契约的 ImagePatch 对齐（渲染层可只带部分字段，
 *  运行时本就按 undefined 跳过，此前签名与 preload 声明存在漂移） */
export function applyEntries(
  entries: { id: string; patch: Partial<Pick<ImageItem, 'favorite' | 'categoryId' | 'tags'>> }[]
): LibraryData {
  const map = new Map(entries.map((e) => [e.id, e.patch]))
  return commit((data) => {
    for (const target of data.images) {
      const patch = map.get(target.id)
      if (!patch) continue
      if (patch.favorite !== undefined) target.favorite = patch.favorite
      if (patch.categoryId !== undefined) target.categoryId = patch.categoryId
      if (patch.tags !== undefined)
        target.tags = Array.from(new Set(patch.tags.map((t) => t.trim()).filter(Boolean)))
      stamp(target)
    }
  })
}

/**
 * 撤销删除：从暂存区移回文件 + 删除墓碑（阻止同步传播）+ 恢复记录。
 * 仅当次会话有效（退出时暂存区已清空则不可恢复，返回恢复成功数）。
 */
export async function restoreImages(ids: string[]): Promise<{ restored: number }> {
  const staging = trashStagingDir()
  const libDir = libraryDir()
  const staged = await fsp.readdir(staging).catch((): string[] => [])
  // 阶段一：文件从暂存区移回媒体库（id 净化匹配 + 落点断言，C1/H4）
  const restoredPaths = new Map<string, string>()
  for (const id of ids) {
    const prefix = `${sanitizeIdSegment(id)}_`
    const hit = staged.find((n) => n.startsWith(prefix))
    if (!hit) continue
    try {
      const back = assertInside(
        libDir,
        path.join(libDir, sanitizeFileName(hit.slice(prefix.length)))
      )
      await fsp.rename(path.join(staging, hit), back)
      restoredPaths.set(id, back)
    } catch (err) {
      console.error(`[library] 恢复 ${id} 失败:`, err)
    }
  }
  if (restoredPaths.size === 0) return { restored: 0 }
  // 阶段二：单次 commit 恢复全部记录（C2：不再逐 id 全量落盘）+ 撤销墓碑
  commit((data) => {
    for (const [id, back] of restoredPaths) {
      const existing = data.images.find((i) => i.id === id)
      if (existing) {
        existing.path = back
        existing.sourcePath = back
        existing.localFile = true
      } else {
        const rec = recentDeletedRecords.get(id)
        if (rec) data.images.push({ ...rec, path: back, sourcePath: back, localFile: true })
      }
    }
  })
  removeTombstones([...restoredPaths.keys()])
  for (const id of restoredPaths.keys()) recentDeletedRecords.delete(id)
  return { restored: restoredPaths.size }
}

/** 删除时留存的记录快照（撤销恢复用；仅内存，当次会话有效） */
const recentDeletedRecords = new Map<string, ImageItem>()

/** 退出前：清空暂存区 → 系统废纸篓（撤销窗口关闭） */
export async function purgeStaging(): Promise<void> {
  const staging = trashStagingDir()
  try {
    const files = await fsp.readdir(staging)
    for (const name of files) {
      await shell.trashItem(path.join(staging, name)).catch(() => undefined)
    }
  } catch {
    /* 目录不存在则忽略 */
  }
}

/** 基于原图裁剪并另存为新图片（sharp 在原图上执行，保证画质） */
export async function cropToNewImage(
  imageId: string,
  rect: CropRect,
  label: string
): Promise<ImageItem> {
  const image = getLibrary().images.find((img) => img.id === imageId)
  if (!image) throw new Error('原图不存在')
  const { base } = splitFileName(image.fileName)
  const newName = `${sanitizeFileName(label || `${base}_裁剪`)}_${genId().slice(-4)}.jpg`
  const target = path.join(libraryDir(), newName)
  await sharp(image.path)
    .rotate() // 与预览图一致：先按 EXIF 摆正，坐标系才与取景框对齐
    .extract({
      left: Math.round(rect.x),
      top: Math.round(rect.y),
      width: Math.round(rect.width),
      height: Math.round(rect.height)
    })
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
      (a, b) =>
        (pos.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (pos.get(b.id) ?? Number.MAX_SAFE_INTEGER)
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

// ---------- 智能相册 ----------

export function addAlbum(name: string, rules: SmartAlbumRules): LibraryData {
  const safe = name.trim()
  if (!safe) return getLibrary()
  return commit((data) => {
    data.albums = [
      ...(data.albums ?? []),
      { id: genId(), name: safe, rules, createdAt: Date.now(), updatedAt: Date.now() }
    ]
  })
}

export function updateAlbum(
  id: string,
  patch: Partial<Pick<SmartAlbum, 'name' | 'rules'>>
): LibraryData {
  return commit((data) => {
    const t = (data.albums ?? []).find((a) => a.id === id)
    if (!t) return
    if (patch.name?.trim()) t.name = patch.name.trim()
    if (patch.rules) t.rules = patch.rules
    t.updatedAt = Date.now()
  })
}

export function deleteAlbum(id: string): LibraryData {
  // 只删除相册定义，绝不触碰图片记录/文件；
  // 写 album 墓碑让删除经同步传播到其他设备，并阻止下次合并时被
  // 仍带着该相册的远端清单复活（merge 5.5b 对相册同样应用 isDead）
  addTombstone(id, 'album')
  return commit((data) => {
    data.albums = (data.albums ?? []).filter((a) => a.id !== id)
  })
}

/** 相册匹配计数（编辑器实时预览用） */
export function countAlbum(rules: SmartAlbumRules): number {
  const probe: SmartAlbum = { id: '__probe__', name: '', rules, createdAt: 0, updatedAt: 0 }
  return getLibrary().images.filter((img) => matchAlbum(img, probe)).length
}

// ---------- 同步引擎专用入口 ----------

/**
 * 应用远端合并结果（sync/engine 调用）：
 * 本地有文件的记录保留本地 path/localFile，其余按合并结果落地。
 */
export function applySyncMerge(
  images: ImageItem[],
  categories: Category[],
  albums?: SmartAlbum[]
): LibraryData {
  return commit((data) => {
    data.images = images
    data.categories = categories
    if (albums) data.albums = albums
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

/**
 * 体检修复：把确认断链的记录标记为云端（health.ts 调用）。
 * 走 commit 统一入口 —— 广播 LIBRARY_CHANGED、防抖落盘、不再原地改库。
 * 内置 isRealFile 复核：仅处理"确实断链"的记录，误报 id 不会破坏正常记录。
 */
export function markCloudOnly(ids: string[]): LibraryData {
  const idSet = new Set(ids)
  return commit((data) => {
    for (const img of data.images) {
      if (idSet.has(img.id) && img.localFile && !isRealFile(img.path)) {
        img.localFile = false
        img.path = ''
      }
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
    takenAt: img.takenAt ?? null,
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

/**
 * 周期快照（index.ts 启动时调用）：素材库是唯一不可再生数据，
 * 每周落一份 VACUUM INTO 自包含备份到 <存储根>/backups/，保留最近 4 份。
 */
export function snapshotLibraryIfDue(): string | null {
  try {
    return libraryStore.snapshotIfDue(path.join(storageRoot(), 'backups'))
  } catch (err) {
    console.error('[library] 周期快照失败（不影响使用）:', err)
    return null
  }
}

/**
 * 回填拍摄时间：为"本地有文件但 takenAt 为空"的记录读 EXIF
 * （覆盖旧版本导入的图与同步下载的图）。并发 4、单次 commit；
 * 回填会刷新 updatedAt 让其经 LWW 传播到其他设备。
 */
export async function backfillTakenAt(): Promise<{ scanned: number; updated: number }> {
  const targets = getLibrary().images.filter(
    (img) => (img.takenAt ?? null) === null && img.localFile && isRealFile(img.path)
  )
  if (targets.length === 0) return { scanned: 0, updated: 0 }
  const found = new Map<string, number>()
  await runPool(targets, 4, async (img) => {
    try {
      const meta = await sharp(img.path).metadata()
      const takenAt = readTakenAt(meta.exif)
      if (takenAt !== null) found.set(img.id, takenAt)
    } catch {
      /* 单文件解码失败跳过（断链类问题归体检管） */
    }
  })
  if (found.size > 0) {
    commit((data) => {
      for (const img of data.images) {
        const takenAt = found.get(img.id)
        if (takenAt !== undefined) {
          img.takenAt = takenAt
          stamp(img)
        }
      }
    })
  }
  return { scanned: targets.length, updated: found.size }
}

/** WAL 检查点截断：更换存储位置整目录复制前调用，保证副本自包含（数据全部在主 db 文件内） */
export function checkpointLibrary(): void {
  libraryStore.checkpoint()
}

export type { Category }
