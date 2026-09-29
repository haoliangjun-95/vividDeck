/**
 * utils/exif.ts —— EXIF 拍摄时间解析
 * 字符串解析为纯函数直测；readTakenAt 覆盖空/畸形 buffer 的安全路径。
 */
import { describe, expect, it } from 'vitest'
import { parseExifDateString, readTakenAt } from '@main/utils/exif'

describe('parseExifDateString（EXIF "YYYY:MM:DD HH:MM[:SS]"）', () => {
  it('标准形态解析为本地时区 epoch 毫秒', () => {
    const ms = parseExifDateString('2024:03:05 14:30:09')
    expect(ms).toBe(new Date(2024, 2, 5, 14, 30, 9).getTime())
  })

  it('无秒形态（部分相机）与 "T" 分隔均可解析', () => {
    expect(parseExifDateString('2020:01:02 08:00')).toBe(new Date(2020, 0, 2, 8, 0, 0).getTime())
    expect(parseExifDateString('2021:11:30T23:59:59')).toBe(
      new Date(2021, 10, 30, 23, 59, 59).getTime()
    )
  })

  it('畸形输入返回 null（不让 EXIF 问题阻塞导入）', () => {
    expect(parseExifDateString('')).toBeNull()
    expect(parseExifDateString('not a date')).toBeNull()
    expect(parseExifDateString('2024:13:45 99:99:99')).toBeNull() // 月份越界 → Invalid Date
    expect(parseExifDateString('2024/03/05 14:30:09')).toBeNull() // 斜杠不是 EXIF 形态
  })
})

describe('readTakenAt 安全路径', () => {
  it('空 buffer / undefined / 非 EXIF 数据一律返回 null 不抛错', () => {
    expect(readTakenAt(undefined)).toBeNull()
    expect(readTakenAt(Buffer.alloc(0))).toBeNull()
    expect(readTakenAt(Buffer.from('plain text, not tiff'))).toBeNull()
  })
})
