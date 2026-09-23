/** 文件系统小工具 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

/** 递归创建目录（已存在则忽略） */
export function mkdirp(dir: string): void {
  fs.mkdirSync(dir, { recursive: true })
}

/** 生成短随机 ID（含时间前缀，便于排序与调试） */
export function genId(): string {
  const t = Date.now().toString(36)
  const r = crypto.randomBytes(6).toString('hex')
  return `${t}${r}`
}

/**
 * 计算文件内容 sha1 哈希（流式读取，大文件不占内存）
 * 用途：导入去重 + 二期 MinIO 增量同步的基础
 */
export function hashFile(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha1')
    const stream = fs.createReadStream(filePath)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('end', () => resolve(hash.digest('hex')))
    stream.on('error', reject)
  })
}

/** 文件名安全化：去除路径分隔符与非法字符 */
export function sanitizeFileName(name: string): string {
  const cleaned = name.replace(/[/\\:*?"<>|]/g, '_').replace(/\s+/g, ' ').trim()
  return cleaned.length ? cleaned.slice(0, 200) : '未命名'
}

/**
 * ID 片段安全化（C1）：仅保留 [0-9A-Za-z-]，截断至 64 字符。
 * 本地 genId() 产出 ^[0-9a-z]+$ 为其子集，合法 id 原样通过；
 * 云端恶意 id（如 ../../xxx）被中和为安全片段。
 * 注意 `_` 也被映射为 `-`：下游派生名（缓存 `id_hash`、暂存 `id_文件名`）
 * 都以 `_` 作分隔符，id 段不含 `_` 才能保证前缀匹配无歧义。
 */
export function sanitizeIdSegment(id: string): string {
  const cleaned = String(id).replace(/[^0-9A-Za-z-]/g, '-').slice(0, 64)
  return cleaned.length ? cleaned : '-'
}

/**
 * 路径包含断言（C1/H4）：确认 target 位于 root 之内，否则抛错。
 * 所有以外部可控输入（云端 id/hash/fileName）拼接的写入路径必须先过此断言。
 */
export function assertInside(root: string, target: string): string {
  const rel = path.relative(path.resolve(root), path.resolve(target))
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`路径越界拒绝写入: ${path.basename(target)}`)
  }
  return target
}

/** 带扩展名拆分 */
export function splitFileName(fileName: string): { base: string; ext: string } {
  const idx = fileName.lastIndexOf('.')
  if (idx <= 0) return { base: fileName, ext: '' }
  return { base: fileName.slice(0, idx), ext: fileName.slice(idx).toLowerCase() }
}

/** 深度遍历目录，收集支持格式的图片文件 */
export function collectImageFiles(root: string, supportedExts: string[]): string[] {
  const results: string[] = []
  const walk = (dir: string, depth: number): void => {
    if (depth > 8) return // 防御超深目录
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        if (entry.name.startsWith('.') || entry.name === 'node_modules') continue
        walk(full, depth + 1)
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase()
        if (supportedExts.includes(ext)) results.push(full)
      }
    }
  }
  walk(root, 0)
  return results
}
