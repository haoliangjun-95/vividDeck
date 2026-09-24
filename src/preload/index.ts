/**
 * preload 桥：以 contextBridge 暴露类型安全的 window.api
 * - 全部走 ipcRenderer.invoke（请求-响应），无任意 channel 透传
 * - 订阅类事件（轮播推送）单独暴露 on/off 方法
 * - A2：每个通道的参数/返回类型均来自 @shared/ipcContract 单一事实来源，
 *   与主进程 handler 的漂移会在 typecheck 阶段暴露，而非运行时
 */
import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { IPC, IPC_EVENTS } from '@shared/ipc'
import type {
  AlbumPatch,
  ImagePatch,
  IpcEnvelope,
  IpcEnvelopeChannel,
  IpcEventName,
  IpcEventPayload,
  IpcRawChannel,
  IpcReq,
  IpcRes,
  IpcSendChannel
} from '@shared/ipcContract'
import type {
  AppSettings,
  CropRect,
  FillMode,
  HistoryItem,
  SlideshowConfig,
  SmartAlbumRules,
  SyncConfig,
  SyncDownloadScope,
  SyncProgress,
  SyncResultStats
} from '@shared/types'

/** envelope 通道 invoke：解包 { ok, data | error }，业务失败抛 Error */
async function call<C extends IpcEnvelopeChannel>(
  channel: C,
  ...args: IpcReq<C>
): Promise<IpcRes<C>> {
  const res = (await ipcRenderer.invoke(channel, ...args)) as IpcEnvelope<IpcRes<C>>
  if (!res.ok) throw new Error(res.error)
  return res.data
}

/** raw 通道 invoke：直接返回业务值（历史遗留通道，无 envelope 包装） */
async function raw<C extends IpcRawChannel>(channel: C, ...args: IpcReq<C>): Promise<IpcRes<C>> {
  return (await ipcRenderer.invoke(channel, ...args)) as IpcRes<C>
}

/** send 单向消息（悬浮球拖动等高频操作，无响应） */
function send<C extends IpcSendChannel>(channel: C, ...args: IpcReq<C>): void {
  ipcRenderer.send(channel, ...args)
}

/** 订阅主进程推送事件，返回取消订阅函数 */
function subscribe<E extends IpcEventName>(
  event: E,
  cb: (payload: IpcEventPayload<E>) => void
): () => void {
  const listener = (_e: Electron.IpcRendererEvent, payload: IpcEventPayload<E>): void => cb(payload)
  ipcRenderer.on(event, listener)
  return () => {
    ipcRenderer.removeListener(event, listener)
  }
}

