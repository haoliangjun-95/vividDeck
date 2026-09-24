/**
 * 云端图片下载横幅（画廊顶部）：
 * 有仅在云端的图片时提示数量，支持一键全部下载到本地；
 * 单张图片点击查看/设壁纸时也会按需实时下载（media 协议层处理）。
 */
import React, { useEffect, useState } from 'react'
import { CloudDownload, Loader2 } from 'lucide-react'
import { useLibraryStore } from '../store/library'
import { useUIStore } from '../store/ui'
import type { SyncProgress } from '@shared/types'

export function CloudDownloadBanner(): JSX.Element | null {
  const cloudCount = useLibraryStore((s) => s.images.filter((img) => !img.localFile).length)
  const load = useLibraryStore((s) => s.load)
  const toast = useUIStore((s) => s.toast)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<SyncProgress | null>(null)

  // 批量下载进度（downloadScope 以 downloading 阶段广播）
  useEffect(() => {
    const off = window.api.onSyncProgress((p) => {
      if (p.phase === 'downloading') setProgress(p)
    })
    return off
  }, [])

  if (cloudCount === 0 && !busy) return null

  const downloadAll = async (): Promise<void> => {
    setBusy(true)
    try {
      const r = await window.api.syncDownload({ type: 'all' })
      toast(
        r.failed > 0
          ? `下载完成 ${r.downloaded} 张，失败 ${r.failed} 张`
          : `已下载 ${r.downloaded} 张到本地`,
        r.failed > 0 ? 'error' : 'success'
      )
    } catch (err) {
      toast(`下载失败：${err instanceof Error ? err.message : String(err)}`, 'error')
    } finally {
      setBusy(false)
      setProgress(null)
      void load()
    }
  }

  return (
    <div className="flex items-center justify-between gap-3 border-b border-neutral-200 bg-indigo-50/70 px-4 py-2 text-xs dark:border-neutral-800 dark:bg-indigo-950/40">
      <span className="flex min-w-0 items-center gap-1.5 text-neutral-600 dark:text-neutral-300">
        {busy ? (
          <Loader2 size={13} className="shrink-0 animate-spin" />
        ) : (
          <CloudDownload size={13} className="shrink-0" />
        )}
        <span className="truncate">
          {busy
            ? `正在从云端下载图片…${progress && progress.total > 0 ? ` ${progress.current}/${progress.total}` : ''}`
            : `${cloudCount} 张图片在云端（点击图片会自动下载原图）`}
        </span>
      </span>
      <button
        className="btn-primary shrink-0 gap-1.5 !px-2.5 !py-1 text-xs"
        disabled={busy}
        onClick={() => void downloadAll()}
      >
        <CloudDownload size={13} />
        {busy ? '下载中…' : '全部下载到本地'}
      </button>
    </div>
  )
}
