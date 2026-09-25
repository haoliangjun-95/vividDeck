/**
 * A4（试点）：worker 线程并行 sha1 哈希池
 *
 * 动机：全库完整性校验（verifyIntegrity）此前在主进程逐文件流式哈希，
 * 大库时 sha1 计算持续占用主线程事件循环 → UI 卡顿。本模块把计算搬进
 * worker_threads，主线程只收发消息（每条一个路径/一个 40 字符结果）。
 *
 * 设计取舍：
 * - 内联 eval worker、只用 Node 内置模块（crypto/fs/worker_threads）：
 *   无独立构建产物 → dev / 打包 asar / vitest 三种运行形态零配置一致，
 *   也没有原生模块在 worker 内的路径解析问题（sharp 迁移是后续独立一步）
 * - 固定并发 + 链式派发：每个 worker 同一时刻只处理一个文件，
 *   完成即领下一个任务；单文件失败只跳过该文件（与旧逐文件 catch 语义一致）
 */
import os from 'node:os'
import { Worker } from 'node:worker_threads'

/** 池大小上限：哈希同时受磁盘 IO 约束，超过 4 收益递减 */
const HASH_POOL_MAX = 4

export interface HashWorkerMessage {
  path: string
  hash?: string
  error?: string
}

export interface HashPoolOptions {
  /** 并发 worker 数（默认 min(4, CPU-1)，且不超过任务数） */
  concurrency?: number
  /** 每完成一个文件回调一次（完成序，非提交序） */
  onProgress?: (current: number, total: number) => void
}

/** worker 源码：CJS 内联脚本，仅用 Node 内置模块 */
const HASH_WORKER_SOURCE = `
const { parentPort } = require('node:worker_threads')
const crypto = require('node:crypto')
const fs = require('node:fs')

function hashFile(path) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha1')
    const stream = fs.createReadStream(path)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('end', () => resolve(hash.digest('hex')))
    stream.on('error', reject)
  })
}

parentPort.on('message', (path) => {
  hashFile(path).then(
    (hex) => parentPort.postMessage({ path, hash: hex }),
    (err) => parentPort.postMessage({ path, error: String((err && err.message) || err) })
  )
})
`

/** 默认并发：CPU 核数 - 1（给主线程留余量），封顶 4，至少 1 */
export function defaultConcurrency(): number {
  return Math.max(1, Math.min(HASH_POOL_MAX, os.availableParallelism() - 1))
}

/**
 * 并行计算一批文件的 sha1。
 * @returns path → sha1 hex；读取/哈希失败的文件不出现在结果中（不 reject 整批）
 */
export async function hashFilesParallel(
  files: readonly string[],
  options: HashPoolOptions = {}
): Promise<Map<string, string>> {
  const total = files.length
  const results = new Map<string, string>()
  if (total === 0) return results

  const { concurrency = defaultConcurrency(), onProgress } = options
  const poolSize = Math.max(1, Math.min(concurrency, total))
  let next = 0
  let done = 0

  await new Promise<void>((resolve, reject) => {
    let settled = false
    const pool: Worker[] = []

    const finish = (err?: unknown): void => {
      if (settled) return
      settled = true
      for (const w of pool) void w.terminate()
      if (err !== undefined) reject(err instanceof Error ? err : new Error(String(err)))
      else resolve()
    }

    const spawnWorker = (): void => {
      const worker = new Worker(HASH_WORKER_SOURCE, { eval: true })
      pool.push(worker)
      worker.on('message', (msg: HashWorkerMessage) => {
        if (typeof msg.hash === 'string') results.set(msg.path, msg.hash)
        else console.warn(`[hashPool] 哈希失败（跳过）${msg.path}:`, msg.error)
        done += 1
        onProgress?.(done, total)
        if (done >= total) finish()
        else if (next < total) worker.postMessage(files[next++])
      })
      // worker 线程自身崩溃（非单文件错误）属基础设施故障：整批失败
      worker.on('error', (err) => finish(err))
      worker.postMessage(files[next++])
    }

    for (let i = 0; i < poolSize; i++) spawnWorker()
  })

  return results
}