const api = {
  // ---------- 应用 ----------
  getState: () => raw(IPC.APP_GET_STATE),
  setTheme: (theme: AppSettings['theme']) => call(IPC.APP_SET_THEME, theme),
  setImportMode: (mode: AppSettings['importMode']) => call(IPC.APP_SET_IMPORT_MODE, mode),
  setDefaultFillMode: (mode: FillMode) => call(IPC.APP_SET_DEFAULT_FILL, mode),
  getStorageInfo: () => call(IPC.APP_GET_STORAGE),
  /** 缓存清理（#8）：孤儿缩略图/预览 + 预渲染缓存；cacheBytes 为清理后剩余占用 */
  cleanCache: () => call(IPC.APP_CLEAN_CACHE),
  changeStorageDir: () => call(IPC.APP_CHANGE_STORAGE),
  openUserData: () => raw(IPC.APP_OPEN_USER_DATA),
  quit: () => raw(IPC.APP_QUIT),

  // ---------- 素材库 ----------
  pickImport: (mode: 'files' | 'folder') => call(IPC.DIALOG_PICK_IMPORT, mode),
  importPaths: (paths: string[]) => call(IPC.LIBRARY_IMPORT, { paths }),
  getLibrary: () => raw(IPC.LIBRARY_GET_ALL),
  renameImage: (id: string, fileName: string) => call(IPC.LIBRARY_RENAME_IMAGE, { id, fileName }),
  deleteImage: (id: string) => call(IPC.LIBRARY_DELETE_IMAGE, { id }),
  updateImage: (id: string, patch: ImagePatch) => call(IPC.LIBRARY_UPDATE_IMAGE, { id, patch }),
  updateImages: (ids: string[], patch: ImagePatch) =>
    call(IPC.LIBRARY_UPDATE_IMAGES, { ids, patch }),
  deleteImages: (ids: string[], mode?: 'all' | 'local') =>
    call(IPC.LIBRARY_DELETE_IMAGES, { ids, mode }),
  restoreImages: (ids: string[]) => call(IPC.LIBRARY_RESTORE_IMAGES, { ids }),
  applyEntries: (entries: { id: string; patch: ImagePatch }[]) =>
    call(IPC.LIBRARY_APPLY_ENTRIES, { entries }),
  setTagsMany: (entries: { id: string; tags: string[] }[]) =>
    call(IPC.LIBRARY_SET_TAGS_MANY, { entries }),
  addCategory: (name: string) => call(IPC.LIBRARY_ADD_CATEGORY, { name }),
  renameCategory: (id: string, name: string) => call(IPC.LIBRARY_RENAME_CATEGORY, { id, name }),
  deleteCategory: (id: string) => call(IPC.LIBRARY_DELETE_CATEGORY, { id }),
  reorderCategories: (ids: string[]) => call(IPC.LIBRARY_REORDER_CATEGORIES, { ids }),
  addAlbum: (name: string, rules: SmartAlbumRules) => call(IPC.ALBUM_ADD, { name, rules }),
  updateAlbum: (id: string, patch: AlbumPatch) => call(IPC.ALBUM_UPDATE, { id, patch }),
  deleteAlbum: (id: string) => call(IPC.ALBUM_DELETE, { id }),
  countAlbum: (rules: SmartAlbumRules) => call(IPC.ALBUM_COUNT, { rules }),

  // ---------- 壁纸 ----------
  listMonitors: () => call(IPC.WALLPAPER_LIST_MONITORS),
  applyWallpaper: (imageId: string, monitorIds: string[], fillMode: FillMode) =>
    call(IPC.WALLPAPER_APPLY, { imageId, monitorIds, fillMode }),

  // ---------- 轮播 ----------
  getSlideshow: () => raw(IPC.SLIDESHOW_GET),
  setSlideshow: (patch: Partial<SlideshowConfig>) => call(IPC.SLIDESHOW_SET, patch),
  slideshowNext: () => call(IPC.SLIDESHOW_NEXT),

  // ---------- 历史 ----------
  listHistory: () => raw(IPC.HISTORY_LIST),
  applyHistory: (historyId: string) => call(IPC.HISTORY_APPLY, { historyId }),
  clearHistory: () => raw(IPC.HISTORY_CLEAR),

  // ---------- 裁剪 ----------
  cropApply: (imageId: string, rect: CropRect, label?: string) =>
    call(IPC.CROP_APPLY, { imageId, rect, label }),

  // ---------- 拖拽导入辅助 ----------
  /** HTML File 对象 → 本地绝对路径（Electron 32+ File.path 已移除，须用 webUtils） */
  filePathOf: (file: File) => webUtils.getPathForFile(file),

  // ---------- MinIO 同步 ----------
  getSyncInfo: () => raw(IPC.SYNC_GET_CONFIG),
  setSyncConfig: (patch: Partial<SyncConfig>) => call(IPC.SYNC_SET_CONFIG, patch),
  setSyncSecret: (secretKey: string) => call(IPC.SYNC_SET_SECRET, { secretKey }),
  testSync: () => raw(IPC.SYNC_TEST),
  /** force = 用户已确认远端删除（#10 墓碑保险丝确认卡片） */
  syncNow: (force?: boolean) => call(IPC.SYNC_NOW, { force: force === true }),
  syncDownload: (scope: SyncDownloadScope) => call(IPC.SYNC_DOWNLOAD, scope),
  syncEnsureLocal: (imageId: string) => call(IPC.SYNC_ENSURE_LOCAL, { imageId }),
  syncCancelDownload: () => raw(IPC.SYNC_CANCEL_DOWNLOAD),
  syncHealthCheck: () => call(IPC.SYNC_HEALTH_CHECK),
  syncCleanOrphans: (keys: string[]) => call(IPC.SYNC_HEALTH_CLEAN_ORPHANS, { keys }),
  syncRepairBroken: (ids: string[]) => call(IPC.SYNC_HEALTH_REPAIR_BROKEN, { ids }),
  syncVerifyIntegrity: () => call(IPC.SYNC_VERIFY_INTEGRITY),
  syncDownloadEstimate: () => call(IPC.SYNC_DOWNLOAD_ESTIMATE),

  // ---------- 悬浮球 ----------
  bubbleMoveBy: (dx: number, dy: number) => {
    send(IPC.BUBBLE_MOVE_BY, Math.round(dx), Math.round(dy))
  },
  bubbleContextMenu: () => {
    send(IPC.BUBBLE_CONTEXT_MENU)
  },
  setBubbleEnabled: (enabled: boolean) => call(IPC.BUBBLE_SET_ENABLED, { enabled }),
  getBubbleCurrent: () => raw(IPC.BUBBLE_CURRENT),
  onBubbleUpdate: (cb: (payload: { imageId: string }) => void) =>
    subscribe(IPC_EVENTS.BUBBLE_UPDATE, cb),

  // ---------- 事件订阅（轮播推送） ----------
  onSlideshowTick: (cb: (payload: { entry: HistoryItem; manual: boolean }) => void) =>
    subscribe(IPC_EVENTS.SLIDESHOW_TICK, cb),
  onSlideshowChanged: (cb: (config: SlideshowConfig) => void) =>
    subscribe(IPC_EVENTS.SLIDESHOW_CHANGED, cb),

  // ---------- 事件订阅（同步进度） ----------
  onSyncProgress: (cb: (p: SyncProgress) => void) => subscribe(IPC_EVENTS.SYNC_PROGRESS, cb),
  onSyncDone: (cb: (r: { ok: boolean; stats?: SyncResultStats; error?: string }) => void) =>
    subscribe(IPC_EVENTS.SYNC_DONE, cb),
  onLibraryChanged: (cb: () => void) => subscribe(IPC_EVENTS.LIBRARY_CHANGED, () => cb())
}

contextBridge.exposeInMainWorld('api', api)

export type VividDeckApi = typeof api
