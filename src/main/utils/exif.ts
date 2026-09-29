/**
 * EXIF 解析（sharp metadata().exif 原始 buffer）：
 * - readTakenAt：拍摄时间 → epoch 毫秒（exif-reader v2 日期字段返回 Date；
 *   旧形态字符串 "YYYY:MM:DD HH:MM:SS" 冒号分隔，Date.parse 不认需手工解析）
 * - readExifInfo：拍摄参数（相机/光圈/快门/ISO/焦距，灯箱信息面板用）
 * 任何畸形输入一律返回 null，不让 EXIF 问题阻塞导入。
 * 字符串日期解析为纯函数，断言见 tests/exif-date.test.ts。
 */
import exifReader from 'exif-reader'
import type { ExifInfo } from '@shared/types'

/** 解析 EXIF 日期字符串 "YYYY:MM:DD HH:MM[:SS]"；非法返回 null */
export function parseExifDateString(raw: string): number | null {
  const m = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(raw.trim())
  if (!m) return null
  const [, y, mo, d, h, mi, s] = m
  const month = Number(mo)
  const day = Number(d)
  const hour = Number(h)
  const minute = Number(mi)
  const second = s !== undefined ? Number(s) : 0
  // JS Date 会把越界字段自动进位（13 月→次年），必须显式限域
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  if (hour > 23 || minute > 59 || second > 59) return null
  const ms = new Date(Number(y), month - 1, day, hour, minute, second).getTime()
  return Number.isFinite(ms) ? ms : null
}

/** 统一 EXIF 解析入口（空/畸形输入返回 null，不抛错） */
function parseExif(
  exifBuffer: Buffer | undefined
): { Photo?: Record<string, unknown>; Image?: Record<string, unknown> } | null {
  if (!exifBuffer || exifBuffer.length === 0) return null
  try {
    return exifReader(exifBuffer) as {
      Photo?: Record<string, unknown>
      Image?: Record<string, unknown>
    }
  } catch {
    return null
  }
}

/** 拍摄时间（DateTimeOriginal 优先，退化到 DateTime） */
export function readTakenAt(exifBuffer: Buffer | undefined): number | null {
  const exif = parseExif(exifBuffer)
  if (!exif) return null
  const candidates = [
    exif.Photo?.DateTimeOriginal,
    exif.Image?.DateTimeOriginal,
    exif.Photo?.DateTime
  ]
  for (const c of candidates) {
    if (c instanceof Date && !Number.isNaN(c.getTime())) return c.getTime()
    if (typeof c === 'string') {
      const ms = parseExifDateString(c)
      if (ms !== null) return ms
    }
  }
  return null
}

/** 数值字段净化：有限正数放行，否则丢弃 */
function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : undefined
}

/** 字符串字段净化：去空白限长 */
function str(v: unknown, maxLen: number): string | undefined {
  if (typeof v !== 'string') return undefined
  const t = v.trim()
  return t.length > 0 && t.length <= maxLen ? t : undefined
}

/** 拍摄参数（相机/光圈/快门/ISO/焦距）；无任何有效字段返回 null */
export function readExifInfo(exifBuffer: Buffer | undefined): ExifInfo | null {
  const exif = parseExif(exifBuffer)
  if (!exif) return null
  const photo = exif.Photo ?? {}
  const image = exif.Image ?? {}
  const info: ExifInfo = {}
  const make = str(image.Make, 40) ?? str(photo.Make, 40)
  const model = str(image.Model, 60) ?? str(photo.Model, 60)
  if (make) info.make = make
  if (model) info.model = model
  const fNumber = num(photo.FNumber)
  if (fNumber !== undefined) info.fNumber = fNumber
  const exposure = num(photo.ExposureTime)
  if (exposure !== undefined) info.exposure = exposure
  const iso = num(photo.ISOSpeedRatings)
  if (iso !== undefined) info.iso = iso
  const focal = num(photo.FocalLength)
  if (focal !== undefined) info.focal = focal
  return Object.keys(info).length > 0 ? info : null
}
