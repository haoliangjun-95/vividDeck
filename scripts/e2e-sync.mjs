/**
 * 双设备同步闭环验证（一次性脚本）
 * 前置：
 *   A: npx electron . --user-data-dir=/tmp/vd-udataA --remote-debugging-port=9222
 *   B: npx electron . --user-data-dir=/tmp/vd-udataB --remote-debugging-port=9223
 *   s3rver 运行于 127.0.0.1:9100
 * 运行：node scripts/e2e-sync.mjs
 * 验证：导入上传 → 对端可见 → 跨设备去重 → 收藏回传 → 按需下载 → 删除墓碑传播
 */
import sharp from 'sharp'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const assert = (cond, label) => {
  if (!cond) throw new Error(`✗ 断言失败: ${label}`)
  console.log(`  ✓ ${label}`)
}

async function cdp(port) {
  const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json()
  const page = targets.find((t) => t.type === 'page' && t.url.endsWith('index.html')) // 主窗口（排除悬浮球 bubble.html）
  if (!page) throw new Error(`端口 ${port} 无页面 target`)
  const ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
  let seq = 0
  const pending = new Map()
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data)
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) }
  }
  const evaluate = async (expression) => {
    const id = ++seq
    const p = new Promise((resolve) => pending.set(id, resolve))
    ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }))
    const res = await p
    if (res.result?.exceptionDetails) throw new Error('页面执行出错: ' + JSON.stringify(res.result.exceptionDetails.exception?.description ?? res.result.exceptionDetails))
    return res.result?.result?.value
  }
  return { evaluate, close: () => ws.close() }
}

