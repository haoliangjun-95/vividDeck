/**
 * A3 MinIO 重试：瞬时错误判定 + 指数退避（半抖动）+ 重试编排。
 *
 * 纯函数模块，无副作用依赖 —— sleep/random 均可注入，测试完全确定性。
 * 仅包裹幂等操作（GET/PUT/HEAD/list/fPut/fGet/removeObjects），
 * 非瞬时错误（权限/不存在/参数错误）立即抛出，不消耗重试。
 */

/** 视为瞬时的网络层错误码（Node socket / DNS） */
const TRANSIENT_NET_CODES = new Set([
  'ECONNRESET',
  'ETIMEDOUT',
  'ECONNREFUSED',
  'EPIPE',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ENOTFOUND',
  'EAI_AGAIN'
])

/** 视为瞬时的 MinIO/S3 服务端错误码 */
const TRANSIENT_S3_CODES = new Set([
  'InternalError',
  'ServiceUnavailable',
  'SlowDown',
  'RequestTimeout'
])

interface ErrorWithMeta {
  code?: unknown
  statusCode?: unknown
  status?: unknown
}

/**
 * 判定错误是否值得重试：
 * - 网络错误码（连接重置/超时/DNS 抖动等）
 * - 服务端 5xx（statusCode/status ≥ 500）
 * - MinIO 限流与内部错误码
 * 其余（403/404/参数错误/裸 Error/非 Error 值）视为永久错误。
 */
export function isTransientError(err: unknown): boolean {
  if (!(err instanceof Error)) return false
  const meta = err as ErrorWithMeta
  if (typeof meta.code === 'string') {
    if (TRANSIENT_NET_CODES.has(meta.code) || TRANSIENT_S3_CODES.has(meta.code)) return true
  }
  const status = typeof meta.statusCode === 'number' ? meta.statusCode : meta.status
  return typeof status === 'number' && status >= 500
}

/** 默认 sleep（测试注入替代） */
const realSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * 计算第 attempt 次重试前的等待毫秒数：指数退避封顶 maxMs，
 * 半抖动取期望值的 [50%, 100%]，避免多实例同步重试造成尖峰。
 */
export function backoffDelay(
  attempt: number,
  baseMs: number,
  maxMs: number,
  random: () => number = Math.random
): number {
  const exponential = Math.min(maxMs, baseMs * 2 ** attempt)
  return Math.round(exponential * (0.5 + random() * 0.5))
}

export interface RetryOptions {
  /** 最大重试次数（不含首次调用），默认 3 */
  retries?: number
  /** 退避基数毫秒，默认 500 */
  baseMs?: number
  /** 退避上限毫秒，默认 8000 */
  maxMs?: number
  /** 日志标签（如 'listManifests'），便于定位重试来源 */
  label?: string
  /** 可注入 sleep（测试确定性） */
  sleep?: (ms: number) => Promise<void>
  /** 可注入随机源（测试确定性） */
  random?: () => number
}

/**
 * 带重试执行 fn：瞬时错误按退避重试至多 retries 次，耗尽后抛出最后一次错误；
 * 永久错误立即抛出。fn 必须幂等。
 */
export async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const {
    retries = 3,
    baseMs = 500,
    maxMs = 8000,
    label = 'op',
    sleep = realSleep,
    random = Math.random
  } = options

  let lastError: unknown
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn()
    } catch (err) {
      if (!isTransientError(err)) throw err
      lastError = err
      if (attempt === retries) break
      const delay = backoffDelay(attempt, baseMs, maxMs, random)
      const message = err instanceof Error ? err.message : String(err)
      console.warn(`[sync] ${label} 瞬时失败（${message}），${delay}ms 后第 ${attempt + 1} 次重试`)
      await sleep(delay)
    }
  }
  throw lastError
}
