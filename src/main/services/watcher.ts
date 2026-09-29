/**
 * 文件夹监视自动导入：
 * - fs.watch recursive（macOS/Windows 原生支持；Linux 非递归——目录树只报顶层，可接受）
 * - 事件去抖 2s 聚批 + 600ms 尺寸稳定性双查（防相机/浏览器半写文件产出错误哈希）
 * - hash 去重天然幂等（importPaths 已跳过内容重复）；导入成功广播 LIBRARY_CHANGED
 *   （渲染层 App.tsx 已订阅该事件刷新画廊）
 * - 防反馈环：拒绝监视存储根内部（缩略图生成/按需下载回填会再次触发导入）
 */
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { BrowserWindow } from 'electron'
import { IPC_EVENTS } from '@shared/ipc'
import { importPaths } from './library'
import { storageRoot } from './paths'

const IMAGE_RE = /\.(jpe?g|png|webp|heic|heif|avif|tiff|gif)$/i
/** 事件聚批窗口：目录内连续落盘（连拍导入/解压）合并为一次导入 */
const DEBOUNCE_MS = 2000
/** 尺寸稳定性复查间隔：两次 stat 大小一致才认为写完 */
const STABLE_MS = 600

let watchers: fs.FSWatcher[] = []
const pending = new Set<string>()
let flushTimer: NodeJS.Timeout | null = null
let importing = false

/** （重新）建立全部监视器：设置变更与启动时调用；空数组 = 全部停止 */
export function initWatchers(folders: string[]): void {
  for (const w of watchers) w.close()
  watchers = []
  pending.clear()
  for (const dir of folders) {
    if (!dir) continue
    if (isInsideStorage(dir)) {
      console.warn(`[watcher] 跳过存储目录内部（防反馈环）: ${dir}`)
      continue
    }
    try {
      const w = fs.watch(dir, { recursive: true }, (_event, filename) => {
        if (!filename) return
        const file = path.join(dir, filename.toString())
        if (!IMAGE_RE.test(file)) return
        pending.add(file)
        scheduleFlush()
      })
      // 目录被删/拔盘：错误后关闭该监视器，其余继续工作
      w.on('error', (err) => {
        console.error(`[watcher] 监视失效 ${dir}:`, err)
        w.close()
        watchers = watchers.filter((x) => x !== w)
      })
      watchers.push(w)
      console.log(`[watcher] 监视 ${dir}`)
    } catch (err) {
      console.error(`[watcher] 无法监视 ${dir}:`, err)
    }
  }
}

/** 目标是否位于存储根内（含存储根本身） */
function isInsideStorage(dir: string): boolean {
  const rel = path.relative(storageRoot(), path.resolve(dir))
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
}

function scheduleFlush(): void {
  if (flushTimer) clearTimeout(flushTimer)
  flushTimer = setTimeout(() => void flush(), DEBOUNCE_MS)
}

async function flush(): Promise<void> {
  flushTimer = null
  if (importing) {
    scheduleFlush()
    return
  }
  importing = true
  try {
    const files = [...pending]
    pending.clear()
    // 尺寸稳定性双查：间隔复查大小一致才导入（半写文件跳过；下次变更事件会再触发）
    const first = new Map<string, number>()
    for (const f of files) {
      const s = await fsp.stat(f).catch(() => null)
      if (s?.isFile()) first.set(f, s.size)
    }
    await new Promise((r) => setTimeout(r, STABLE_MS))
    const stable: string[] = []
    for (const [f, size] of first) {
      const s = await fsp.stat(f).catch(() => null)
      if (s?.isFile() && s.size === size) stable.push(f)
    }
    if (stable.length === 0) return
    const r = await importPaths(stable)
    if (r.added > 0) {
      console.log(`[watcher] 自动导入 ${r.added} 张（跳过 ${r.skipped}）`)
      for (const win of BrowserWindow.getAllWindows()) {
        win.webContents.send(IPC_EVENTS.LIBRARY_CHANGED)
      }
    }
  } catch (err) {
    console.error('[watcher] 自动导入失败:', err)
  } finally {
    importing = false
    if (pending.size > 0) scheduleFlush()
  }
}
