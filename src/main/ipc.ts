/**
 * IPC 通道注册（全部 invoke handler 集中于此，与 shared/ipc.ts 一一对应）
 * A2：参数/返回类型全部来自 @shared/ipcContract，与 preload 共享单一事实来源，
 * 两端漂移在 typecheck 阶段暴露，而非运行时。
 */
import { app, BrowserWindow, dialog, ipcMain, nativeTheme, shell } from 'electron'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { IPC, IPC_EVENTS } from '@shared/ipc'
import type {
  IpcEnvelope,
  IpcEnvelopeChannel,
  IpcRawChannel,
  IpcReq,
  IpcRes
} from '@shared/ipcContract'
import type { SyncConfig } from '@shared/types'
import {
  addCategory,
  cropToNewImage,
  deleteCategory,
  deleteImage,
  applyEntries,
  deleteImages,
  getLibrary,
  restoreImages,
  importPaths,
  renameCategory,
  renameImage,
  reorderCategories,
  addAlbum,
  countAlbum,
  deleteAlbum,
  setTagsMany,
  updateAlbum,
  updateImage,
  updateImages
} from './services/library'
import { applyWallpaper, listMonitors } from './services/wallpaper'
import { getSlideshowConfig, nextSlideshowNow, setSlideshowConfig } from './services/slideshow'
import { clearHistory, listHistory, recordApply } from './services/history'
import { flushSettings, getSettings, updateSettings } from './services/settings'
import {
  customStorageDirMissing,
  dirSize,
  hasCustomStorageDir,
  setStorageDirPointer,
  storageRoot
} from './services/paths'
import { cacheSize, cleanCache } from './services/cache'
import {
  getSyncConfig as getSyncCfg,
  updateSyncConfig,
  hasSecret as syncHasSecret,
  saveSecret
} from './services/sync/store'
import { resetUploadCache } from './services/sync/engine'
import {
  cancelDownload,
  downloadScope,
  ensureLocal,
  getStatus as getSyncStatus,
  syncNow,
  testConnection
} from './services/sync/engine'
import {
  cleanupOrphanObjects,
  estimateDownload,
  repairLocalBroken,
  runHealthCheck,
  verifyIntegrity
} from './services/sync/health'
import { currentWallpaperImageId, setBubbleEnabled } from './bubble'
import { flushLibrary } from './services/library'
import { flushHistory } from './services/history'
import { flushSlideshow } from './services/slideshow'

/**
 * envelope 通道注册：统一的错误包装，渲染层拿到 { ok, data } 而非异常堆栈。
 * 参数与返回类型由契约按通道推导（A2）。
 */
function handle<C extends IpcEnvelopeChannel>(
  channel: C,
  handler: (...args: IpcReq<C>) => Promise<IpcRes<C>> | IpcRes<C>
): void {
  ipcMain.handle(channel, async (_event, ...args: IpcReq<C>): Promise<IpcEnvelope<IpcRes<C>>> => {
    try {
      return { ok: true, data: await handler(...args) }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error(`[ipc] 处理失败:`, message)
      return { ok: false, error: message }
    }
  })
}

/** raw 通道注册：直接返回业务值（无 envelope 包装，preload 端不解包） */
function handleRaw<C extends IpcRawChannel>(
  channel: C,
  handler: (...args: IpcReq<C>) => Promise<IpcRes<C>> | IpcRes<C>
): void {
  ipcMain.handle(channel, (_event, ...args: IpcReq<C>) => handler(...args))
}

