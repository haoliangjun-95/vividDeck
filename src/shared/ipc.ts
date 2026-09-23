/**
 * IPC 通道名与载荷类型定义（主进程 handler 与 preload 封装一一对应）
 */

export const IPC = {
  // 应用
  APP_GET_STATE: 'app:getState',
  APP_SET_THEME: 'app:setTheme',
  APP_SET_IMPORT_MODE: 'app:setImportMode',
  APP_SET_DEFAULT_FILL: 'app:setDefaultFillMode', // { mode: FillMode } -> AppSettings
  APP_GET_STORAGE: 'app:getStorageInfo', // -> { root, custom, sizeBytes }
  APP_CHANGE_STORAGE: 'app:changeStorageDir', // 弹选目录并整体迁移，成功后自动重启
  APP_OPEN_USER_DATA: 'app:openUserData',
  APP_QUIT: 'app:quit',

  // 素材库
  DIALOG_PICK_IMPORT: 'dialog:pickImport', // { mode: 'files' | 'folder' } -> string[] | null
  LIBRARY_IMPORT: 'library:import', // { paths: string[] } -> ImportResult
  LIBRARY_GET_ALL: 'library:getAll', // -> LibraryData
  LIBRARY_RENAME_IMAGE: 'library:renameImage', // { id, fileName } -> LibraryData
  LIBRARY_DELETE_IMAGE: 'library:deleteImage', // { id } -> LibraryData
  LIBRARY_UPDATE_IMAGE: 'library:updateImage', // { id, patch } -> LibraryData
  LIBRARY_UPDATE_IMAGES: 'library:updateImages', // { ids, patch } -> LibraryData（批量）
  LIBRARY_DELETE_IMAGES: 'library:deleteImages', // { ids, mode? } -> LibraryData（批量；all=墓碑同步 / local=仅本地）
  LIBRARY_RESTORE_IMAGES: 'library:restoreImages', // { ids } -> { restored }（撤销删除）
  LIBRARY_APPLY_ENTRIES: 'library:applyEntries', // { entries } -> LibraryData（按图恢复属性，撤销逆操作）
  LIBRARY_SET_TAGS_MANY: 'library:setTagsMany', // { entries: {id, tags}[] } -> LibraryData（批量按图标签）
  LIBRARY_ADD_CATEGORY: 'library:addCategory', // { name } -> LibraryData
  LIBRARY_RENAME_CATEGORY: 'library:renameCategory', // { id, name } -> LibraryData
  LIBRARY_DELETE_CATEGORY: 'library:deleteCategory', // { id } -> LibraryData
  LIBRARY_REORDER_CATEGORIES: 'library:reorderCategories', // { ids } -> LibraryData（拖拽排序）
  ALBUM_ADD: 'album:add', // { name, rules } -> LibraryData
  ALBUM_UPDATE: 'album:update', // { id, patch } -> LibraryData
  ALBUM_DELETE: 'album:delete', // { id } -> LibraryData
  ALBUM_COUNT: 'album:count', // { rules } -> number（编辑器实时预览）

  // 壁纸
  WALLPAPER_LIST_MONITORS: 'wallpaper:listMonitors', // -> MonitorInfo[]
  WALLPAPER_APPLY: 'wallpaper:apply', // { imageId, monitorIds, fillMode } -> { ok, error?, applied: string[] }

  // 轮播
  SLIDESHOW_GET: 'slideshow:get', // -> SlideshowConfig
  SLIDESHOW_SET: 'slideshow:set', // SlideshowConfig(部分) -> SlideshowConfig
  SLIDESHOW_NEXT: 'slideshow:next', // -> void（手动触发下一张）

  // ---------- 二期：MinIO 同步 ----------
  SYNC_GET_CONFIG: 'sync:getConfig', // -> { config, status, secretSet }
  SYNC_SET_CONFIG: 'sync:setConfig', // Partial<SyncConfig> -> SyncConfig
  SYNC_SET_SECRET: 'sync:setSecret', // { secretKey } -> { ok }
  SYNC_TEST: 'sync:test', // -> { ok, bucketCreated, error? }
  SYNC_NOW: 'sync:now', // -> SyncResultStats
  SYNC_DOWNLOAD: 'sync:download', // SyncDownloadScope -> { downloaded, failed }
  SYNC_ENSURE_LOCAL: 'sync:ensureLocal', // { imageId } -> { path }（按需下载单张）
  SYNC_CANCEL_DOWNLOAD: 'sync:cancelDownload', // 取消进行中的批量下载
  SYNC_HEALTH_CHECK: 'sync:healthCheck', // -> SyncHealthReport
  SYNC_HEALTH_CLEAN_ORPHANS: 'sync:cleanOrphans', // { keys } -> { cleaned }
  SYNC_HEALTH_REPAIR_BROKEN: 'sync:repairBroken', // { ids } -> { fixed }
  SYNC_VERIFY_INTEGRITY: 'sync:verifyIntegrity', // -> { id, fileName }[]（进度走 SYNC_PROGRESS）
  SYNC_DOWNLOAD_ESTIMATE: 'sync:downloadEstimate', // -> { count, sizeBytes }

  // ---------- 悬浮球 ----------
  BUBBLE_MOVE_BY: 'bubble:moveBy', // (dx, dy) 拖动位移（on 消息，高频）
  BUBBLE_CONTEXT_MENU: 'bubble:contextMenu', // 弹出右键菜单（on 消息）
  BUBBLE_SET_ENABLED: 'bubble:setEnabled', // { enabled } -> { enabled }
  BUBBLE_CURRENT: 'bubble:current', // -> { imageId | null }

  // 历史
  HISTORY_LIST: 'history:list', // -> HistoryItem[]
  HISTORY_APPLY: 'history:apply', // { historyId } -> { ok, error? }
  HISTORY_CLEAR: 'history:clear', // -> HistoryItem[]

  // 裁剪
  CROP_APPLY: 'crop:apply', // { imageId, rect } -> { image: ImageItem } | { error }
} as const

/** 主进程主动推送到渲染层的事件 */
export const IPC_EVENTS = {
  /** 轮播切换了壁纸（携带历史记录） */
  SLIDESHOW_TICK: 'slideshow:tick',
  /** 轮播配置变化（暂停/恢复等） */
  SLIDESHOW_CHANGED: 'slideshow:changed',
  /** 同步进度（阶段/当前/总数/说明） */
  SYNC_PROGRESS: 'sync:progress',
  /** 同步结束（成功或失败） */
  SYNC_DONE: 'sync:done',
  /** 同步导致素材库数据变化（渲染层刷新） */
  LIBRARY_CHANGED: 'library:changed',
  /** 当前壁纸变化（悬浮球刷新缩略图） */
  BUBBLE_UPDATE: 'bubble:update'
} as const
