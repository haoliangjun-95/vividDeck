/**
 * A3 MinIO 单例 + 重试：
 * - retry.ts：瞬时错误判定 / 指数退避（半抖动）/ withRetry 重试编排
 * - client.ts getClient：按连接身份（地址/端口/SSL/账号/密钥指纹）缓存单例
 */
import { describe, expect, it, vi } from 'vitest'
import { backoffDelay, isTransientError, withRetry } from '@main/services/sync/retry'
import { getClient, resetClientCache } from '@main/services/sync/client'
import type { SyncConfig } from '@shared/types'

/** 构造带 code/statusCode 的错误（minio-js 网络错误形态） */
function errWith(props: { code?: string; statusCode?: number }, message = 'x'): Error {
  return Object.assign(new Error(message), props)
}

// ---------- isTransientError ----------
describe('isTransientError：瞬时错误判定', () => {
  it('网络连接类错误码视为瞬时', () => {
    expect(isTransientError(errWith({ code: 'ECONNRESET' }))).toBe(true)
    expect(isTransientError(errWith({ code: 'ETIMEDOUT' }))).toBe(true)
    expect(isTransientError(errWith({ code: 'EAI_AGAIN' }))).toBe(true)
    expect(isTransientError(errWith({ code: 'ECONNREFUSED' }))).toBe(true)
  })

  it('服务端 5xx / 限流 / 内部错误视为瞬时', () => {
    expect(isTransientError(errWith({ statusCode: 503 }))).toBe(true)
    expect(isTransientError(errWith({ statusCode: 500 }))).toBe(true)
    expect(isTransientError(errWith({ code: 'SlowDown' }))).toBe(true)
    expect(isTransientError(errWith({ code: 'InternalError' }))).toBe(true)
  })

  it('权限/不存在等永久错误不重试', () => {
    expect(isTransientError(errWith({ code: 'AccessDenied' }))).toBe(false)
    expect(isTransientError(errWith({ code: 'NoSuchKey' }))).toBe(false)
    expect(isTransientError(errWith({ statusCode: 404 }))).toBe(false)
    expect(isTransientError(errWith({ statusCode: 403 }))).toBe(false)
  })

  it('普通值与裸 Error 不视为瞬时', () => {
    expect(isTransientError(new Error('plain'))).toBe(false)
    expect(isTransientError(null)).toBe(false)
    expect(isTransientError('boom')).toBe(false)
    expect(isTransientError(undefined)).toBe(false)
  })
})

// ---------- backoffDelay ----------
describe('backoffDelay：指数退避 + 半抖动', () => {
  it('指数增长并封顶 maxMs（random=1 取上界）', () => {
    expect(backoffDelay(0, 500, 8000, () => 1)).toBe(500)
    expect(backoffDelay(1, 500, 8000, () => 1)).toBe(1000)
    expect(backoffDelay(3, 500, 8000, () => 1)).toBe(4000)
    expect(backoffDelay(10, 500, 8000, () => 1)).toBe(8000)
  })

  it('抖动落在期望值的 [50%, 100%] 区间', () => {
    expect(backoffDelay(0, 500, 8000, () => 0)).toBe(250)
    expect(backoffDelay(2, 500, 8000, () => 0.5)).toBe(1500) // 2000 × 0.75
  })
})

// ---------- withRetry ----------
describe('withRetry：重试编排', () => {
  it('首次成功直接返回，不 sleep', async () => {
    const sleep = vi.fn()
    const fn = vi.fn().mockResolvedValue('ok')
    await expect(withRetry(fn, { sleep })).resolves.toBe('ok')
    expect(fn).toHaveBeenCalledTimes(1)
    expect(sleep).not.toHaveBeenCalled()
  })

  it('瞬时失败按退避重试后成功', async () => {
    const sleeps: number[] = []
    const fn = vi
      .fn()
      .mockRejectedValueOnce(errWith({ code: 'ECONNRESET' }))
      .mockRejectedValueOnce(errWith({ code: 'ETIMEDOUT' }))
      .mockResolvedValue('done')
    const res = await withRetry(fn, {
      sleep: (ms) => {
        sleeps.push(ms)
        return Promise.resolve()
      },
      random: () => 1
    })
    expect(res).toBe('done')
    expect(fn).toHaveBeenCalledTimes(3)
    expect(sleeps).toEqual([500, 1000])
  })

  it('重试耗尽后抛出最后一次错误', async () => {
    const last = errWith({ statusCode: 503 }, 'down')
    const fn = vi.fn().mockRejectedValue(last)
    await expect(withRetry(fn, { retries: 2, sleep: () => Promise.resolve() })).rejects.toBe(last)
    expect(fn).toHaveBeenCalledTimes(3) // 首次 + 2 次重试
  })

  it('永久错误立即抛出，不消耗重试', async () => {
    const denied = errWith({ code: 'AccessDenied' })
    const fn = vi.fn().mockRejectedValue(denied)
    const sleep = vi.fn()
    await expect(withRetry(fn, { sleep })).rejects.toBe(denied)
    expect(fn).toHaveBeenCalledTimes(1)
    expect(sleep).not.toHaveBeenCalled()
  })
})

// ---------- getClient 单例 ----------
describe('getClient：按连接身份缓存单例', () => {
  const cfg = (over: Partial<SyncConfig> = {}): SyncConfig => ({
    enabled: true,
    endpoint: 'minio.test',
    port: 9000,
    useSSL: false,
    bucket: 'vividdeck',
    accessKey: 'ak',
    autoSync: false,
    scope: { type: 'all' },
    ...over
  })

  it('同一连接身份复用同一实例', () => {
    resetClientCache()
    const a = getClient(cfg(), 'sk')
    expect(getClient(cfg(), 'sk')).toBe(a)
  })

  it('端点归一化：协议前缀/尾斜杠不影响身份', () => {
    resetClientCache()
    const a = getClient(cfg({ endpoint: 'minio.test' }), 'sk')
    expect(getClient(cfg({ endpoint: 'https://minio.test/' }), 'sk')).toBe(a)
  })

  it('地址 / 账号 / 密钥变化时新建实例', () => {
    resetClientCache()
    const a = getClient(cfg(), 'sk')
    const b = getClient(cfg({ endpoint: 'other.test' }), 'sk')
    expect(b).not.toBe(a)
    expect(getClient(cfg({ endpoint: 'other.test', accessKey: 'ak2' }), 'sk')).not.toBe(b)
    const c = getClient(cfg({ endpoint: 'other.test', accessKey: 'ak2' }), 'sk')
    expect(getClient(cfg({ endpoint: 'other.test', accessKey: 'ak2' }), 'sk-rotated')).not.toBe(c)
  })

  it('端口与 SSL 参与身份', () => {
    resetClientCache()
    const a = getClient(cfg(), 'sk')
    expect(getClient(cfg({ port: 9001 }), 'sk')).not.toBe(a)
    const b = getClient(cfg({ port: 9001 }), 'sk')
    expect(getClient(cfg({ port: 9001, useSSL: true }), 'sk')).not.toBe(b)
  })
})
