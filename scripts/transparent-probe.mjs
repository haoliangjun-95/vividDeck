/**
 * 透明窗口探针：测试多组 BrowserWindow 参数组合，截屏分析四角像素 alpha
 * 运行：npx electron scripts/transparent-probe.mjs
 */
import { app, BrowserWindow, desktopCapturer } from 'electron'
import { execFileSync } from 'node:child_process'
import sharp from 'sharp'

/** 用 desktopCapturer 找窗口的 CGWindowID（按标题匹配） */
async function windowIdByTitle(title) {
  const sources = await desktopCapturer.getSources({ types: ['window'] })
  const hit = sources.find((s) => s.name === title)
  const m = hit ? /window:(\d+):/.exec(hit.id) : null
  return m ? Number(m[1]) : null
}

/** 截取指定窗口，返回四角与中心的 rgba */
async function analyzeWindow(title, label) {
  const id = await windowIdByTitle(title)
  if (!id) return console.log(`[${label}] ✗ 拿不到 window id（title=${title}）`)
  const file = `/tmp/vd-probe-${label}.png`
  try {
    execFileSync('screencapture', [`-l${id}`, '-x', '-o', file])
  } catch (err) {
    return console.log(`[${label}] ✗ screencapture 失败: ${err.message}`)
  }
  const { data, info } = await sharp(file).raw().toBuffer({ resolveWithObject: true })
  const ch = info.channels
  const px = (x, y) => {
    const i = (y * info.width + x) * ch
    return [data[i], data[i + 1], data[i + 2], ch >= 4 ? data[i + 3] : 255]
  }
  const w = info.width
  const h = info.height
  const corners = [px(2, 2), px(w - 3, 2), px(2, h - 3), px(w - 3, h - 3)]
  const center = px(Math.floor(w / 2), Math.floor(h / 2))
  const transparentCorners = corners.filter((c) => c[3] < 10).length
  console.log(
    `[${label}] ${info.width}x${h} 四角透明 ${transparentCorners}/4，角rgba=${corners[0].join(',')} 中心rgba=${center.join(',')}`
  )
}

const COMBOS = [
  { label: 'A-base', opts: {} }, // 当前 bubble.ts 的完整选项
  { label: 'B-no-bgcolor', opts: { backgroundColor: undefined } },
  { label: 'C-focusable', opts: { focusable: true } },
  {
    label: 'D-minimal',
    opts: { backgroundColor: undefined, focusable: true, hasShadow: undefined, movable: true }
  }
]

const BASE = {
  width: 76,
  height: 76,
  x: 200,
  y: 200,
  frame: false,
  transparent: true,
  resizable: false,
  movable: false,
  maximizable: false,
  minimizable: false,
  fullscreenable: false,
  skipTaskbar: true,
  show: true,
  focusable: false,
  hasShadow: false,
  backgroundColor: '#00000000',
  webPreferences: { backgroundThrottling: false }
}

const pageFor = (label) =>
  `data:text/html,<title>VDPROBE-${label}</title><style>html,body{margin:0;background:transparent}</style><div style="width:64px;height:64px;margin:6px;border-radius:50%;background:%236366f1"></div>`

app.whenReady().then(async () => {
  const wins = []
  let y = 100
  for (const combo of COMBOS) {
    const opts = { ...BASE, y }
    y += 120
    for (const [k, v] of Object.entries(combo.opts)) {
      if (v === undefined) delete opts[k]
      else opts[k] = v
    }
    const win = new BrowserWindow(opts)
    await win.loadURL(pageFor(combo.label))
    wins.push({ label: combo.label })
  }
  await new Promise((r) => setTimeout(r, 1500))

  for (const { label } of wins) await analyzeWindow(`VDPROBE-${label}`, label)
  app.exit(0)
})
