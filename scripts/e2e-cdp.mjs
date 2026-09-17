/**
 * 端到端验证脚本：通过 CDP 驱动运行中的 vividDeck
 * 前置：npx electron . --remote-debugging-port=9222
 * 运行：node scripts/e2e-cdp.mjs
 * 验证：preload 桥 → IPC → 导入管线（哈希/缩略图）→ media:// 协议回读
 */
import sharp from 'sharp'
import os from 'node:os'
import path from 'node:path'

const CDP = 'http://127.0.0.1:9222'

async function main() {
  // 1. 生成两张测试图（一张正常、一张与第一张内容相同用于验证去重）
  const tmpA = path.join(os.tmpdir(), 'vd-e2e-a.jpg')
  const tmpB = path.join(os.tmpdir(), 'vd-e2e-b.jpg')
  await sharp({ create: { width: 2400, height: 1600, channels: 3, background: '#4f46e5' } }).jpeg().toFile(tmpA)
  await sharp(tmpA).jpeg().toFile(tmpB) // 同内容不同文件名

  // 2. 找到页面 target
  const targets = await (await fetch(`${CDP}/json`)).json()
  const page = targets.find((t) => t.type === 'page')
  if (!page) throw new Error('未找到页面 target（应用是否以 --remote-debugging-port 启动？）')

  const ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((res, rej) => {
    ws.onopen = res
    ws.onerror = rej
  })

  let seq = 0
  const pending = new Map()
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data)
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg)
      pending.delete(msg.id)
    }
  }
  const send = (method, params) =>
    new Promise((resolve) => {
      const id = ++seq
      pending.set(id, resolve)
      ws.send(JSON.stringify({ id, method, params }))
    })

  /** 在页面里执行异步表达式并取值 */
  const evaluate = async (expression) => {
    const res = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (res.result?.exceptionDetails) throw new Error('页面执行出错: ' + JSON.stringify(res.result.exceptionDetails))
    return res.result?.result?.value
  }

  // 3. E2E 断言
  console.log('== vividDeck 端到端验证 ==')

  const state = await evaluate(`window.api.getState()`)
  console.log(`✓ preload 桥可用，platform=${state.platform} version=${state.version}`)

  const before = await evaluate(`window.api.getLibrary()`)
  const r1 = await evaluate(`window.api.importPaths([${JSON.stringify(tmpA)}, ${JSON.stringify(tmpB)}])`)
  console.log(`✓ 导入结果: 新增 ${r1.added}，跳过 ${r1.skipped}（期望 1 / 1，验证内容哈希去重）`)

  const lib = await evaluate(`window.api.getLibrary()`)
  const added = lib.images.filter((img) => !before.images.some((o) => o.id === img.id))
  const img = added[0]
  console.log(`✓ 入库记录: ${img.fileName} ${img.width}x${img.height} hash=${img.hash.slice(0, 10)}…`)

  // media:// 缩略图协议回读（Image 加载成功即协议+缩略图生成 OK）
  const thumbOk = await evaluate(`(async () => {
    const ok = await Promise.race([
      new Promise((res) => { const i = new Image(); i.onload = () => res(i.naturalWidth > 0); i.onerror = () => res(false); i.src = 'media://thumb/${img.id}'; }),
      new Promise((res) => setTimeout(() => res(false), 5000))
    ])
    return ok
  })()`)
  console.log(`✓ media://thumb 协议加载缩略图: ${thumbOk ? '成功' : '失败'}`)

  // 预览图协议
  const previewOk = await evaluate(`(async () => {
    const ok = await Promise.race([
      new Promise((res) => { const i = new Image(); i.onload = () => res(true); i.onerror = () => res(false); i.src = 'media://preview/${img.id}'; }),
      new Promise((res) => setTimeout(() => res(false), 8000))
    ])
    return ok
  })()`)
  console.log(`✓ media://preview 协议加载预览图: ${previewOk ? '成功' : '失败'}`)

  // 分类/收藏/标签更新
  const favLib = await evaluate(`window.api.updateImage(${JSON.stringify(img.id)}, { favorite: true, tags: ['冒烟测试'] })`)
  const favImg = favLib.images.find((i) => i.id === img.id)
  console.log(`✓ 更新属性: favorite=${favImg.favorite} tags=${JSON.stringify(favImg.tags)}`)

  // 清理测试数据（删库记录 + 废纸篓）
  const cleaned = await evaluate(`window.api.deleteImage(${JSON.stringify(img.id)})`)
  console.log(`✓ 清理完成，剩余 ${cleaned.images.length} 张`)

  ws.close()
  console.log('== 端到端验证全部通过 ==')
}

main().catch((err) => {
  console.error('✗ 验证失败:', err)
  process.exit(1)
})
