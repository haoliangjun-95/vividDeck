/**
 * 并发控制工具：以固定并发度执行异步任务（worker 池模式）
 * 供同步引擎 / 体检 / manifest 拉取共用，避免无上限并发打爆端口与 FD
 */

/**
 * 以 limit 并发执行 fn(item, index)，全部完成后 resolve。
 * - fn 内部抛错会向上传播（调用方按需 catch）
 * - items 为空时立即返回
 */
export async function runPool<T>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<void>
): Promise<void> {
  if (items.length === 0) return
  let index = 0
  const workerCount = Math.min(limit, items.length)
  const workers = Array.from({ length: workerCount }, async () => {
    while (index < items.length) {
      const i = index++
      await fn(items[i], i)
    }
  })
  await Promise.all(workers)
}
