/**
 * macOS 壁纸链路冒烟测试（一次性脚本，可重复执行）
 * 验证：wallpaper 库枚举屏幕 / sharp 预渲染填充模式 / 设置壁纸 / 恢复原壁纸
 * 运行：node scripts/smoke-wallpaper.mjs
 */
import { screens, getWallpaper, setWallpaper } from 'wallpaper'
import sharp from 'sharp'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'

async function main() {
  console.log('== vividDeck 壁纸链路冒烟测试 ==')

  // 1. 枚举屏幕
  const screenList = await screens()
  console.log('✓ screens():', screenList)

  // 2. 生成一张测试图（不同宽高比，验证 fit 模式黑边填充）
  const W = 1920
  const H = 1080
  const tmp = path.join(os.tmpdir(), 'vd-smoke-fit.jpg')
  await sharp({
    create: { width: 1600, height: 400, channels: 3, background: '#6366f1' }
  })
    .composite([
      {
        input: Buffer.from(`<svg width="1600" height="400"><text x="800" y="220" font-size="120" text-anchor="middle" fill="#fff" font-family="sans-serif">vividDeck SMOKE</text></svg>`),
        top: 0,
        left: 0
      }
    ])
    .jpeg()
    .toFile(tmp)
  console.log('✓ 测试图生成:', tmp)

  // 3. 预渲染（fit 模式：contain + 黑边扩展，复刻 prerender.ts 逻辑）
  const rendered = path.join(os.tmpdir(), 'vd-smoke-rendered.jpg')
  const meta = await sharp(tmp).resize(W, H, { fit: 'contain', background: '#000000' }).toBuffer({ resolveWithObject: true })
  await sharp(meta.data).extend({
    top: Math.floor((H - meta.info.height) / 2),
    bottom: H - meta.info.height - Math.floor((H - meta.info.height) / 2),
    left: Math.floor((W - meta.info.width) / 2),
    right: W - meta.info.width - Math.floor((W - meta.info.width) / 2),
    background: '#000000'
  }).jpeg({ quality: 95 }).toFile(rendered)
  const outMeta = await sharp(rendered).metadata()
  console.log(`✓ 预渲染输出: ${outMeta.width}x${outMeta.height}（期望 ${W}x${H}）`)

  // 4. 记录当前壁纸 → 设置 → 校验 → 恢复
  const before = await getWallpaper({ screen: 'all' })
  console.log('✓ 当前壁纸:', before)
  await setWallpaper(rendered, { screen: 'all' })
  const after = await getWallpaper({ screen: 'all' })
  console.log('✓ 设置后壁纸:', after)
  const changed = JSON.stringify(before) !== JSON.stringify(after)
  console.log(changed ? '✓ 壁纸已生效' : '⚠ 壁纸未变化（可能系统缓存）')

  await setWallpaper(Array.isArray(before) ? before[0] : before, { screen: 'all' })
  console.log('✓ 已恢复原壁纸')

  fs.unlinkSync(tmp)
  fs.unlinkSync(rendered)
  console.log('== 测试完成 ==')
}

main().catch((err) => {
  console.error('✗ 测试失败:', err)
  process.exit(1)
})
