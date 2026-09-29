/**
 * EXIF 拍摄时间解析（sharp metadata().exif 原始 buffer → epoch 毫秒）
 * exif-reader v2 的日期字段返回 Date；旧形态字符串为 "YYYY:MM:DD HH:MM:SS"
 * （冒号分隔，Date.parse 不认，需手工解析）。任何畸形输入一律返回 null，
 * 不让 EXIF 问题阻塞导入。字符串解析为纯函数，断言见 tests/exif-date.test.ts。
 */
import exifReader from 'exif-reader'

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

/** 从 EXIF 原始 buffer 提取拍摄时间（DateTimeOriginal 优先，退化到 DateTime） */
export function readTakenAt(exifBuffer: Buffer | undefined): number | null {
  if (!exifBuffer || exifBuffer.length === 0) return null
  try {
    const exif = exifReader(exifBuffer) as {
      Photo?: Record<string, unknown>
      Image?: Record<string, unknown>
    }
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
  } catch {
    return null
  }
}
