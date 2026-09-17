/**
 * 本地 S3 兼容测试服务（s3rver，仅开发/测试用）
 * 运行：node scripts/test-s3-server.mjs
 * 端点：http://127.0.0.1:9100  bucket: vividdeck
 * 凭证：S3RVER / S3RVER（s3rver 3.7.1 内置唯一凭证，credentials 选项在 v3 已失效）
 * 数据目录：/tmp/vd-s3（可随时清空重来）
 */
import S3rver from 's3rver'
import fs from 'node:fs'

fs.mkdirSync('/tmp/vd-s3', { recursive: true })

const server = new S3rver({
  directory: '/tmp/vd-s3',
  port: 9100,
  address: '127.0.0.1',
  silent: false,
  configureBuckets: [{ name: 'vividdeck' }]
})

server.run((err, { address, port } = {}) => {
  if (err) {
    console.error('s3rver 启动失败:', err)
    process.exit(1)
  }
  console.log(`s3rver 测试服务已启动: http://${address}:${port} (bucket: vividdeck, ak/sk: S3RVER/S3RVER)`)
})
