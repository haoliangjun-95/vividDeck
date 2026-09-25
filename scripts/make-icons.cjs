/**
 * 图标生成脚本：用 sharp 渲染应用图标与托盘模板图标
 * 运行：npm run icons（依赖安装完成后执行一次即可）
 * - build/icon.png (1024) → electron-builder 自动转换为 icon.icns / icon.ico
 * - build/trayTemplate.png（16/32 模板图）+ 打印 base64 用于主进程内嵌
 */
const sharp = require('sharp')
const fs = require('node:fs')
const path = require('node:path')

const BUILD_DIR = path.join(__dirname, '..', 'build')

/** 应用图标 SVG：渐变圆角方块 + 白色 V 形山峦 */
const APP_ICON_SVG = `
<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#6366f1"/>
      <stop offset="1" stop-color="#c026d3"/>
    </linearGradient>
  </defs>
  <rect x="64" y="64" width="896" height="896" rx="200" fill="url(#bg)"/>
  <!-- V 形山峦（壁纸意象） -->
  <path d="M 232 660 L 432 360 L 552 540 L 632 420 L 792 660 Z" fill="#ffffff" opacity="0.95"/>
  <!-- 顶部圆环（显示器意象） -->
  <circle cx="512" cy="260" r="64" fill="none" stroke="#ffffff" stroke-width="44" opacity="0.9"/>
</svg>`

/** 托盘模板 SVG：单色 V 形（模板图只用 alpha 通道，颜色无关） */
const TRAY_SVG = `
<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32">
  <path d="M 5 22 L 12 10 L 16.5 17 L 20 12 L 27 22 Z" fill="#000000"/>
</svg>`

async function main() {
  fs.mkdirSync(BUILD_DIR, { recursive: true })

  // 应用图标（electron-builder 依据 png 自动生成 icns/ico）
  await sharp(Buffer.from(APP_ICON_SVG)).png().toFile(path.join(BUILD_DIR, 'icon.png'))
  console.log('✓ build/icon.png (1024x1024)')

  // 托盘模板图（macOS 模板命名，自动适配亮暗菜单栏）
  await sharp(Buffer.from(TRAY_SVG))
    .resize(16, 16)
    .png()
    .toFile(path.join(BUILD_DIR, 'trayTemplate.png'))
  await sharp(Buffer.from(TRAY_SVG))
    .resize(32, 32)
    .png()
    .toFile(path.join(BUILD_DIR, 'trayTemplate@2x.png'))
  console.log('✓ build/trayTemplate.png / trayTemplate@2x.png')

  // 打印托盘 16px base64（供主进程内嵌，避免资源路径问题）
  const buf = await sharp(Buffer.from(TRAY_SVG)).resize(16, 16).png().toBuffer()
  console.log('\nTRAY_ICON_BASE64 =')
  console.log(buf.toString('base64'))

  // macOS icns：优先用系统 iconutil 生成真正的 icns
  if (process.platform === 'darwin') {
    try {
      const iconset = path.join(BUILD_DIR, 'icon.iconset')
      fs.mkdirSync(iconset, { recursive: true })
      for (const size of [16, 32, 64, 128, 256, 512, 1024]) {
        await sharp(path.join(BUILD_DIR, 'icon.png'))
          .resize(size, size)
          .png()
          .toFile(path.join(iconset, `icon_${size}x${size}.png`))
        if (size <= 512) {
          await sharp(path.join(BUILD_DIR, 'icon.png'))
            .resize(size * 2, size * 2)
            .png()
            .toFile(path.join(iconset, `icon_${size}x${size}@2x.png`))
        }
      }
      const { execSync } = require('node:child_process')
      execSync(`iconutil -c icns "${iconset}" -o "${path.join(BUILD_DIR, 'icon.icns')}"`)
      fs.rmSync(iconset, { recursive: true })
      console.log('✓ build/icon.icns')
    } catch (err) {
      console.warn('! icon.icns 生成失败（可交给 electron-builder 自动转换）：', err.message)
    }
  }

  console.log('\n图标生成完成。')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
