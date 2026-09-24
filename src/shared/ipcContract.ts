/**
 * A2 IPC 契约类型化：通道 → 参数元组 / 返回值 / 调用模式的单一事实来源。
 *
 * - 主进程（main/ipc.ts 的 handle/handleRaw）与 preload（call/raw/send）都从本契约取类型，
 *   两端漂移会在 typecheck 阶段暴露，而非运行时。
 * - IpcContract 以 Record<IpcChannelName, …> 为基底：IPC 常量表中任何通道缺失条目都会编译报错。
 * - 本文件只有类型（外加零运行时逻辑），主/渲染/preload 三端均可安全 import。
 */
import { IPC, IPC_EVENTS } from './ipc'
import type {
  AppSettings,
  CropRect,
  FillMode,
  HistoryItem,
  ImageItem,
  ImportResult,
  LibraryData,
  MonitorInfo,
  SlideshowConfig,
  SmartAlbum,
  SmartAlbumRules,
  SyncConfig,
  SyncDownloadScope,
  SyncHealthReport,
  SyncProgress,
  SyncResultStats,
  SyncStatus
} from './types'

/** 图片属性补丁（收藏/分类/标签的单项或批量修改；undefined 字段不改） */
export type ImagePatch = Partial<Pick<ImageItem, 'favorite' | 'categoryId' | 'tags'>>

/** 智能相册补丁 */
export type AlbumPatch = Partial<Pick<SmartAlbum, 'name' | 'rules'>>

/** envelope 通道的统一响应结构（main wrap 产出 / preload call 消费） */
export type IpcEnvelope<T> = { ok: true; data: T } | { ok: false; error: string }

export type IpcChannelName = (typeof IPC)[keyof typeof IPC]
export type IpcEventName = (typeof IPC_EVENTS)[keyof typeof IPC_EVENTS]

/**
 * 调用模式：
 * - envelope：invoke + { ok, data | error } 包装（绝大多数通道）
 * - raw：invoke 直接返回业务值（历史遗留通道，preload 不解包）
 * - send：ipcRenderer.send 单向消息，无返回值
 */
export type IpcMode = 'envelope' | 'raw' | 'send'

export interface IpcChannelDef<
  TMode extends IpcMode = IpcMode,
  TReq extends unknown[] = unknown[],
  TRes = unknown
> {
  mode: TMode
  /** invoke/send 的参数元组（按位置） */
  req: TReq
  /** 渲染层最终拿到的返回值（envelope 通道为解包后的 data 类型） */
  res: TRes
}

/** 全部 IPC 通道契约（键必须覆盖 IPC 常量表，漏项即编译错误） */
export interface IpcContract extends Record<IpcChannelName, IpcChannelDef> {
  // ---------- 应用 ----------
  [IPC.APP_GET_STATE]: IpcChannelDef<
    'raw',
    [],
    { settings: AppSettings; platform: string; version: string }
  >
  [IPC.APP_SET_THEME]: IpcChannelDef<'envelope', [theme: AppSettings['theme']], AppSettings>
  [IPC.APP_SET_IMPORT_MODE]: IpcChannelDef<
    'envelope',
    [mode: AppSettings['importMode']],
    AppSettings
  >
  [IPC.APP_SET_DEFAULT_FILL]: IpcChannelDef<'envelope', [mode: FillMode], AppSettings>
  [IPC.APP_GET_STORAGE]: IpcChannelDef<
    'envelope',
    [],
    { root: string; custom: boolean; missing: boolean; sizeBytes: number; cacheBytes: number }
  >
  [IPC.APP_CLEAN_CACHE]: IpcChannelDef<
    'envelope',
    [],
    { removed: number; freedBytes: number; cacheBytes: number }
  >
  [IPC.APP_CHANGE_STORAGE]: IpcChannelDef<'envelope', [], { canceled: boolean; root?: string }>
  [IPC.APP_OPEN_USER_DATA]: IpcChannelDef<'raw', [], { ok: true }>
  [IPC.APP_QUIT]: IpcChannelDef<'raw', [], { ok: true }>

