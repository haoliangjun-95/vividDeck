/**
 * JSON 持久化存储服务
 * - 数据文件位于存储根目录 data/ 下，全部本地保存，不上传云端
 * - 写入策略：防抖合并 + 临时文件原子替换，避免进程退出时数据损坏
 */
import fs from 'node:fs'
import path from 'node:path'
import { dataDir } from './paths'

export class JsonStore<T extends object> {
  private file: string
  private data: T
  private timer: NodeJS.Timeout | null = null
  private flushing = false

  constructor(name: string, defaults: T) {
    this.file = path.join(dataDir(), `${name}.json`)
    this.data = this.load(defaults)
  }

  private load(defaults: T): T {
    try {
      if (fs.existsSync(this.file)) {
        const raw = fs.readFileSync(this.file, 'utf-8')
        // 与默认值浅合并，保证新增字段有默认值
        return { ...defaults, ...JSON.parse(raw) }
      }
    } catch (err) {
      console.error(`[store] 读取 ${this.file} 失败，使用默认值:`, err)
    }
    return { ...defaults }
  }

  get(): T {
    return this.data
  }

  /** 更新并持久化（浅合并），返回合并后的完整数据 */
  set(patch: Partial<T>): T {
    this.data = { ...this.data, ...patch }
    this.scheduleSave()
    return this.data
  }

  /** 替换整个数据（用于数组类字段的整体更新） */
  replace(data: T): T {
    this.data = data
    this.scheduleSave()
    return this.data
  }

  private scheduleSave(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => this.flush(), 300)
  }

  /** 立即落盘（app 退出前调用） */
  flush(): void {
    if (this.flushing) return
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    this.flushing = true
    try {
      const tmp = `${this.file}.tmp`
      fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2), 'utf-8')
      fs.renameSync(tmp, this.file)
    } catch (err) {
      console.error(`[store] 写入 ${this.file} 失败:`, err)
    } finally {
      this.flushing = false
    }
  }
}
