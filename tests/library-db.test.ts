/**
 * A5 SQLite 素材库存储（services/db.ts）：
 * - 空库加载默认结构 / 保存-加载往返 / upsert + 剪枝 / tags 整体替换
 * - JSON → SQLite 一次性迁移（含非空库守卫、.migrated 改名备份）
 * - LibraryDbStore：与 JsonStore 同 API（get/set/replace/flush），就地变更可落盘
 * 夹具全合成（makeImage → img-N；时间均为 epoch 毫秒数值），文件仅写入系统临时目录。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type Database from 'better-sqlite3'
import {
  LibraryDbStore,
  loadLibraryData,
  migrateLibraryFromJson,
  openLibraryDb,
  saveLibraryData
} from '@main/services/db'
import type { Category, LibraryData, SmartAlbum } from '@shared/types'
import { makeImage, resetSeq } from './helpers'

const EMPTY: LibraryData = { images: [], categories: [], tags: [], albums: [] }

function makeCategory(id: string, name: string): Category {
  return { id, name, createdAt: 1000, updatedAt: 1000, order: 0 }
}

function makeAlbum(id: string, name: string): SmartAlbum {
  return { id, name, rules: { favoriteOnly: true }, createdAt: 1000, updatedAt: 1000 }
}

function sampleData(): LibraryData {
  resetSeq()
  return {
    images: [makeImage({ tags: ['风景'], favorite: true }), makeImage()],
    categories: [makeCategory('cat-1', '默认分类')],
    tags: ['风景', '城市'],
    albums: [makeAlbum('alb-1', '收藏集')]
  }
}

let tmpDir: string
let dbFile: string
let db: Database.Database | null = null
let store: LibraryDbStore | null = null

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vd-db-'))
  dbFile = path.join(tmpDir, 'library.db')
})

afterEach(() => {
  store?.close()
  store = null
  db?.close()
  db = null
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

// ---------- 底层读写 ----------
describe('db 底层：加载与往返', () => {
  it('空库加载得到默认空结构，且启用 WAL', () => {
    db = openLibraryDb(dbFile)
    expect(loadLibraryData(db)).toEqual(EMPTY)
    expect(db.pragma('journal_mode', { simple: true })).toBe('wal')
  })

  it('保存 → 重新打开加载：四类数据完整往返（深比较）', () => {
    const data = sampleData()
    db = openLibraryDb(dbFile)
    saveLibraryData(db, data)
    db.close()

    db = openLibraryDb(dbFile)
    expect(loadLibraryData(db)).toEqual(data)
  })

  it('upsert：修改字段再保存，行数不变、内容更新', () => {
    db = openLibraryDb(dbFile)
    const data = sampleData()
    saveLibraryData(db, data)
    // 保留两条记录、仅改第一条字段：验证 upsert 不增行且内容更新（剪枝语义由下一用例覆盖）
    const updated = {
      ...data,
      images: [{ ...data.images[0], favorite: false }, data.images[1]]
    }
    saveLibraryData(db, updated)
    const loaded = loadLibraryData(db)
    expect(loaded.images).toHaveLength(2)
    expect(loaded.images.find((i) => i.id === data.images[0].id)?.favorite).toBe(false)
  })

  it('剪枝：从数据中移除的记录，保存后库中不再存在', () => {
    db = openLibraryDb(dbFile)
    const data = sampleData()
    saveLibraryData(db, data)
    const removedId = data.images[1].id
    saveLibraryData(db, { ...data, images: [data.images[0]] })
    const loaded = loadLibraryData(db)
    expect(loaded.images.map((i) => i.id)).not.toContain(removedId)
  })

  it('tags 整体替换；categories/albums 同样 upsert+剪枝', () => {
    db = openLibraryDb(dbFile)
    const data = sampleData()
    saveLibraryData(db, data)
    saveLibraryData(db, {
      ...data,
      tags: ['城市'],
      categories: [makeCategory('cat-2', '新分类')],
      albums: []
    })
    const loaded = loadLibraryData(db)
    expect(loaded.tags).toEqual(['城市'])
    expect(loaded.categories.map((c) => c.id)).toEqual(['cat-2'])
    expect(loaded.albums).toEqual([])
  })
})

// ---------- JSON → SQLite 迁移 ----------
describe('migrateLibraryFromJson：一次性迁移', () => {
  it('库为空且 JSON 存在：导入数据、改名 .migrated、返回 true', () => {
    db = openLibraryDb(dbFile)
    const jsonFile = path.join(tmpDir, 'library.json')
    const data = sampleData()
    fs.writeFileSync(jsonFile, JSON.stringify(data), 'utf-8')

    expect(migrateLibraryFromJson(db, jsonFile)).toBe(true)
    expect(loadLibraryData(db)).toEqual(data)
    expect(fs.existsSync(jsonFile)).toBe(false)
    expect(fs.existsSync(`${jsonFile}.migrated`)).toBe(true)
  })

  it('重复迁移：第二次返回 false，不再动文件', () => {
    db = openLibraryDb(dbFile)
    const jsonFile = path.join(tmpDir, 'library.json')
    fs.writeFileSync(jsonFile, JSON.stringify(sampleData()), 'utf-8')
    migrateLibraryFromJson(db, jsonFile)
    // 再造一个 JSON（模拟残留），不应被二次导入
    const stale = { ...EMPTY, tags: ['不该出现'] }
    fs.writeFileSync(jsonFile, JSON.stringify(stale), 'utf-8')
    expect(migrateLibraryFromJson(db, jsonFile)).toBe(false)
    expect(loadLibraryData(db).tags).not.toContain('不该出现')
  })

  it('库非空守卫：已有图片时不迁移、不改动 JSON 文件', () => {
    db = openLibraryDb(dbFile)
    saveLibraryData(db, sampleData())
    const jsonFile = path.join(tmpDir, 'library.json')
    resetSeq()
    fs.writeFileSync(jsonFile, JSON.stringify({ ...EMPTY, images: [makeImage()] }), 'utf-8')

    expect(migrateLibraryFromJson(db, jsonFile)).toBe(false)
    expect(fs.existsSync(jsonFile)).toBe(true)
    expect(loadLibraryData(db).images).toHaveLength(2)
  })

  it('JSON 不存在：返回 false，不报错', () => {
    db = openLibraryDb(dbFile)
    expect(migrateLibraryFromJson(db, path.join(tmpDir, 'missing.json'))).toBe(false)
  })

  it('JSON 损坏：抛错但不写迁移标记（修复后可重试）', () => {
    db = openLibraryDb(dbFile)
    const jsonFile = path.join(tmpDir, 'library.json')
    fs.writeFileSync(jsonFile, '{broken json', 'utf-8')
    expect(() => migrateLibraryFromJson(db, jsonFile)).toThrow()
    fs.writeFileSync(jsonFile, JSON.stringify(sampleData()), 'utf-8')
    expect(migrateLibraryFromJson(db, jsonFile)).toBe(true)
  })
})

// ---------- LibraryDbStore（JsonStore 同 API） ----------
describe('LibraryDbStore：与 JsonStore 同接口的 SQLite 存储', () => {
  it('新库构造：get() 返回默认空结构', () => {
    store = new LibraryDbStore(dbFile, EMPTY)
    expect(store.get()).toEqual(EMPTY)
  })

  it('构造时执行 JSON 迁移（提供 legacyJsonFile）', () => {
    const jsonFile = path.join(tmpDir, 'library.json')
    const data = sampleData()
    fs.writeFileSync(jsonFile, JSON.stringify(data), 'utf-8')
    store = new LibraryDbStore(dbFile, EMPTY, jsonFile)
    expect(store.get()).toEqual(data)
    expect(fs.existsSync(`${jsonFile}.migrated`)).toBe(true)
  })

  it('set() 浅合并并返回完整数据；flush 后持久化', () => {
    store = new LibraryDbStore(dbFile, EMPTY)
    const merged = store.set({ tags: ['a', 'b'] })
    expect(merged.tags).toEqual(['a', 'b'])
    store.flush()
    db = openLibraryDb(dbFile)
    expect(loadLibraryData(db).tags).toEqual(['a', 'b'])
  })

  it('replace() 整体替换；就地变更 get() 后 flush 也能落盘（library.ts 模式）', () => {
    store = new LibraryDbStore(dbFile, EMPTY)
    const data = sampleData()
    store.replace(data)
    // 模拟 library.ts 的就地变更：直接改 get() 返回的活对象
    store.get().images[0].favorite = true
    store.get().categories.push(makeCategory('cat-9', '就地新增'))
    store.flush()
    db = openLibraryDb(dbFile)
    const loaded = loadLibraryData(db)
    expect(loaded.images[0].favorite).toBe(true)
    expect(loaded.categories.map((c) => c.id)).toContain('cat-9')
  })

  it('重新打开：flush 过的数据在新 store 实例中可见', () => {
    store = new LibraryDbStore(dbFile, EMPTY)
    store.replace(sampleData())
    store.flush()
    store.close()
    store = new LibraryDbStore(dbFile, EMPTY)
    expect(store.get().images).toHaveLength(2)
  })
})