  // ---------- 素材库 ----------
  [IPC.DIALOG_PICK_IMPORT]: IpcChannelDef<'envelope', [mode: 'files' | 'folder'], string[]>
  [IPC.LIBRARY_IMPORT]: IpcChannelDef<'envelope', [payload: { paths: string[] }], ImportResult>
  [IPC.LIBRARY_GET_ALL]: IpcChannelDef<'raw', [], LibraryData>
  [IPC.LIBRARY_RENAME_IMAGE]: IpcChannelDef<
    'envelope',
    [payload: { id: string; fileName: string }],
    LibraryData
  >
  [IPC.LIBRARY_DELETE_IMAGE]: IpcChannelDef<'envelope', [payload: { id: string }], LibraryData>
  [IPC.LIBRARY_UPDATE_IMAGE]: IpcChannelDef<
    'envelope',
    [payload: { id: string; patch: ImagePatch }],
    LibraryData
  >
  [IPC.LIBRARY_UPDATE_IMAGES]: IpcChannelDef<
    'envelope',
    [payload: { ids: string[]; patch: ImagePatch }],
    LibraryData
  >
  [IPC.LIBRARY_DELETE_IMAGES]: IpcChannelDef<
    'envelope',
    [payload: { ids: string[]; mode?: 'all' | 'local' }],
    LibraryData
  >
  [IPC.LIBRARY_RESTORE_IMAGES]: IpcChannelDef<
    'envelope',
    [payload: { ids: string[] }],
    { restored: number }
  >
  [IPC.LIBRARY_APPLY_ENTRIES]: IpcChannelDef<
    'envelope',
    [payload: { entries: { id: string; patch: ImagePatch }[] }],
    LibraryData
  >
  [IPC.LIBRARY_SET_TAGS_MANY]: IpcChannelDef<
    'envelope',
    [payload: { entries: { id: string; tags: string[] }[] }],
    LibraryData
  >
  [IPC.LIBRARY_ADD_CATEGORY]: IpcChannelDef<'envelope', [payload: { name: string }], LibraryData>
  [IPC.LIBRARY_RENAME_CATEGORY]: IpcChannelDef<
    'envelope',
    [payload: { id: string; name: string }],
    LibraryData
  >
  [IPC.LIBRARY_DELETE_CATEGORY]: IpcChannelDef<'envelope', [payload: { id: string }], LibraryData>
  [IPC.LIBRARY_REORDER_CATEGORIES]: IpcChannelDef<
    'envelope',
    [payload: { ids: string[] }],
    LibraryData
  >

  // ---------- 智能相册 ----------
  [IPC.ALBUM_ADD]: IpcChannelDef<
    'envelope',
    [payload: { name: string; rules: SmartAlbumRules }],
    LibraryData
  >
  [IPC.ALBUM_UPDATE]: IpcChannelDef<
    'envelope',
    [payload: { id: string; patch: AlbumPatch }],
    LibraryData
  >
  [IPC.ALBUM_DELETE]: IpcChannelDef<'envelope', [payload: { id: string }], LibraryData>
  [IPC.ALBUM_COUNT]: IpcChannelDef<'envelope', [payload: { rules: SmartAlbumRules }], number>

  // ---------- 壁纸 ----------
  [IPC.WALLPAPER_LIST_MONITORS]: IpcChannelDef<'envelope', [], MonitorInfo[]>
  [IPC.WALLPAPER_APPLY]: IpcChannelDef<
    'envelope',
    [payload: { imageId: string; monitorIds: string[]; fillMode: FillMode }],
    { applied: string[] }
  >

  // ---------- 轮播 ----------
  [IPC.SLIDESHOW_GET]: IpcChannelDef<'raw', [], SlideshowConfig>
  [IPC.SLIDESHOW_SET]: IpcChannelDef<'envelope', [patch: Partial<SlideshowConfig>], SlideshowConfig>
  [IPC.SLIDESHOW_NEXT]: IpcChannelDef<'envelope', [], void>

