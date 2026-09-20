/**
 * README 功能截图采集脚本（CDP 驱动真实界面）
 * 前置：安装版带调试端口运行：
 *   /Applications/vividDeck.app/Contents/MacOS/vividDeck --remote-debugging-port=9222
 * 运行：node scripts/capture-screenshots.mjs
 * 产物：docs/images/*.png（窗口截图后经 sharp 压缩为 jpg，悬浮球保持透明 png 并合成展示底）
 * 注意：设置页截图前会对 MinIO 地址 / AccessKey / 本机路径做遮盖，不落盘任何敏感信息
 */
import fs from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'

const OUT_DIR = 'docs/images'

async function cdpByUrl(fragment) {
  const targets = await (await fetch('http://127.0.0.1:9222/json')).json()
  const page = targets.find((t) => t.type === 'page' && t.url.includes(fragment))
  if (!page) throw new Error(`未找到页面: ${fragment}`)
  const ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
  let seq = 0
  const pending = new Map()
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data)
    if (m.id && pending.has(m.id)) {
      pending.get(m.id)(m)
      pending.delete(m.id)
    }
  }
  const send = (method, params = {}) =>
    new Promise((resolve) => {
      const id = ++seq
      pending.set(id, resolve)
      ws.send(JSON.stringify({ id, method, params }))
    })
  const evaluate = async (expression) => {
    const res = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (res.result?.exceptionDetails) throw new Error('执行失败: ' + expression.slice(0, 80))
    return res.result?.result?.value
  }
  const capture = async () => {
    const res = await send('Page.captureScreenshot', { format: 'png' })
    return Buffer.from(res.result.data, 'base64')
  }
  return { evaluate, capture, close: () => ws.close() }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** 按可见文本点击元素（React 合成事件对冒泡 click 有效） */
const clickByText = `(() => {
  const clickText = (text, scope) => {
    const els = Array.from((scope || document).querySelectorAll('button, [role="switch"], a, div, span'))
    const el = els.find((e) => e.textContent.trim() === text && e.offsetParent !== null)
    if (!el) return false
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    return true
  }
  window.__clickText = clickText
  return true
})()`

/** 按元素内的近似文本/属性查找并点击 */
async function click(app, js) {
  const ok = await app.evaluate(js)
  if (!ok) throw new Error('点击目标未找到: ' + js.slice(0, 60))
}

/** 保存窗口截图（png → 压缩 jpg，宽 1200） */
async function saveShot(buf, name) {
  const file = path.join(OUT_DIR, `${name}.jpg`)
  await sharp(buf).resize({ width: 1200 }).jpeg({ quality: 88 }).toFile(file)
  console.log(`  ✓ ${file}`)
}

/** 设置页敏感信息遮盖（悬浮层，不触发任何保存） */
const MASK_JS = `(() => {
  const overlay = (el, label) => {
    if (!el) return
    const r = el.getBoundingClientRect()
    const d = document.createElement('div')
    d.textContent = label
    d.style.cssText = 'position:fixed;z-index:99999;left:' + r.left + 'px;top:' + r.top + 'px;width:' + r.width + 'px;height:' + r.height + 'px;background:#c7d2fe;color:#4338ca;font-size:12px;display:flex;align-items:center;justify-content:center;border-radius:6px'
    document.body.appendChild(d)
  }
  // MinIO 连接表单的文本输入框（地址/端口/bucket/accessKey）
  document.querySelectorAll('input:not([type="checkbox"]):not([type="password"])').forEach((el) => {
    const v = el.value || ''
    if (/\\d{1,3}(\\.\\d{1,3}){3}|https?:|minio|\\./i.test(v) && v.length > 3) overlay(el, '•••••')
  })
  // 本机路径（含用户名）
  document.querySelectorAll('.font-mono').forEach((el) => overlay(el, '/Users/you/…'))
  return true
})()`

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true })
  const app = await cdpByUrl('index.html')
  await app.evaluate(clickByText)
  console.log('== 开始采集 README 截图 ==')

  // 1) 画廊主界面（等缩略图渲染）
  await sleep(2500)
  await saveShot(await app.capture(), 'gallery')

  // 2) 灯箱（点击第一张卡片，等预览加载）
  await click(app, `window.__clickText(undefined, document.querySelector('figure')) || (() => {
    document.querySelector('figure').dispatchEvent(new MouseEvent('click', { bubbles: true }))
    return true
  })()`)
  await sleep(2500)
  await saveShot(await app.capture(), 'lightbox')

  // 3) 设壁纸对话框
  await click(app, `(() => { const b = Array.from(document.querySelectorAll('button')).find(x => x.textContent.includes('设为壁纸')); if (!b) return false; b.click(); return true })()`)
  await sleep(1200)
  await saveShot(await app.capture(), 'set-wallpaper')
  // 关闭对话框（Esc 会同时关掉灯箱，稍后重开）
  await app.evaluate(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`)
  await sleep(600)

  // 4) 裁剪工具（重开灯箱 → 点裁剪）
  await click(app, `(() => { document.querySelector('figure').dispatchEvent(new MouseEvent('click', { bubbles: true })); return true })()`)
  await sleep(1800)
  await click(app, `(() => { const b = document.querySelector('button[title="裁剪"]'); if (!b) return false; b.click(); return true })()`)
  await sleep(1500)
  await saveShot(await app.capture(), 'crop')
  await app.evaluate(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`)
  await sleep(600)

  // 5) 轮播面板
  await click(app, `window.__clickText('轮播计划')`)
  await sleep(1000)
  await saveShot(await app.capture(), 'slideshow')
  await app.evaluate(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`)
  await sleep(500)

  // 6) 壁纸历史
  await click(app, `window.__clickText('壁纸历史')`)
  await sleep(1000)
  await saveShot(await app.capture(), 'history')
  await app.evaluate(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`)
  await sleep(500)

  // 7) 设置页（先遮盖敏感信息）
  await click(app, `window.__clickText('设置')`)
  await sleep(1000)
  await app.evaluate(MASK_JS)
  await sleep(300)
  await saveShot(await app.capture(), 'settings')
  await app.evaluate(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`)

  app.close()

  // 8) 悬浮球（透明 png 合成到渐变底上展示）
  try {
    const bubble = await cdpByUrl('bubble.html')
    const png = await bubble.capture()
    bubble.close()
    await sharp({
      create: { width: 360, height: 240, channels: 3, background: '#1f2937' }
    })
      .composite([{
        input: await sharp(png).resize(140, 140, { fit: 'contain' }).png().toBuffer(),
        gravity: 'center'
      }])
      .jpeg({ quality: 90 })
      .toFile(path.join(OUT_DIR, 'bubble.jpg'))
    console.log(`  ✓ ${OUT_DIR}/bubble.jpg`)
  } catch (err) {
    console.log('  ! 悬浮球截图跳过:', err.message)
  }

  console.log('== 截图完成 ==')
}

main().catch((err) => {
  console.error('✗', err.message)
  process.exit(1)
})
