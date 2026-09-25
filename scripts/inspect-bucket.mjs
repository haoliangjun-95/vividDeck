/**
 * 桶清单只读检查（一次性诊断，不写入任何内容）
 * 用开发实例的凭据（同步已禁用，仅读取）运行：
 *   npx electron scripts/inspect-bucket.mjs
 */
import { app, safeStorage } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import * as Minio from 'minio'

app.setName('vividdeck')
app.whenReady().then(async () => {
  try {
    const dataDir = path.join(
      process.env.VD_HOME ?? path.join(app.getPath('userData'), 'storage'),
      'storage',
      'data'
    )
    const cfg = JSON.parse(fs.readFileSync(path.join(dataDir, 'sync-config.json'), 'utf-8'))
    const secretBuf = fs.readFileSync(path.join(dataDir, 'sync-secret.bin'))
    const secret = safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(secretBuf) : ''
    const client = new Minio.Client({
      endPoint: cfg.endpoint,
      port: cfg.port,
      useSSL: cfg.useSSL,
      accessKey: cfg.accessKey,
      secretKey: secret
    })

    const keys = []
    const stream = client.listObjectsV2(cfg.bucket, 'manifests/', true)
    await new Promise((resolve, reject) => {
      stream.on('data', (o) => o.name?.endsWith('.json') && keys.push(o.name))
      stream.on('end', resolve)
      stream.on('error', reject)
    })
    console.log(`清单快照数: ${keys.length}`)

    const tombAll = new Map()
    let imageIds = new Set()
    let latest = null
    let latestTs = 0
    for (const key of keys) {
      const chunks = []
      const s = await client.getObject(cfg.bucket, key)
      await new Promise((resolve, reject) => {
        s.on('data', (c) => chunks.push(c))
        s.on('end', resolve)
        s.on('error', reject)
      })
      try {
        const m = JSON.parse(Buffer.concat(chunks).toString('utf-8'))
        const dev = key.split('/').pop()?.split('-')[0]?.slice(0, 8)
        console.log(
          `  ${path.basename(key)}: 设备${dev} 记录${m.images?.length ?? 0} 分类${m.categories?.length ?? 0} 墓碑${m.tombstones?.length ?? 0} @${new Date(m.updatedAt).toLocaleTimeString()}`
        )
        if (m.updatedAt > latestTs) {
          latestTs = m.updatedAt
          latest = m
        }
        for (const t of m.tombstones ?? []) {
          const old = tombAll.get(t.id)
          if (!old || t.deletedAt > old.deletedAt) tombAll.set(t.id, t)
        }
        for (const i of m.images ?? []) imageIds.add(i.id)
      } catch {
        console.log(`  ${path.basename(key)}: 解析失败`)
      }
    }

    console.log(`\n全部快照并集: 图片记录 ${imageIds.size} 条，墓碑 ${tombAll.size} 条`)
    console.log(
      `最新快照: ${latest ? `${latest.images.length} 条记录 / ${latest.tombstones.length} 墓碑` : '无'}`
    )
    const dedupTomb = [...tombAll.values()].filter((t) => t.deletedBy === 'dedup')
    console.log(`dedup 墓碑: ${dedupTomb.length} 条`)
    const byDev = {}
    for (const t of tombAll.values()) byDev[t.deletedBy] = (byDev[t.deletedBy] || 0) + 1
    console.log('墓碑来源分布:', JSON.stringify(byDev))
  } catch (err) {
    console.error('检查失败:', err.message)
  } finally {
    app.exit(0)
  }
})