async function main() {
  // 测试图：img1（A 导入）、img1 同内容不同文件名（B 导入，验证跨设备去重）
  const tmp1 = path.join(os.tmpdir(), 'vd-sync-1.jpg')
  const tmp1dup = path.join(os.tmpdir(), 'vd-sync-1-dup.jpg')
  await sharp({ create: { width: 2000, height: 1400, channels: 3, background: '#0ea5e9' } }).jpeg().toFile(tmp1)
  fs.copyFileSync(tmp1, tmp1dup)

  const A = await cdp(9222)
  const B = await cdp(9223)
  console.log('== 设备 A/B 已连接 ==')

  // 预检：两侧素材库必须为空（保证测试环境干净，避免连到残留实例）
  const preA = await A.evaluate('window.api.getLibrary()')
  const preB = await B.evaluate('window.api.getLibrary()')
  if (preA.images.length > 0 || preB.images.length > 0) {
    throw new Error(`环境不干净（A:${preA.images.length} B:${preB.images.length}），请用 /tmp/vd-kill.sh 清理并重起实例`)
  }
  console.log('  ✓ 双侧素材库为空，环境就绪')

  // s3rver 3.7.1 唯一内置凭证：S3RVER / S3RVER（credentials 选项在 v3 已失效）
  const SYNC_CFG = `window.api.setSyncConfig({ endpoint: '127.0.0.1', port: 9100, useSSL: false, bucket: 'vividdeck', accessKey: 'S3RVER', enabled: true, autoSync: false })`
  const SYNC_SECRET = `window.api.setSyncSecret('S3RVER')`

  // 0) 清空两边的库（测试环境隔离）—— /tmp userData 本来就是空的，双保险跳过
  // 1) A 配置并导入
  await A.evaluate(SYNC_SECRET)
  await A.evaluate(SYNC_CFG)
  const impA = await A.evaluate(`window.api.importPaths([${JSON.stringify(tmp1)}])`)
  assert(impA.added === 1, `A 导入 1 张（added=${impA.added}）`)
  const libA1 = await A.evaluate(`window.api.getLibrary()`)
  const imgId = libA1.images[0].id
  const imgHash = libA1.images[0].hash
  console.log(`  图片 id=${imgId.slice(-8)}… hash=${imgHash.slice(0, 10)}…`)

  // 2) A 首次同步（上传）
  const sync1 = await A.evaluate(`window.api.syncNow()`)
  assert(sync1.uploaded >= 1, `A 上传 ${sync1.uploaded} 张`)
  // s3rver 的 fs 存储把对象内容存为 <key>._S3rver_object（另附 metadata/md5 边车）
  const bucket = '/tmp/vd-s3/vividdeck'
  const manifestFiles = fs.readdirSync(`${bucket}/manifests`).filter((f) => f.endsWith('._S3rver_object'))
  assert(manifestFiles.length === 1, `远端 manifest 已发布: ${manifestFiles[0].replace('._S3rver_object', '')}`)
  assert(fs.existsSync(`${bucket}/objects/${imgHash}._S3rver_object`), '远端二进制 objects/<hash> 已上传')
  const thumbsDir = fs.readdirSync(`${bucket}/thumbs`).filter((f) => f.endsWith('._S3rver_object'))
  assert(thumbsDir.length === 1, `远端缩略图已上传: ${thumbsDir[0].replace('._S3rver_object', '')}`)

  // 3) B 配置并同步（拉取）
  await B.evaluate(SYNC_SECRET)
  await B.evaluate(SYNC_CFG)
  await B.evaluate(`window.api.syncNow()`)
  const libB1 = await B.evaluate(`window.api.getLibrary()`)
  assert(libB1.images.some((i) => i.id === imgId), 'B 拉取到 A 的图片记录')
  const bImg = libB1.images.find((i) => i.id === imgId)
  assert(bImg.localFile === false, 'B 侧记录为云端态（localFile=false）')
  const statusB = await B.evaluate(`window.api.getSyncInfo().then(i => i.status)`)
  assert(statusB.cloudOnlyCount === 1, `B 云端未下载数=1`)
  const thumbOkB = await B.evaluate(`(async () => {
    return await Promise.race([
      new Promise((res) => { const i = new Image(); i.onload = () => res(i.naturalWidth > 0); i.onerror = () => res(false); i.src = 'media://thumb/${imgId}'; }),
      new Promise((res) => setTimeout(() => res(false), 8000))
    ])
  })()`)
  assert(thumbOkB, 'B 画廊缩略图经远端拉取可显示')

  // 4) B 按需下载原图（media 链路兜底由协议层覆盖，此处直接验证下载入口）
  const dl = await B.evaluate(`window.api.syncEnsureLocal('${imgId}')`)
  assert(fs.existsSync(dl.path), `B 按需下载成功: ${path.basename(dl.path)}`)
  const libB3 = await B.evaluate(`window.api.getLibrary()`)
  assert(libB3.images.find((i) => i.id === imgId).localFile === true, 'B 记录回填 localFile=true')
  const previewOkB = await B.evaluate(`(async () => {
    return await Promise.race([
      new Promise((res) => { const i = new Image(); i.onload = () => res(i.naturalWidth > 0); i.onerror = () => res(false); i.src = 'media://preview/${imgId}'; }),
      new Promise((res) => setTimeout(() => res(false), 10000))
    ])
  })()`)
  assert(previewOkB, 'B 预览图可加载（原图已本地化）')

  // 5) B 收藏 → 回传 A（LWW）
  await B.evaluate(`window.api.updateImage('${imgId}', { favorite: true })`)
  await B.evaluate(`window.api.syncNow()`)
  await A.evaluate(`window.api.syncNow()`)
  const libA2 = await A.evaluate(`window.api.getLibrary()`)
  const aImg2 = libA2.images.find((i) => i.id === imgId)
  assert(aImg2?.favorite === true, 'B 的收藏已回传到 A')

  // 6) 离线并发导入同内容 → 合并期去重（跨设备各自导入同一文件）
  const tmp2 = path.join(os.tmpdir(), 'vd-sync-2.jpg')
  const tmp2dup = path.join(os.tmpdir(), 'vd-sync-2-dup.jpg')
  await sharp({ create: { width: 1800, height: 1200, channels: 3, background: '#f59e0b' } }).jpeg().toFile(tmp2)
  fs.copyFileSync(tmp2, tmp2dup)
  await A.evaluate(`window.api.importPaths([${JSON.stringify(tmp2)}])`)
  await A.evaluate(`window.api.syncNow()`)
  // B 尚未同步（不知道 A 的 img2 记录），离线导入同内容文件 → 产生并发重复
  const impB2 = await B.evaluate(`window.api.importPaths([${JSON.stringify(tmp2dup)}])`)
  assert(impB2.added === 1, `B 离线导入同内容文件（added=${impB2.added}）`)
  await B.evaluate(`window.api.syncNow()`)
  const libB4 = await B.evaluate(`window.api.getLibrary()`)
  assert(libB4.images.length === 2, `B 合并去重后共 2 条（img1+img2，实际 ${libB4.images.length}）`)
  const img2B = libB4.images.find((i) => i.id !== imgId)
  assert(img2B.localFile === true, '合并期去重把 B 的本地文件转移给规范记录')
  await A.evaluate(`window.api.syncNow()`)
  const libA4 = await A.evaluate(`window.api.getLibrary()`)
  assert(libA4.images.length === 2, `A 侧收敛后同样 2 条（实际 ${libA4.images.length}）`)

  // 7) B 删除 img1 → 墓碑传播 → A 删除
  await B.evaluate(`window.api.deleteImage('${imgId}')`)
  await B.evaluate(`window.api.syncNow()`)
  await A.evaluate(`window.api.syncNow()`)
  const libA3 = await A.evaluate(`window.api.getLibrary()`)
  assert(libA3.images.length === 1, '删除经墓碑传播，A 侧仅剩 img2（实际 ' + libA3.images.length + '）')
  // 多次同步会产生多个清单快照，墓碑在删除方（B）最新发布的快照里
  const allManifests = fs.readdirSync(`${bucket}/manifests`).filter((f) => f.endsWith('._S3rver_object'))
  const anyTombstone = allManifests.some((f) => {
    const m = JSON.parse(fs.readFileSync(`${bucket}/manifests/${f}`, 'utf-8'))
    return m.tombstones?.some((t) => t.id === imgId)
  })
  assert(anyTombstone, `远端 manifest 含删除墓碑（共 ${allManifests.length} 份快照）`)

  A.close()
  B.close()
  console.log('== 双设备同步闭环全部通过 ==')
}

main().catch((err) => {
  console.error(err.message ?? err)
  process.exit(1)
})
