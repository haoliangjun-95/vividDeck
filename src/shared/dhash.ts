/**
 * 感知哈希近重复检测（dHash 9×8）：纯函数核心。
 * 与内容 sha1（完全相同去重）互补，dHash 对缩放/轻微压缩/色调变化鲁棒，
 * 用于"同场景多张"（连拍、截图重复、编辑版本）的检测。
 * sharp 采样在主进程 services/similar.ts，此处只做可测的数学。
 * 断言见 tests/dhash.test.ts。
 */

/** 由 9×8=72 字节灰度像素行生成 64 位 dHash（16 位 hex 小写）。
 *  每行比较相邻像素（左>右 记 1），每行 8 bit、共 8 行，MSB 在前 */
export function dHashFromPixels(pixels: Uint8Array): string | null {
  if (pixels.length < 72) return null
  let hash = ''
  for (let row = 0; row < 8; row++) {
    let byte = 0
    for (let col = 0; col < 8; col++) {
      const left = pixels[row * 9 + col]
      const right = pixels[row * 9 + col + 1]
      byte = (byte << 1) | (left > right ? 1 : 0)
    }
    hash += byte.toString(16).padStart(2, '0')
  }
  return hash
}

/** 两个 16 位 hex 哈希的汉明距离（不同 bit 数）；长度不符返回 Infinity（视为不相似） */
export function hammingDistanceHex(a: string, b: string): number {
  if (a.length !== 16 || b.length !== 16) return Number.POSITIVE_INFINITY
  let dist = 0
  for (let i = 0; i < 16; i += 8) {
    let x = parseInt(a.slice(i, i + 8), 16) ^ parseInt(b.slice(i, i + 8), 16)
    while (x) {
      dist += x & 1
      x >>>= 1
    }
  }
  return dist
}

export interface HashedItem {
  id: string
  hash: string
}

/**
 * 按汉明距离阈值聚簇（并查集）：距离 ≤ threshold 的归为一组，
 * 传递性生效（A~B、B~C 同组，即使 A 与 C 相距较远——编辑链的常见形态）。
 * 返回成员数 ≥2 的簇，按成员数降序。
 */
export function groupSimilar(items: HashedItem[], threshold: number): string[][] {
  const parent = items.map((_, i) => i)
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]]
      i = parent[i]
    }
    return i
  }
  const union = (a: number, b: number): void => {
    const ra = find(a)
    const rb = find(b)
    if (ra !== rb) parent[rb] = ra
  }
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      if (hammingDistanceHex(items[i].hash, items[j].hash) <= threshold) union(i, j)
    }
  }
  const clusters = new Map<number, string[]>()
  items.forEach((item, i) => {
    const root = find(i)
    const list = clusters.get(root) ?? []
    list.push(item.id)
    clusters.set(root, list)
  })
  return Array.from(clusters.values())
    .filter((ids) => ids.length >= 2)
    .sort((a, b) => b.length - a.length)
}
