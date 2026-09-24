/**
 * preload 桥：以 contextBridge 暴露类型安全的 window.api
 * - 全部走 ipcRenderer.invoke（请求-响应），无任意 channel 透传
 * - 订阅类事件（轮播推送）单独暴露 on/off 方法
 */
import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { IPC, IPC_EVENTS } from '@shared/ipc'
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
  SyncConfig,
  SyncDownloadScope,
  SyncProgress,
  SyncResultStats,
  SyncStatus
} from '@shared/types'

/** 统一响应结构 */
type Res<T> = { ok: true; data: T } | { ok: false; error: string }

async function call<T>(channel: string, ...args: unknown[]): Promise<T> {
  const res = (await ipcRenderer.invoke(channel, ...args)) as Res<T>
  if (!res.ok) throw new Error(res.error)
  return res.data
}

const api = {
  // ---------- 应用 ----------
  getState: async (): Promise<{ settings: AppSettings; platform: string; version: string }> =>
    ipcRenderer.invoke(IPC.APP_GET_STATE),
  setTheme: (theme: AppSettings['theme']) => call<AppSettings>(IPC.APP_SET_THEME, theme),
  setImportMode: (mode: AppSettings['importMode']) =>
    call<AppSettings>(IPC.APP_SET_IMPORT_MODE, mode),
  setDefaultFillMode: (mode: AppSettings['defaultFillMode']) =>
    call<AppSettings>(IPC.APP_SET_DEFAULT_FILL, mode),
  getStorageInfo: () =>
    call<{
      root: string
      custom: boolean
      missing: boolean
      sizeBytes: number
      cacheBytes: number
    }>(IPC.APP_GET_STORAGE),
  /** 缓存清理（#8）：孤儿缩略图/预览 + 预渲染缓存；cacheBytes 为清理后剩余占用 */
  cleanCache: () =>
    call<{ removed: number; freedBytes: number; cacheBytes: number }>(IPC.APP_CLEAN_CACHE),
  changeStorageDir: () => call<{ canceled: boolean; root?: string }>(IPC.APP_CHANGE_STORAGE),
  openUserData: () => ipcRenderer.invoke(IPC.APP_OPEN_USER_DATA),
  quit: () => ipcRenderer.invoke(IPC.APP_QUIT),

  // ---------- 素材库 ----------
  pickImport: (mode: 'files' | 'folder') => call<string[]>(IPC.DIALOG_PICK_IMPORT, mode),
  importPaths: (paths: string[]) => call<ImportResult>(IPC.LIBRARY_IMPORT, { paths }),
  getLibrary: () => ipcRenderer.invoke(IPC.LIBRARY_GET_ALL) as Promise<LibraryData>,
  renameImage: (id: string, fileName: string) =>
    call<LibraryData>(IPC.LIBRARY_RENAME_IMAGE, { id, fileName }),
  deleteImage: (id: string) => call<LibraryData>(IPC.LIBRARY_DELETE_IMAGE, { id }),
  updateImage: (id: string, patch: Partial<Pick<ImageItem, 'favorite' | 'categoryId' | 'tags'>>) =>
    call<LibraryData>(IPC.LIBRARY_UPDATE_IMAGE, { id, patch }),
  updateImages: (
    ids: string[],
    patch: Partial<Pick<ImageItem, 'favorite' | 'categoryId' | 'tags'>>
  ) => call<LibraryData>(IPC.LIBRARY_UPDATE_IMAGES, { ids, patch }),
  deleteImages: (ids: string[], mode?: 'all' | 'local') =>
    call<LibraryData>(IPC.LIBRARY_DELETE_IMAGES, { ids, mode }),
  restoreImages: (ids: string[]) => call<{ restored: number }>(IPC.LIBRARY_RESTORE_IMAGES, { ids }),
  applyEntries: (
    entries: { id: string; patch: Partial<Pick<ImageItem, 'favorite' | 'categoryId' | 'tags'>> }[]
  ) => call<LibraryData>(IPC.LIBRARY_APPLY_ENTRIES, { entries }),
  setTagsMany: (entries: { id: string; tags: string[] }[]) =>
    call<LibraryData>(IPC.LIBRARY_SET_TAGS_MANY, { entries }),
  addCategory: (name: string) => call<LibraryData>(IPC.LIBRARY_ADD_CATEGORY, { name }),
  renameCategory: (id: string, name: string) =>
    call<LibraryData>(IPC.LIBRARY_RENAME_CATEGORY, { id, name }),
  deleteCategory: (id: string) => call<LibraryData>(IPC.LIBRARY_DELETE_CATEGORY, { id }),
  reorderCategories: (ids: string[]) => call<LibraryData>(IPC.LIBRARY_REORDER_CATEGORIES, { ids }),
  addAlbum: (name: string, rules: import('@shared/types').SmartAlbumRules) =>
    call<LibraryData>(IPC.ALBUM_ADD, { name, rules }),
  updateAlbum: (
    id: string,
    patch: Partial<Pick<import('@shared/types').SmartAlbum, 'name' | 'rules'>>
  ) => call<LibraryData>(IPC.ALBUM_UPDATE, { id, patch }),
  deleteAlbum: (id: string) => call<LibraryData>(IPC.ALBUM_DELETE, { id }),
  countAlbum: (rules: import('@shared/types').SmartAlbumRules) =>
    call<number>(IPC.ALBUM_COUNT, { rules }),

  // ---------- 壁纸 ----------
  listMonitors: () => call<MonitorInfo[]>(IPC.WALLPAPER_LIST_MONITORS),
  applyWallpaper: (imageId: string, monitorIds: string[], fillMode: FillMode) =>
    call<{ applied: string[] }>(IPC.WALLPAPER_APPLY, { imageId, monitorIds, fillMode }),

  // ---------- 轮播 ----------
  getSlideshow: () => ipcRenderer.invoke(IPC.SLIDESHOW_GET) as Promise<SlideshowConfig>,
  setSlideshow: (patch: Partial<SlideshowConfig>) =>
    call<SlideshowConfig>(IPC.SLIDESHOW_SET, patch),
  slideshowNext: () => call<void>(IPC.SLIDESHOW_NEXT),

  // ---------- 历史 ----------
  listHistory: () => ipcRenderer.invoke(IPC.HISTORY_LIST) as Promise<HistoryItem[]>,
  applyHistory: (historyId: string) =>
    call<{ applied: string[] }>(IPC.HISTORY_APPLY, { historyId }),
  clearHistory: () => ipcRenderer.invoke(IPC.HISTORY_CLEAR) as Promise<HistoryItem[]>,

  // ---------- 裁剪 ----------
  cropApply: (imageId: string, rect: CropRect, label?: string) =>
    call<ImageItem>(IPC.CROP_APPLY, { imageId, rect, label }),

  // ---------- 拖拽导入辅助 ----------
  /** HTML File 对象 → 本地绝对路径（Electron 32+ File.path 已移除，须用 webUtils） */
  filePathOf: (file: File) => webUtils.getPathForFile(file),

  // ---------- MinIO 同步 ----------
  getSyncInfo: () =>
    ipcRenderer.invoke(IPC.SYNC_GET_CONFIG) as Promise<{
      config: SyncConfig
      status: SyncStatus
      secretSet: boolean
    }>,
  setSyncConfig: (patch: Partial<SyncConfig>) => call<SyncConfig>(IPC.SYNC_SET_CONFIG, patch),
  setSyncSecret: (secretKey: string) =>
    call<{ encrypted: boolean }>(IPC.SYNC_SET_SECRET, { secretKey }),
  testSync: () =>
    ipcRenderer.invoke(IPC.SYNC_TEST) as Promise<{
      ok: boolean
      bucketCreated?: boolean
      error?: string
    }>,
  syncNow: () => call<SyncResultStats>(IPC.SYNC_NOW),
  syncDownload: (scope: SyncDownloadScope) =>
    call<{ downloaded: number; failed: number; cancelled?: boolean }>(IPC.SYNC_DOWNLOAD, scope),
  syncEnsureLocal: (imageId: string) => call<{ path: string }>(IPC.SYNC_ENSURE_LOCAL, { imageId }),
  syncCancelDownload: () =>
    ipcRenderer.invoke(IPC.SYNC_CANCEL_DOWNLOAD) as Promise<{ ok: boolean }>,
  syncHealthCheck: () => call<import('@shared/types').SyncHealthReport>(IPC.SYNC_HEALTH_CHECK),
  syncCleanOrphans: (keys: string[]) => call<number>(IPC.SYNC_HEALTH_CLEAN_ORPHANS, { keys }),
  syncRepairBroken: (ids: string[]) => call<number>(IPC.SYNC_HEALTH_REPAIR_BROKEN, { ids }),
  syncVerifyIntegrity: () => call<{ id: string; fileName: string }[]>(IPC.SYNC_VERIFY_INTEGRITY),
  syncDownloadEstimate: () =>
    call<{ count: number; sizeBytes: number }>(IPC.SYNC_DOWNLOAD_ESTIMATE),

  // ---------- 悬浮球 ----------
  bubbleMoveBy: (dx: number, dy: number) => {
    ipcRenderer.send(IPC.BUBBLE_MOVE_BY, Math.round(dx), Math.round(dy))
  },
  bubbleContextMenu: () => {
    ipcRenderer.send(IPC.BUBBLE_CONTEXT_MENU)
  },
  setBubbleEnabled: (enabled: boolean) =>
    call<{ enabled: boolean }>(IPC.BUBBLE_SET_ENABLED, { enabled }),
  getBubbleCurrent: () =>
    ipcRenderer.invoke(IPC.BUBBLE_CURRENT) as Promise<{ imageId: string | null }>,
  onBubbleUpdate: (cb: (payload: { imageId: string }) => void) => {
    const listener = (_e: Electron.IpcRendererEvent, payload: { imageId: string }): void =>
      cb(payload)
    ipcRenderer.on(IPC_EVENTS.BUBBLE_UPDATE, listener)
    return () => {
      ipcRenderer.removeListener(IPC_EVENTS.BUBBLE_UPDATE, listener)
    }
  },

  // ---------- 事件订阅（轮播推送） ----------
  onSlideshowTick: (cb: (payload: { entry: HistoryItem; manual: boolean }) => void) => {
    const listener = (
      _e: Electron.IpcRendererEvent,
      payload: { entry: HistoryItem; manual: boolean }
    ): void => cb(payload)
    ipcRenderer.on(IPC_EVENTS.SLIDESHOW_TICK, listener)
    return () => {
      ipcRenderer.removeListener(IPC_EVENTS.SLIDESHOW_TICK, listener)
    }
  },
  onSlideshowChanged: (cb: (config: SlideshowConfig) => void) => {
    const listener = (_e: Electron.IpcRendererEvent, config: SlideshowConfig): void => cb(config)
    ipcRenderer.on(IPC_EVENTS.SLIDESHOW_CHANGED, listener)
    return () => {
      ipcRenderer.removeListener(IPC_EVENTS.SLIDESHOW_CHANGED, listener)
    }
  },

  // ---------- 事件订阅（同步进度） ----------
  onSyncProgress: (cb: (p: SyncProgress) => void) => {
    const listener = (_e: Electron.IpcRendererEvent, p: SyncProgress): void => cb(p)
    ipcRenderer.on(IPC_EVENTS.SYNC_PROGRESS, listener)
    return () => {
      ipcRenderer.removeListener(IPC_EVENTS.SYNC_PROGRESS, listener)
    }
  },
  onSyncDone: (cb: (r: { ok: boolean; stats?: SyncResultStats; error?: string }) => void) => {
    const listener = (
      _e: Electron.IpcRendererEvent,
      r: { ok: boolean; stats?: SyncResultStats; error?: string }
    ): void => cb(r)
    ipcRenderer.on(IPC_EVENTS.SYNC_DONE, listener)
    return () => {
      ipcRenderer.removeListener(IPC_EVENTS.SYNC_DONE, listener)
    }
  },
  onLibraryChanged: (cb: () => void) => {
    const listener = (): void => cb()
    ipcRenderer.on(IPC_EVENTS.LIBRARY_CHANGED, listener)
    return () => {
      ipcRenderer.removeListener(IPC_EVENTS.LIBRARY_CHANGED, listener)
    }
  }
}

contextBridge.exposeInMainWorld('api', api)

export type VividDeckApi = typeof api