  // ---------- MinIO 同步 ----------
  [IPC.SYNC_GET_CONFIG]: IpcChannelDef<
    'raw',
    [],
    { config: SyncConfig; status: SyncStatus; secretSet: boolean }
  >
  [IPC.SYNC_SET_CONFIG]: IpcChannelDef<'envelope', [patch: Partial<SyncConfig>], SyncConfig>
  [IPC.SYNC_SET_SECRET]: IpcChannelDef<
    'envelope',
    [payload: { secretKey: string }],
    { encrypted: boolean }
  >
  [IPC.SYNC_TEST]: IpcChannelDef<
    'raw',
    [],
    { ok: boolean; bucketCreated?: boolean; error?: string }
  >
  [IPC.SYNC_NOW]: IpcChannelDef<'envelope', [payload?: { force?: boolean }], SyncResultStats>
  [IPC.SYNC_DOWNLOAD]: IpcChannelDef<
    'envelope',
    [scope: SyncDownloadScope],
    { downloaded: number; failed: number; cancelled?: boolean }
  >
  [IPC.SYNC_ENSURE_LOCAL]: IpcChannelDef<
    'envelope',
    [payload: { imageId: string }],
    { path: string }
  >
  [IPC.SYNC_CANCEL_DOWNLOAD]: IpcChannelDef<'raw', [], { ok: true }>
  [IPC.SYNC_HEALTH_CHECK]: IpcChannelDef<'envelope', [], SyncHealthReport>
  [IPC.SYNC_HEALTH_CLEAN_ORPHANS]: IpcChannelDef<'envelope', [payload: { keys: string[] }], number>
  [IPC.SYNC_HEALTH_REPAIR_BROKEN]: IpcChannelDef<'envelope', [payload: { ids: string[] }], number>
  [IPC.SYNC_VERIFY_INTEGRITY]: IpcChannelDef<'envelope', [], { id: string; fileName: string }[]>
  [IPC.SYNC_DOWNLOAD_ESTIMATE]: IpcChannelDef<'envelope', [], { count: number; sizeBytes: number }>

  // ---------- 悬浮球 ----------
  [IPC.BUBBLE_MOVE_BY]: IpcChannelDef<'send', [dx: number, dy: number], void>
  [IPC.BUBBLE_CONTEXT_MENU]: IpcChannelDef<'send', [], void>
  [IPC.BUBBLE_SET_ENABLED]: IpcChannelDef<
    'envelope',
    [payload: { enabled: boolean }],
    { enabled: boolean }
  >
  [IPC.BUBBLE_CURRENT]: IpcChannelDef<'raw', [], { imageId: string | null }>

  // ---------- 历史 ----------
  [IPC.HISTORY_LIST]: IpcChannelDef<'raw', [], HistoryItem[]>
  [IPC.HISTORY_APPLY]: IpcChannelDef<
    'envelope',
    [payload: { historyId: string }],
    { applied: string[] }
  >
  [IPC.HISTORY_CLEAR]: IpcChannelDef<'raw', [], HistoryItem[]>

  // ---------- 裁剪 ----------
  [IPC.CROP_APPLY]: IpcChannelDef<
    'envelope',
    [payload: { imageId: string; rect: CropRect; label?: string }],
    ImageItem
  >
}

/** 主进程 → 渲染层推送事件的载荷契约 */
export interface IpcEventContract extends Record<IpcEventName, { payload: unknown }> {
  [IPC_EVENTS.SLIDESHOW_TICK]: { payload: { entry: HistoryItem; manual: boolean } }
  [IPC_EVENTS.SLIDESHOW_CHANGED]: { payload: SlideshowConfig }
  [IPC_EVENTS.SYNC_PROGRESS]: { payload: SyncProgress }
  [IPC_EVENTS.SYNC_DONE]: { payload: { ok: boolean; stats?: SyncResultStats; error?: string } }
  [IPC_EVENTS.LIBRARY_CHANGED]: { payload: undefined }
  [IPC_EVENTS.BUBBLE_UPDATE]: { payload: { imageId: string } }
}

export type IpcChannel = keyof IpcContract

/** 按调用模式筛出通道子集 */
type ChannelsOfMode<M extends IpcMode> = {
  [C in IpcChannel]: IpcContract[C]['mode'] extends M ? C : never
}[IpcChannel]

export type IpcEnvelopeChannel = ChannelsOfMode<'envelope'>
export type IpcRawChannel = ChannelsOfMode<'raw'>
export type IpcSendChannel = ChannelsOfMode<'send'>

/** 通道的参数元组类型 */
export type IpcReq<C extends IpcChannel> = IpcContract[C]['req']
/** 通道的返回值类型（envelope 通道 = 解包后的 data） */
export type IpcRes<C extends IpcChannel> = IpcContract[C]['res']
/** 事件载荷类型 */
export type IpcEventPayload<E extends IpcEventName> = IpcEventContract[E]['payload']
