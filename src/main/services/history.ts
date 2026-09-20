/**
 * 壁纸历史服务：记录每次成功设置的壁纸（图片、显示器、填充模式、时间）
 * 上限 500 条，超出淘汰最旧记录。全部本地持久化。
 */
import type { FillMode, HistoryItem } from '@shared/types'
import { IPC_EVENTS } from '@shared/ipc'
import { JsonStore } from './store'
import { genId } from '../utils/fs'
import { notifyWallpaperChanged } from '../bubble'

const HISTORY_LIMIT = 500

const historyStore = new JsonStore<{ items: HistoryItem[] }>('history', { items: [] })

export function listHistory(): HistoryItem[] {
  return historyStore.get().items
}

/** 写入一条历史（最新的在最前）；同时通知悬浮球刷新当前壁纸缩略图 */
export function recordApply(imageId: string, monitorIds: string[], fillMode: FillMode): HistoryItem {
  const entry: HistoryItem = {
    id: genId(),
    imageId,
    monitorIds,
    fillMode,
    appliedAt: Date.now()
  }
  const items = [entry, ...historyStore.get().items]
  historyStore.replace({ items: items.slice(0, HISTORY_LIMIT) })
  historyStore.flush()
  notifyWallpaperChanged(imageId)
  return entry
}

export function clearHistory(): HistoryItem[] {
  historyStore.replace({ items: [] })
  historyStore.flush()
  return []
}

export function flushHistory(): void {
  historyStore.flush()
}
