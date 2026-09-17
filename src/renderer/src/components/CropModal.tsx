/**
 * 壁纸裁剪工具：
 * - 界面取景基于预览图（media://preview，HEIC 已由 sharp 转码可显示）
 * - 确认裁剪时把取景框按比例映射回原图像素，由主进程 sharp 在原图上裁切（保证画质）
 * - 支持自由比例 / 主屏比例 / 常见比例预设
 */
import React, { useEffect, useState } from 'react'
import Cropper from 'react-easy-crop'
import type { Area } from 'react-easy-crop'
import { Modal } from './ui'
import { useUIStore } from '../store/ui'
import { useLibraryStore } from '../store/library'
import type { MonitorInfo } from '@shared/types'

/** 比例预设（null = 自由） */
const ASPECT_PRESETS: { label: string; value: number | null }[] = [
  { label: '自由', value: null },
  { label: '16:9', value: 16 / 9 },
  { label: '4:3', value: 4 / 3 },
  { label: '1:1', value: 1 }
]

export function CropModal(): JSX.Element | null {
  const imageId = useUIStore((s) => s.cropImageId)
  const close = useUIStore((s) => s.closeCrop)
  const openWallpaperDialog = useUIStore((s) => s.openWallpaperDialog)
  const toast = useUIStore((s) => s.toast)
  const image = useLibraryStore((s) => s.images.find((img) => img.id === imageId))
  const load = useLibraryStore((s) => s.load)

  const [crop, setCrop] = useState({ x: 0, y: 0 })
  const [zoom, setZoom] = useState(1)
  const [croppedArea, setCroppedArea] = useState<Area | null>(null)
  const [aspect, setAspect] = useState<number | null>(null)
  const [monitors, setMonitors] = useState<MonitorInfo[]>([])
  const [busy, setBusy] = useState(false)
  const [previewSize, setPreviewSize] = useState<{ w: number; h: number } | null>(null)

  // 获取主屏分辨率，提供"主屏比例"预设
  useEffect(() => {
    if (!imageId) return
    void window.api
      .listMonitors()
      .then((list) => {
        setMonitors(list)
        const main = list.find((m) => m.isMain) ?? list[0]
        if (main) setAspect(main.width / main.height)
      })
      .catch(() => undefined)
  }, [imageId])

  // 读取预览图自然尺寸（用于坐标映射）
  useEffect(() => {
    if (!imageId) return
    const img = new Image()
    img.onload = () => setPreviewSize({ w: img.naturalWidth, h: img.naturalHeight })
    img.src = `media://preview/${imageId}`
  }, [imageId])

  if (!imageId || !image) return null

  const presets = [
    ...ASPECT_PRESETS,
    ...(monitors.length > 0
      ? monitors.slice(0, 2).map((m) => ({ label: `${m.label.slice(0, 8)} ${m.width}×${m.height}`, value: m.width / m.height }))
      : [])
  ]

  /** 取景框（预览图像素）→ 原图像素坐标 */
  const mapRectToOriginal = (area: Area): { x: number; y: number; width: number; height: number } | null => {
    if (!previewSize || previewSize.w === 0) return null
    const scale = image.width / previewSize.w
    return {
      x: area.x * scale,
      y: area.y * scale,
      width: area.width * scale,
      height: area.height * scale
    }
  }

  const doCrop = async (thenSetWallpaper: boolean): Promise<void> => {
    if (!croppedArea) return
    const rect = mapRectToOriginal(croppedArea)
    if (!rect || rect.width < 8 || rect.height < 8) {
      toast('裁剪区域过小', 'error')
      return
    }
    setBusy(true)
    try {
      const newImage = await window.api.cropApply(image.id, rect)
      await load()
      close()
      toast(`已生成裁剪图「${newImage.fileName}」`)
      if (thenSetWallpaper) openWallpaperDialog(newImage.id)
    } catch (err) {
      toast(`裁剪失败：${err instanceof Error ? err.message : String(err)}`, 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title="裁剪壁纸" onClose={close} width="max-w-3xl">
      <div className="space-y-3">
        {/* 取景区 */}
        <div className="relative h-[420px] overflow-hidden rounded-lg bg-black">
          <Cropper
            image={`media://preview/${image.id}`}
            crop={crop}
            zoom={zoom}
            aspect={aspect ?? undefined}
            onCropChange={setCrop}
            onZoomChange={setZoom}
            onCropComplete={(_area, areaPixels) => setCroppedArea(areaPixels)}
            showGrid
          />
        </div>
        {/* 控制区 */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-neutral-400">比例：</span>
          {presets.map((p) => (
            <button
              key={p.label}
              className={`rounded-full px-2.5 py-1 text-xs transition-colors ${
                aspect === p.value
                  ? 'bg-indigo-600 text-white'
                  : 'bg-neutral-200/70 text-neutral-600 hover:bg-neutral-300/70 dark:bg-neutral-700/60 dark:text-neutral-300'
              }`}
              onClick={() => setAspect(p.value)}
            >
              {p.label}
            </button>
          ))}
          <label className="ml-auto flex items-center gap-2 text-xs text-neutral-400">
            缩放
            <input
              type="range"
              min={1}
              max={3}
              step={0.05}
              value={zoom}
              onChange={(e) => setZoom(Number(e.target.value))}
              className="accent-indigo-600"
            />
          </label>
        </div>

        {croppedArea && (
          <div className="text-xs text-neutral-400">
            裁剪输出约 {Math.round(croppedArea.width * (previewSize ? image.width / previewSize.w : 1))} ×{' '}
            {Math.round(croppedArea.height * (previewSize ? image.width / previewSize.w : 1))} 像素（保存后可在素材库中查看）
          </div>
        )}

        <div className="flex justify-end gap-2 border-t border-neutral-200 pt-3 dark:border-neutral-800">
          <button className="btn-ghost" onClick={close}>
            取消
          </button>
          <button className="btn-ghost border border-neutral-300 dark:border-neutral-700" disabled={busy} onClick={() => void doCrop(false)}>
            保存到素材库
          </button>
          <button className="btn-primary" disabled={busy} onClick={() => void doCrop(true)}>
            {busy ? '处理中…' : '保存并设为壁纸'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
