/**
 * A5：素材库 SQLite 存储（better-sqlite3 v13，N-API 预编译 —— Node/Electron 同一二进制，零 rebuild）
 *
 * 替换 library.json 整文件重写：
 * - WAL 日志 + 事务写入：崩溃安全，不再有"防抖窗口内整文件损坏/丢失"面
 * - 行级 upsert + 剪枝：保存只重写变更行的数据量级，不再 pretty-print 全库 JSON
 * - 记录以 JSON 文档存 data 列（id/updatedAt 为真实列）：字段演进无 schema 漂移，
 *   与同步清单（同为 JSON 文档）保持同构；未来可加列做增量查询
 *
 * 本模块零 electron 依赖（db 文件路径显式传入），可被 vitest 直接测试。
 * 小型存储（settings/history/tombstones/bubble/slideshow）仍用 JsonStore：
 * 数据量有界且 settings 需保持 JSON（存储目录引导期的循环依赖，见 paths.ts 注释）。
 */
import fs from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'
import type { Category, ImageItem, LibraryData, SmartAlbum } from '@shared/types'

export type LibraryDb = Database.Database

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS images (
  id        TEXT PRIMARY KEY,
  updatedAt INTEGER NOT NULL DEFAULT 0,
  data      TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS categories (
  id   TEXT PRIMARY KEY,
  data TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS albums (
  id   TEXT PRIMARY KEY,
  data TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS tags (
  name TEXT PRIMARY KEY
);
CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_images_updatedAt ON images(updatedAt);
`

/** 打开（必要时创建）素材库 db：WAL + NORMAL 同步（崩溃安全与写入速度的平衡点） */
export function openLibraryDb(file: string): LibraryDb {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const db = new Database(file)
  db.pragma('journal_mode = WAL')
  db.pragma('synchronous = NORMAL')
  db.exec(SCHEMA_SQL)
  return db
}

interface DataRow {
  data: string
}
interface TagRow {
  name: string
}

/** 全量加载为内存 LibraryData（与旧 JSON 结构同形，服务层零改动） */
export function loadLibraryData(db: LibraryDb): LibraryData {
  const images = db
    .prepare('SELECT data FROM images')
    .all()
    .map((row) => JSON.parse((row as DataRow).data) as ImageItem)
  const categories = db
    .prepare('SELECT data FROM categories')
    .all()
    .map((row) => JSON.parse((row as DataRow).data) as Category)
  const albums = db
    .prepare('SELECT data FROM albums')
    .all()
    .map((row) => JSON.parse((row as DataRow).data) as SmartAlbum)
  const tags = db
    .prepare('SELECT name FROM tags')
    .all()
    .map((row) => (row as TagRow).name)
  return { images, categories, tags, albums }
}

/**
 * 单事务持久化：images/categories/albums 按 id upsert + 剪枝已删记录，
 * tags 是小表整体替换。剪枝用 json_each 避免 NOT IN 的参数上限。
 */
export function saveLibraryData(db: LibraryDb, data: LibraryData): void {
  const upsertImage = db.prepare(
    `INSERT INTO images(id, updatedAt, data) VALUES (?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET updatedAt = excluded.updatedAt, data = excluded.data`
  )
  const upsertCategory = db.prepare(
    `INSERT INTO categories(id, data) VALUES (?, ?)
     ON CONFLICT(id) DO UPDATE SET data = excluded.data`
  )
  const upsertAlbum = db.prepare(
    `INSERT INTO albums(id, data) VALUES (?, ?)
     ON CONFLICT(id) DO UPDATE SET data = excluded.data`
  )
  const prune = (table: 'images' | 'categories' | 'albums', ids: string[]): void => {
    db.prepare(`DELETE FROM ${table} WHERE id NOT IN (SELECT value FROM json_each(?))`).run(
      JSON.stringify(ids)
    )
  }
  const insertTag = db.prepare('INSERT INTO tags(name) VALUES (?)')

  const tx = db.transaction(() => {
    for (const img of data.images) {
      upsertImage.run(img.id, img.updatedAt ?? 0, JSON.stringify(img))
    }
    prune(
      'images',
      data.images.map((i) => i.id)
    )
    for (const cat of data.categories) {
      upsertCategory.run(cat.id, JSON.stringify(cat))
    }
    prune(
      'categories',
      data.categories.map((c) => c.id)
    )
    for (const album of data.albums) {
      upsertAlbum.run(album.id, JSON.stringify(album))
    }
    prune(
      'albums',
      data.albums.map((a) => a.id)
    )
    db.prepare('DELETE FROM tags').run()
    for (const tag of data.tags) insertTag.run(tag)
  })
  tx()
}

/**
 * 一次性迁移 data/library.json → SQLite：
 * - 仅当库为空、JSON 存在且未打过迁移标记时执行（防止旧 JSON 覆盖新数据）
 * - 成功后 JSON 改名为 .migrated 保留备份（绝不删除用户数据）
 * - 迁移标记在数据写入之后落库：JSON 损坏时抛错且不打标记，修复后可重试
 */
export function migrateLibraryFromJson(db: LibraryDb, jsonFile: string): boolean {
  if (!fs.existsSync(jsonFile)) return false
  const flagged = db.prepare(`SELECT value FROM meta WHERE key = 'migratedFromJson'`).get()
  if (flagged) return false
  const existing = db.prepare('SELECT COUNT(*) AS n FROM images').get() as { n: number }
  if (existing.n > 0) return false

  const parsed = JSON.parse(fs.readFileSync(jsonFile, 'utf-8')) as Partial<LibraryData>
  const data: LibraryData = {
    images: parsed.images ?? [],
    categories: parsed.categories ?? [],
    tags: parsed.tags ?? [],
    albums: parsed.albums ?? []
  }
  saveLibraryData(db, data)
  db.prepare(`INSERT INTO meta(key, value) VALUES ('migratedFromJson', ?)`).run(
    new Date().toISOString()
  )
  fs.renameSync(jsonFile, `${jsonFile}.migrated`)
  console.log(`[db] 素材库已从 ${path.basename(jsonFile)} 迁移至 SQLite（原文件保留为 .migrated）`)
  return true
}

/**
 * 与 JsonStore 同 API 的 SQLite 存储（library.ts 直接替换构造即可）：
 * get() 返回内存活对象（服务层保留就地变更习惯），flush() 单事务落盘。
 */
export class LibraryDbStore {
  private readonly db: LibraryDb
  private data: LibraryData
  private timer: NodeJS.Timeout | null = null

  constructor(dbFile: string, defaults: LibraryData, legacyJsonFile?: string) {
    this.db = openLibraryDb(dbFile)
    if (legacyJsonFile) migrateLibraryFromJson(this.db, legacyJsonFile)
    this.data = { ...defaults, ...loadLibraryData(this.db) }
  }

  get(): LibraryData {
    return this.data
  }

  /** 浅合并更新并调度防抖落盘，返回合并后的完整数据（同 JsonStore.set） */
  set(patch: Partial<LibraryData>): LibraryData {
    this.data = { ...this.data, ...patch }
    this.scheduleSave()
    return this.data
  }

  /** 整体替换并调度防抖落盘（同 JsonStore.replace） */
  replace(data: LibraryData): LibraryData {
    this.data = data
    this.scheduleSave()
    return this.data
  }

  private scheduleSave(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => this.flush(), 300)
  }

  /** 立即单事务落盘（退出前 / 迁移存储目录前调用） */
  flush(): void {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    try {
      saveLibraryData(this.db, this.data)
    } catch (err) {
      console.error('[db] 素材库写入失败:', err)
    }
  }

  /** WAL 检查点截断：整目录复制（更换存储位置）前调用，保证副本自包含 */
  checkpoint(): void {
    try {
      this.db.pragma('wal_checkpoint(TRUNCATE)')
    } catch (err) {
      console.error('[db] WAL 检查点失败:', err)
    }
  }

  close(): void {
    this.flush()
    this.db.close()
  }
}
