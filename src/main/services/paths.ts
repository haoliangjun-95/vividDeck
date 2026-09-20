/**
 * 存储路径集中管理
 *
 * 目录结构（storageRoot 下）：
 *   data/        JSON 数据（素材库/轮播/历史/设置）
 *   library/     复制入库的媒体文件
 *   thumbnails/  缩略图缓存
 *   previews/    预览图缓存
 *   applied/     填充模式预渲染缓存
 *   bin/         Windows PowerShell 脚本
 *
 * 支持整体迁移到自定义目录（设置 → 存储位置 → 更改）。
 *
 * 注意：本模块被所有服务依赖且在模块加载时执行【旧布局迁移】，
 * 因此不依赖任何服务模块（避免循环引用），设置项直接按文件读取。
 */
import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'

/** 各子目录名（迁移与创建共用） */
const SUB_DIRS = ['data', 'library', 'thumbnails', 'previews', 'applied', 'bin'] as const

/** 默认存储根目录 */
export function defaultRoot(): string {
  return path.join(app.getPath('userData'), 'storage')
}

/**
 * 直接从磁盘读取 storageDir 设置（模块初始化阶段使用，
 * 不能依赖 settings 服务 —— settings 服务的 JsonStore 又依赖本模块的 dataDir）
 */
function readStorageDirSetting(): string {
  for (const file of [path.join(defaultRoot(), 'data/settings.json'), path.join(app.getPath('userData'), 'data/settings.json')]) {
    try {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf-8')) as { storageDir?: string }
      if (typeof parsed.storageDir === 'string' && parsed.storageDir) return parsed.storageDir
    } catch {
      /* 文件不存在则尝试下一个候选位置 */
    }
  }
  return ''
}

/**
 * 旧布局迁移：v1.0 早期版本把目录平铺在 userData 下。
 * 无自定义目录且新根不存在时，把旧目录整体挪进 userData/storage（同卷 rename，瞬时完成），
 * 并把 library.json 中指向旧 library/ 的绝对路径改写为新位置（避免记录断链被误判为云端）。
 */
function migrateLegacyLayout(): void {
  const userData = app.getPath('userData')
  const root = defaultRoot()
  if (fs.existsSync(root)) return
  fs.mkdirSync(root, { recursive: true })
  for (const name of SUB_DIRS) {
    const legacy = path.join(userData, name)
    if (fs.existsSync(legacy)) {
      try {
        fs.renameSync(legacy, path.join(root, name))
      } catch (err) {
        console.error(`[paths] 迁移旧目录失败: ${name}`, err)
      }
    }
  }
  // 记录路径改写：<userData>/library/xxx → <root>/library/xxx
  rewriteLibraryPaths(path.join(userData, 'library'), path.join(root, 'library'), root)
}

/**
 * 改写 data/library.json 中的绝对路径前缀（path / sourcePath）。
 * 在库文件实际就位的新 root 下操作，先写临时文件再原子替换。
 */
function rewriteLibraryPaths(oldPrefix: string, newPrefix: string, root: string): void {
  const file = path.join(root, 'data', 'library.json')
  try {
    if (!fs.existsSync(file)) return
    const raw = fs.readFileSync(file, 'utf-8')
    if (!raw.includes(oldPrefix)) return
  } catch {
    return
  }
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf-8')) as {
      images: { path: string; sourcePath: string }[]
    }
    let touched = false
    for (const img of data.images ?? []) {
      for (const key of ['path', 'sourcePath'] as const) {
        if (img[key]?.startsWith(oldPrefix + path.sep)) {
          img[key] = img[key].replace(oldPrefix, newPrefix)
          touched = true
        }
      }
    }
    if (touched) {
      const tmp = `${file}.tmp`
      fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8')
      fs.renameSync(tmp, file)
      console.log('[paths] library.json 记录路径已改写至新存储根目录')
    }
  } catch (err) {
    console.error('[paths] library.json 路径改写失败:', err)
  }
}

// 模块加载即确定存储根（先于所有服务的 JsonStore 构造）
migrateLegacyLayout()

/** 当前存储根目录（自定义目录存在则用自定义，否则默认） */
export function storageRoot(): string {
  const custom = readStorageDirSetting()
  if (custom && fs.existsSync(custom)) return custom
  return defaultRoot()
}

/** 是否配置了自定义存储目录（无论其当前是否可用） */
export function hasCustomStorageDir(): boolean {
  return readStorageDirSetting() !== ''
}

/** 自定义存储目录是否不可用（已配置但目录不存在，如外置盘未挂载） */
export function customStorageDirMissing(): boolean {
  const custom = readStorageDirSetting()
  return custom !== '' && !fs.existsSync(custom)
}

function sub(name: (typeof SUB_DIRS)[number]): string {
  const dir = path.join(storageRoot(), name)
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

export const dataDir = (): string => sub('data')
export const libraryDir = (): string => sub('library')
export const thumbDir = (): string => sub('thumbnails')
export const previewDir = (): string => sub('previews')
export const appliedDir = (): string => sub('applied')
export const binDir = (): string => sub('bin')

/** 递归统计目录占用（字节） */
export async function dirSize(dir: string): Promise<number> {
  let total = 0
  const walk = async (d: string): Promise<void> => {
    let entries: fs.Dirent[]
    try {
      entries = await fs.promises.readdir(d, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const full = path.join(d, entry.name)
      if (entry.isDirectory()) await walk(full)
      else if (entry.isFile()) {
        try {
          total += (await fs.promises.stat(full)).size
        } catch {
          /* 文件消失则忽略 */
        }
      }
    }
  }
  await walk(dir)
  return total
}
