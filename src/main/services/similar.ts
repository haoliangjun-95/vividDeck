/**
 * 近重复图片检测（dHash 感知哈希，主进程服务）：
 * - dHash 按【内容哈希】缓存（内容寻址——记录经同步合并/改名后缓存天然有效，
 *   不像按 id 键控会被 LWW 合并冲掉）；缓存随库剪枝
 * - sharp 9×8 灰度采样（并发 4），纯数学在 shared/dhash.ts
 * - 返回 ≥2 张的相似簇（汉明距离 ≤6 传递聚簇），供体检 UI 深链查看后人工清理
 */
import sharp from 'sharp'
import { JsonStore } from './store'
import { getLibrary } from './library'
import { isRealFile } from './paths'
import { runPool } from '../utils/concurrency'
import { dHashFromPixels, groupSimilar, type HashedItem } from '@shared/dhash'

/** 相似判定阈值：64 位 dHash 距离 ≤6 视为近重复（同场景连拍/重复截图/编辑版本） */
const DHASH_THRESHOLD = 6

const dhashStore = new JsonStore<Record<string, string>>('dhash-cache', {})

export interface SimilarGroup {
  ids: string[]
  fileNames: string[]
}

export async function findSimilar(
  onProgress?: (current: number, total: number) => void
): Promise<{ groups: SimilarGroup[]; scanned: number; computed: number }> {
  const data = getLibrary()
  const targets = data.images.filter((img) => img.localFile && isRealFile(img.path))
  const cache = dhashStore.get()

  // 1) 补算缺失的 dHash（内容哈希键控，二次扫描零成本）
  const need = targets.filter((img) => typeof cache[img.hash] !== 'string')
  let done = 0
  await runPool(need, 4, async (img) => {
    try {
      const { data: raw } = await sharp(img.path)
        .grayscale()
        .resize(9, 8, { fit: 'fill' })
        .raw()
        .toBuffer({ resolveWithObject: true })
      const h = dHashFromPixels(new Uint8Array(raw))
      if (h) cache[img.hash] = h
    } catch {
      /* 解码失败跳过（断链归体检管） */
    }
    done++
    onProgress?.(done, need.length)
  })

  // 2) 缓存剪枝：只保留库内仍存在的内容哈希（删图后条目不滞留）
  const retain = new Set(data.images.map((img) => img.hash))
  for (const key of Object.keys(cache)) {
    if (!retain.has(key)) delete cache[key]
  }
  dhashStore.save()

  // 3) 聚簇（≥2 张成组，按组员数降序）
  const hashed: HashedItem[] = []
  for (const img of targets) {
    const h = cache[img.hash]
    if (typeof h === 'string') hashed.push({ id: img.id, hash: h })
  }
  const byId = new Map(data.images.map((img) => [img.id, img]))
  const groups = groupSimilar(hashed, DHASH_THRESHOLD).map((ids) => ({
    ids,
    fileNames: ids.map((id) => byId.get(id)?.fileName ?? id)
  }))
  return { groups, scanned: targets.length, computed: hashed.length }
}
