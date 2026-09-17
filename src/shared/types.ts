/**
 * vividDeck 共享类型定义
 * 主进程 / preload / 渲染层三方共用，是 IPC 通信的数据契约。
 */

/** 支持的图片格式（sharp 统一解码，HEIC 不依赖系统编解码器） */
export type ImageFormat = 'jpeg' | 'png' | 'webp' | 'heic' | 'avif' | 'tiff' | 'gif'

/** 壁纸填充模式：铺满 / 拉伸 / 居中 / 适应 */
export type FillMode = 'fill' | 'stretch' | 'center' | 'fit'

/** 素材库图片记录 */
export interface ImageItem {
  /** 稳定唯一 ID（nanoid 风格），跨设备同步的身份基础（二期 MinIO 预留） */
  id: string
  /** 当前文件名（重命名会同步修改） */
  fileName: string
  /** 媒体库内绝对路径（引用模式则为原文件路径） */
  path: string
  /** 引用模式下的原文件路径；复制模式与 path 相同 */
  sourcePath: string
  /** 内容哈希（sha1，用于去重；二期同步增量上传的基础） */
  hash: string
  width: number
  height: number
  sizeBytes: number
  format: ImageFormat
  /** 所属分类，null 表示未分类 */
  categoryId: string | null
  tags: string[]
  favorite: boolean
  addedAt: number
}

/** 自定义分类 */
export interface Category {
  id: string
  name: string
  createdAt: number
}

export interface LibraryData {
  images: ImageItem[]
  categories: Category[]
  tags: string[]
}

/** 显示器信息（跨平台统一抽象） */
export interface MonitorInfo {
  /** 适配层内部 ID：darwin:<idx> / win:<设备路径> */
  id: string
  /** 展示名，如 "Built-in Retina Display" / "\\.\DISPLAY1" */
  label: string
  /** 物理分辨率（像素，已含 DPI 缩放） */
  width: number
  height: number
  scaleFactor: number
  isMain: boolean
}

/** 轮播周期单位 */
export type IntervalUnit = 'minute' | 'hour' | 'day'

/** 轮播顺序：随机（洗牌防重复）/ 顺序循环 */
export type SlideshowOrder = 'random' | 'sequential'

/** 轮播素材范围 */
export interface SlideshowScope {
  type: 'all' | 'category' | 'favorite'
  /** type === 'category' 时的分类 ID */
  categoryId?: string
}

/** 轮播配置（全部本地持久化） */
export interface SlideshowConfig {
  enabled: boolean
  intervalValue: number
  intervalUnit: IntervalUnit
  scope: SlideshowScope
  order: SlideshowOrder
  /** 轮播使用的填充模式 */
  fillMode: FillMode
  /** 目标显示器（多选；显示器不存在时自动跳过） */
  monitorIds: string[]
  /** 顺序模式的下次索引 / 随机模式的上一次索引（重启续播） */
  lastIndex: number
  lastAppliedAt: number | null
}

/** 壁纸历史记录 */
export interface HistoryItem {
  id: string
  imageId: string
  monitorIds: string[]
  fillMode: FillMode
  appliedAt: number
}

/** 应用设置 */
export interface AppSettings {
  theme: 'system' | 'light' | 'dark'
  /** 导入模式：copy 复制入库 / reference 仅引用原路径 */
  importMode: 'copy' | 'reference'
  /** 默认填充模式（设壁纸对话框与设置页共用） */
  defaultFillMode: FillMode
  /**
   * 自定义存储目录（空 = 使用默认 userData/storage）。
   * 全部素材、缓存与 JSON 数据都在该目录下，可整体迁移到其他磁盘。
   */
  storageDir: string
}

/** 导入结果统计 */
export interface ImportResult {
  added: number
  skipped: number
  /** 跳过原因明细（重复/不支持的格式等） */
  reasons: string[]
}

/** 筛选条件（渲染层内存过滤用） */
export interface LibraryFilter {
  keyword: string
  categoryId: string | null | 'all' | 'favorites'
  tag: string | null
  /** 最小宽度（像素），0 为不限 */
  minWidth: number
  /** 文件大小下/上限（MB），0 为不限 */
  minSizeMB: number
  maxSizeMB: number
}

/** 裁剪参数（基于原图像素坐标） */
export interface CropRect {
  x: number
  y: number
  width: number
  height: number
}

export const SUPPORTED_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif']

export const FILL_MODE_LABELS: Record<FillMode, string> = {
  fill: '铺满',
  stretch: '拉伸',
  center: '居中',
  fit: '适应屏幕'
}

/** 预置分类（首次启动时创建） */
export const DEFAULT_CATEGORY_NAMES = ['风景', '人物', '动漫', '极简', '工作背景']
