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
  LIBRARY_ADD_CATEGORY: 'library:addCategory', // { name } -> LibraryData
  LIBRARY_RENAME_CATEGORY: 'library:renameCategory', // { id, name } -> LibraryData
  LIBRARY_DELETE_CATEGORY: 'library:deleteCategory', // { id } -> LibraryData

  // 壁纸
  WALLPAPER_LIST_MONITORS: 'wallpaper:listMonitors', // -> MonitorInfo[]
  WALLPAPER_APPLY: 'wallpaper:apply', // { imageId, monitorIds, fillMode } -> { ok, error?, applied: string[] }

  // 轮播
  SLIDESHOW_GET: 'slideshow:get', // -> SlideshowConfig
  SLIDESHOW_SET: 'slideshow:set', // SlideshowConfig(部分) -> SlideshowConfig
  SLIDESHOW_NEXT: 'slideshow:next', // -> void（手动触发下一张）

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
  SLIDESHOW_CHANGED: 'slideshow:changed'
} as const
