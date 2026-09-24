import fs from 'node:fs'
// 同步重启回归验证：同步后重启不再腐蚀云端记录（path 自愈 bug）+ 已损坏记录启动自愈 + 点击实时下载
// 前置：s3rver@9100、A@9222、B@9223 已启动（VD_ALLOW_DEV_SYNC=1，--user-data-dir 各自独立）
// 运行：node scripts/e2e-sync-restart.mjs（脚本内会重启 B 实例）
import path from 'node:path'

const assert = (cond, label) => {
  if (!cond) throw new Error('✗ ' + label)
  console.log('  ✓ ' + label)
}

async function cdp(port) {
  const targets = await await fetch(`http://127.0.0.1:${port}/json`).then((r) => r.json())
  const page = targets.find((t) => t.type === 'page' && t.url.endsWith('index.html'))
  const ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((res, rej) => {
    ws.onopen = res
    ws.onerror = rej
  })
  let seq = 0
  const pending = new Map()
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data)
    if (m.id && pending.has(m.id)) {
      pending.get(m.id)(m)
      pending.delete(m.id)
    }
  }
  const evaluate = async (expression) => {
    const id = ++seq
    const p = new Promise((r) => pending.set(id, r))
    ws.send(
      JSON.stringify({
        id,
        method: 'Runtime.evaluate',
        params: { expression, awaitPromise: true, returnByValue: true }
      })
    )
    const res = await p
    if (res.result?.exceptionDetails)
      throw new Error(
        '页面执行出错: ' +
          JSON.stringify(
            res.result.exceptionDetails.exception?.description ?? res.result.exceptionDetails
          )
      )
    return res.result?.result.value
  }
  return { evaluate, close: () => ws.close() }
}

const waitFor = async (port, timeoutMs = 30000) => {
  const t0 = Date.now()
  while (Date.now() - t0 < timeoutMs) {
    try {
      await fetch(`http://127.0.0.1:${port}/json`)
      return
    } catch {}
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error(`端口 ${port} 未就绪`)
}

// 注意：Git Bash 会把 /tmp/... 自动转成 %TEMP%\...，这里统一用 os.tmpdir() 定位
const os = await import('node:os')
const B_UDATA = path.join(os.tmpdir(), 'vd-udataB')
const B_LIB = path.join(B_UDATA, 'storage', 'data', 'library.json')
const B_LIBRARY_DIR = path.join(B_UDATA, 'storage', 'library')

const A = await cdp(9222)
const B = await cdp(9223)
const CFG = `window.api.setSyncConfig({ endpoint: '127.0.0.1', port: 9100, useSSL: false, bucket: 'vividdeck', accessKey: 'S3RVER', enabled: true, autoSync: false })`
for (const x of [A, B]) {
  await x.evaluate(`window.api.setSyncSecret('S3RVER')`)
  await x.evaluate(CFG)
}
// A 生成并导入 2 张测试图
const sharp = (await import('sharp')).default
const img1 = path.join(os.tmpdir(), 'vd-reg-1.jpg')
const img2 = path.join(os.tmpdir(), 'vd-reg-2.jpg')
await sharp({ create: { width: 2000, height: 1400, channels: 3, background: '#0ea5e9' } })
  .jpeg()
  .toFile(img1)
await sharp({ create: { width: 1600, height: 1200, channels: 3, background: '#f59e0b' } })
  .jpeg()
  .toFile(img2)
const imp = await A.evaluate(`window.api.importPaths(${JSON.stringify([img1, img2])})`)
assert(imp.added === 2, 'A 导入 2 张')
await A.evaluate(`window.api.syncNow()`)
await B.evaluate(`window.api.syncNow()`)
let lib = await B.evaluate('window.api.getLibrary()')
assert(
  lib.images.length === 2 && lib.images.every((i) => !i.localFile && i.path === ''),
  'B 同步后 2 条云端记录（path 为空）'
)

// ===== 关键步骤：重启 B（旧 bug 在重启时腐蚀全部云端记录）=====
B.close()
const { execSync } = await import('node:child_process')
execSync('taskkill /IM electron.exe /F', { stdio: 'ignore' }) // 会连 A 一起杀，稍后重启 A 无必要——A 数据已在云端
await new Promise((r) => setTimeout(r, 2000))

// 注入一条"旧 bug 产生的损坏记录"（path=目录、localFile=true），验证启动自愈
const raw = JSON.parse(fs.readFileSync(B_LIB, 'utf-8'))
raw.images[0].path = B_LIBRARY_DIR
raw.images[0].sourcePath = B_LIBRARY_DIR
raw.images[0].localFile = true
fs.writeFileSync(B_LIB, JSON.stringify(raw, null, 2))
console.log('  （已注入 1 条损坏记录：path=目录, localFile=true）')

// 重启 B（后台）
const { spawn } = await import('node:child_process')
spawn('npx', ['electron', '.', `--user-data-dir=${B_UDATA}`, '--remote-debugging-port=9223'], {
  env: { ...process.env, VD_ALLOW_DEV_SYNC: '1' },
  detached: true,
  stdio: 'ignore',
  shell: true
}).unref()
await waitFor(9223)
await new Promise((r) => setTimeout(r, 2000))

const B2 = await cdp(9223)
lib = await B2.evaluate('window.api.getLibrary()')
const healed = lib.images.every((i) => !i.localFile && i.path === '')
assert(healed, '重启后：损坏记录已自愈、云端记录未被腐蚀（全部 localFile=false 且 path 为空）')
assert(
  (await B2.evaluate('document.body.innerText.includes("全部下载到本地")')) === true,
  '重启后横幅出现'
)

const w = await B2.evaluate(
  `(async () => { return await Promise.race([ new Promise((res) => { const i = new Image(); i.onload = () => res(i.naturalWidth); i.onerror = () => res(-1); i.src = 'media://original/${lib.images[1].id}' }), new Promise((res) => setTimeout(() => res(-2), 30000)) ]) })()`
)
assert(w === 2000, '重启后点击云端图：实时下载原图并显示（宽 ' + w + '）')
B2.close()
console.log('== 重启回归 + 自愈验证全部通过 ==')
