// 生成 Windows 多尺寸 BMP 格式 icon.ico（rcedit 对单张 PNG 压缩条目的 ico 会报
// "Unable to commit changes"，标准 BMP 条目无此问题）
// 运行：node scripts/make-icon-ico.mjs   （依赖 sharp，读取 build/icon.png）
import sharp from 'sharp'
import fs from 'node:fs'
import path from 'node:path'

const SIZES = [16, 24, 32, 48, 64, 128, 256]
const SRC = path.resolve('build/icon.png')
const OUT = path.resolve('build/icon.ico')

async function bmpEntry(size) {
  const { data, info } = await sharp(SRC)
    .resize(size, size, { kernel: 'lanczos3' })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })

  const { width: w, height: h } = info
  const rowBytes = w * 4
  const maskRowBytes = Math.ceil(w / 32) * 4
  const header = Buffer.alloc(40)
  header.writeUInt32LE(40, 0) // biSize
  header.writeInt32LE(w, 4)
  header.writeInt32LE(h * 2, 8) // 像素 + AND 掩码
  header.writeUInt16LE(1, 12) // biPlanes
  header.writeUInt16LE(32, 14) // biBitCount
  header.writeUInt32LE(0, 16) // BI_RGB
  header.writeUInt32LE(rowBytes * h + maskRowBytes * h, 20)

  // ICO 像素数据为 BGRA、自底向上
  const pixels = Buffer.alloc(rowBytes * h)
  for (let y = 0; y < h; y++) {
    const srcRow = data.subarray(y * rowBytes, (y + 1) * rowBytes)
    const dstRow = pixels.subarray((h - 1 - y) * rowBytes, (h - y) * rowBytes)
    for (let x = 0; x < rowBytes; x += 4) {
      dstRow[x] = srcRow[x + 2] // B
      dstRow[x + 1] = srcRow[x + 1] // G
      dstRow[x + 2] = srcRow[x] // R
      dstRow[x + 3] = srcRow[x + 3] // A
    }
  }
  const mask = Buffer.alloc(maskRowBytes * h) // 32bit 全透明度，掩码置 0
  return Buffer.concat([header, pixels, mask])
}

const entries = []
for (const size of SIZES) entries.push(await bmpEntry(size))

const header = Buffer.alloc(6)
header.writeUInt16LE(0, 0)
header.writeUInt16LE(1, 2) // 类型：icon
header.writeUInt16LE(entries.length, 4)

const dir = Buffer.alloc(16 * entries.length)
let offset = 6 + dir.length
entries.forEach((buf, i) => {
  const size = SIZES[i]
  dir.writeUInt8(size >= 256 ? 0 : size, i * 16)
  dir.writeUInt8(size >= 256 ? 0 : size, i * 16 + 1)
  dir.writeUInt16LE(1, i * 16 + 4) // planes
  dir.writeUInt16LE(32, i * 16 + 6) // bitcount
  dir.writeUInt32LE(buf.length, i * 16 + 8)
  dir.writeUInt32LE(offset, i * 16 + 12)
  offset += buf.length
})

fs.writeFileSync(OUT, Buffer.concat([header, dir, ...entries]))
console.log(`✓ build/icon.ico（${SIZES.join('/')} BMP 多尺寸）`)
