/**
 * 壁纸历史面板：时间线列表 + 一键回溯复用
 */
import React, { useEffect, useState } from 'react'
import { History, RotateCcw } from 'lucide-react'
import { useUIStore } from '../store/ui'
import { useLibraryStore } from '../store/library'
import { FILL_MODE_LABELS, type HistoryItem } from '@shared/types'
import { formatTime, mediaUrl } from '../lib/utils'

export function HistoryPanel(): JSX.Element {
  const toast = useUIStore((s) => s.toast)
  const images = useLibraryStore((s) => s.images)
  const [items, setItems] = useState<HistoryItem[]>([])

  useEffect(() => {
    void window.api.listHistory().then(setItems)
    const off = window.api.onSlideshowTick(() => {
      void window.api.listHistory().then(setItems)
    })
    return off
  }, [])

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-sm text-neutral-400">共 {items.length} 条记录（上限 500 条）</span>
        {items.length > 0 && (
          <button
            className="btn-danger !px-2 !py-1 text-xs"
            onClick={() => {
              if (confirm('确定清空全部壁纸历史记录吗？')) {
                void window.api.clearHistory().then(setItems)
              }
            }}
          >
            清空
          </button>
        )}
      </div>

      {items.length === 0 && (
        <div className="flex flex-col items-center gap-2 py-12 text-neutral-400">
          <History size={32} />
          <span className="text-sm">暂无历史记录，设置第一张壁纸后即可回溯</span>
        </div>
      )}

      <div className="space-y-2">
        {items.map((item) => {
          const image = images.find((img) => img.id === item.imageId)
          return (
            <div key={item.id} className="card flex items-center gap-3 p-2.5">
              {image ? (
                <img src={mediaUrl('thumb', image.id)} alt="" className="h-14 w-20 shrink-0 rounded-md object-cover" />
              ) : (
                <div className="flex h-14 w-20 shrink-0 items-center justify-center rounded-md bg-neutral-200 text-[10px] text-neutral-400 dark:bg-neutral-800">
                  已删除
                </div>
              )}
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{image?.fileName ?? '（图片已不在素材库）'}</div>
                <div className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-neutral-400">
                  <span>{formatTime(item.appliedAt)}</span>
                  <span>{FILL_MODE_LABELS[item.fillMode]}</span>
                  <span>{item.monitorIds.length} 台显示器</span>
                </div>
              </div>
              <button
                className="btn-ghost !px-2.5 !py-1.5 text-xs"
                disabled={!image}
                title="重新设置为壁纸"
                onClick={() =>
                  void window.api
                    .applyHistory(item.id)
                    .then(() => toast('已重新应用该壁纸'))
                    .catch((err) => toast(err.message, 'error'))
                }
              >
                <RotateCcw size={13} />
                重设
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}