export function registerIpcHandlers(): void {
  // ---------- 应用 ----------
  handleRaw(IPC.APP_GET_STATE, () => ({
    settings: getSettings(),
    platform: process.platform,
    version: app.getVersion()
  }))

  handle(IPC.APP_SET_THEME, (theme) => {
    nativeTheme.themeSource = theme
    return updateSettings({ theme })
  })

  handle(IPC.APP_SET_IMPORT_MODE, (mode) => updateSettings({ importMode: mode }))

  handle(IPC.APP_SET_DEFAULT_FILL, (mode) => updateSettings({ defaultFillMode: mode }))

  // 存储位置信息（当前根目录 / 是否自定义 / 占用大小 / 缓存占用）
  handle(IPC.APP_GET_STORAGE, async () => ({
    root: storageRoot(),
    custom: hasCustomStorageDir(),
    missing: customStorageDirMissing(),
    sizeBytes: await dirSize(storageRoot()),
    cacheBytes: await cacheSize()
  }))

  // 缓存清理（#8）：孤儿缩略图/预览 + 预渲染缓存（可整体再生）
  handle(IPC.APP_CLEAN_CACHE, () => cleanCache())

  /**
   * 更换存储目录：弹目录选择框 → 整体复制全部数据到新位置 →
   * 写入自定义目录指针（userData 根下）+ 新位置自描述标记 → 通知渲染层 → 延迟自动重启生效。
   * （复制而非移动：迁移中断不会丢数据；重启成功后可手动删除旧目录）
   */
  handle(IPC.APP_CHANGE_STORAGE, async () => {
    const res = await dialog.showOpenDialog({
      title: '选择新的存储位置',
      message: '将把全部素材与数据迁移到该位置（外置磁盘请先挂载）',
      properties: ['openDirectory', 'createDirectory']
    })
    if (res.canceled || !res.filePaths[0]) return { canceled: true }

    let target = res.filePaths[0]
    // 选中的目录非空时，自动使用其下的 vividDeck 子目录，避免混入其他文件
    if (fs.readdirSync(target).length > 0) {
      target = path.join(target, 'vividDeck')
      if (fs.existsSync(target)) {
        throw new Error('所选位置已存在 vividDeck 目录，请换一个位置')
      }
    }

    const source = storageRoot()
    if (path.resolve(source) === path.resolve(target)) {
      throw new Error('新位置与当前存储位置相同')
    }

    // 1) 全部落盘，保证复制到新位置的是最新数据
    flushLibrary()
    flushHistory()
    flushSlideshow()
    flushSettings()

    // 2) 整体复制（跨卷亦可；大素材库耗时较长，由渲染层展示迁移中状态）
    await fsp.cp(source, target, { recursive: true, force: true })

    // 3) 写入自定义目录标记：
    //    a) userData 根下的指针文件 —— 启动引导的权威来源（旧实现只写新位置
    //       settings.json，启动时从默认根读取永远读不到，重启后仍用旧目录）
    //    b) 新位置 settings.json 的 storageDir 字段 —— 自描述，便于排查
    setStorageDirPointer(target)
    const settingsFile = path.join(target, 'data', 'settings.json')
    const data = JSON.parse(await fsp.readFile(settingsFile, 'utf-8')) as Record<string, unknown>
    data.storageDir = target
    await fsp.writeFile(settingsFile, JSON.stringify(data, null, 2), 'utf-8')

    // 4) 给渲染层 1.5s 展示"迁移完成"，随后自动重启生效
    setTimeout(() => {
      app.relaunch()
      app.exit(0)
    }, 1500)

    return { canceled: false, root: target }
  })

  handleRaw(IPC.APP_OPEN_USER_DATA, () => {
    void shell.openPath(app.getPath('userData'))
    return { ok: true }
  })

  handleRaw(IPC.APP_QUIT, () => {
    ;(app as unknown as { __isQuitting?: boolean }).__isQuitting = true
    app.quit()
    return { ok: true }
  })

  // ---------- 素材库 ----------
  handle(IPC.DIALOG_PICK_IMPORT, async (mode) => {
    if (mode === 'folder') {
      const res = await dialog.showOpenDialog({
        title: '选择要导入的文件夹',
        properties: ['openDirectory']
      })
      return res.canceled ? [] : res.filePaths
    }
    const res = await dialog.showOpenDialog({
      title: '选择要导入的图片',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: '图片', extensions: ['jpg', 'jpeg', 'png', 'webp', 'heic', 'heif'] }]
    })
    return res.canceled ? [] : res.filePaths
  })

  handle(IPC.LIBRARY_IMPORT, (payload) => importPaths(payload.paths))
  handleRaw(IPC.LIBRARY_GET_ALL, () => getLibrary())
  handle(IPC.LIBRARY_RENAME_IMAGE, (payload) => renameImage(payload.id, payload.fileName))
  handle(IPC.LIBRARY_DELETE_IMAGE, (payload) => deleteImage(payload.id))
  handle(IPC.LIBRARY_UPDATE_IMAGE, (payload) => updateImage(payload.id, payload.patch))
  handle(IPC.LIBRARY_UPDATE_IMAGES, (payload) => updateImages(payload.ids, payload.patch))
  handle(IPC.LIBRARY_DELETE_IMAGES, (payload) => deleteImages(payload.ids, payload.mode ?? 'all'))
  handle(IPC.LIBRARY_RESTORE_IMAGES, (payload) => restoreImages(payload.ids))
  handle(IPC.LIBRARY_APPLY_ENTRIES, (payload) => applyEntries(payload.entries))
  handle(IPC.LIBRARY_SET_TAGS_MANY, (payload) => setTagsMany(payload.entries))
  handle(IPC.LIBRARY_ADD_CATEGORY, (payload) => addCategory(payload.name))
  handle(IPC.LIBRARY_RENAME_CATEGORY, (payload) => renameCategory(payload.id, payload.name))
  handle(IPC.LIBRARY_DELETE_CATEGORY, (payload) => deleteCategory(payload.id))
  handle(IPC.LIBRARY_REORDER_CATEGORIES, (payload) => reorderCategories(payload.ids))

  // ---------- 智能相册 ----------
  handle(IPC.ALBUM_ADD, (payload) => addAlbum(payload.name, payload.rules))
  handle(IPC.ALBUM_UPDATE, (payload) => updateAlbum(payload.id, payload.patch))
  handle(IPC.ALBUM_DELETE, (payload) => deleteAlbum(payload.id))
  handle(IPC.ALBUM_COUNT, (payload) => countAlbum(payload.rules))

  // ---------- 壁纸 ----------
  handle(IPC.WALLPAPER_LIST_MONITORS, () => listMonitors())

  handle(IPC.WALLPAPER_APPLY, async (payload) => {
    const image = getLibrary().images.find((img) => img.id === payload.imageId)
    if (!image) throw new Error('图片不存在（可能已被删除）')
    // 云端图按需下载后再设置（本地已有文件则直接跳过）
    const filePath =
      image.localFile && fs.existsSync(image.path) ? image.path : await ensureLocal(payload.imageId)
    const result = await applyWallpaper(filePath, payload.monitorIds, payload.fillMode)
    // 设置成功 → 写入历史
    recordApply(image.id, result.applied, payload.fillMode)
    return result
  })

  // ---------- MinIO 同步 ----------
  handleRaw(IPC.SYNC_GET_CONFIG, () => ({
    config: getSyncCfg(),
    status: getSyncStatus(),
    secretSet: syncHasSecret()
  }))

  handle(IPC.SYNC_SET_CONFIG, (patch) => {
    const before = getSyncCfg()
    const after = updateSyncConfig(patch)
    // 同步目标身份变化 → 清空上传缓存，避免旧桶的"已上传"标记导致新桶漏传
    const identity = (c: SyncConfig) =>
      [c.endpoint, c.port, c.useSSL, c.bucket, c.accessKey].join('|')
    if (identity(before) !== identity(after)) {
      resetUploadCache()
      console.log('[sync] 同步目标已变更，上传缓存已重置')
    }
    return after
  })

  handle(IPC.SYNC_SET_SECRET, (payload) => saveSecret(payload.secretKey))

  handleRaw(IPC.SYNC_TEST, () => testConnection())

  // #10：force=true 表示用户已在墓碑保险丝确认卡片上确认远端删除
  handle(IPC.SYNC_NOW, (payload) => syncNow(payload?.force === true ? { force: true } : undefined))

  handle(IPC.SYNC_DOWNLOAD, (scope) => downloadScope(scope))

  handle(IPC.SYNC_ENSURE_LOCAL, async (payload) => ({ path: await ensureLocal(payload.imageId) }))
  handleRaw(IPC.SYNC_CANCEL_DOWNLOAD, () => {
    cancelDownload()
    return { ok: true }
  })
  handle(IPC.SYNC_HEALTH_CHECK, () => runHealthCheck())
  handle(IPC.SYNC_HEALTH_CLEAN_ORPHANS, (payload) => cleanupOrphanObjects(payload.keys))
  handle(IPC.SYNC_HEALTH_REPAIR_BROKEN, (payload) => repairLocalBroken(payload.ids))
  handle(IPC.SYNC_VERIFY_INTEGRITY, () =>
    verifyIntegrity((current, total) => {
      for (const win of BrowserWindow.getAllWindows()) {
        win.webContents.send(IPC_EVENTS.SYNC_PROGRESS, {
          phase: 'finalizing',
          current,
          total,
          message: '校验文件完整性…'
        })
      }
    })
  )
  handle(IPC.SYNC_DOWNLOAD_ESTIMATE, () => estimateDownload())

  // ---------- 轮播 ----------
  handleRaw(IPC.SLIDESHOW_GET, () => getSlideshowConfig())
  handle(IPC.SLIDESHOW_SET, (patch) => setSlideshowConfig(patch))
  handle(IPC.SLIDESHOW_NEXT, () => nextSlideshowNow())

  // ---------- 悬浮球 ----------
  handle(IPC.BUBBLE_SET_ENABLED, (payload) => {
    setBubbleEnabled(payload.enabled)
    return { enabled: payload.enabled }
  })

  handleRaw(IPC.BUBBLE_CURRENT, () => ({ imageId: currentWallpaperImageId() }))

  // ---------- 历史 ----------
  handleRaw(IPC.HISTORY_LIST, () => listHistory())

  handle(IPC.HISTORY_APPLY, async (payload) => {
    const entry = listHistory().find((h) => h.id === payload.historyId)
    if (!entry) throw new Error('历史记录不存在')
    const image = getLibrary().images.find((img) => img.id === entry.imageId)
    if (!image) throw new Error('该壁纸的图片文件已不在素材库中')
    const result = await applyWallpaper(image.path, entry.monitorIds, entry.fillMode)
    recordApply(image.id, result.applied, entry.fillMode)
    return result
  })

  handleRaw(IPC.HISTORY_CLEAR, () => clearHistory())

  // ---------- 裁剪 ----------
  handle(IPC.CROP_APPLY, (payload) =>
    cropToNewImage(payload.imageId, payload.rect, payload.label ?? '')
  )
}
