/**
 * IPC 通道注册（全部 invoke handler 集中于此，与 shared/ipc.ts 一一对应）
 */
import { app, BrowserWindow, dialog, ipcMain, nativeTheme, shell } from 'electron'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { IPC } from '@shared/ipc'
import type { CropRect, FillMode, ImageItem, SyncConfig, SyncDownloadScope } from '@shared/types'
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
import { customStorageDirMissing, dirSize, hasCustomStorageDir, setStorageDirPointer, storageRoot } from './services/paths'
import { getSyncConfig as getSyncCfg, updateSyncConfig, hasSecret as syncHasSecret, saveSecret } from './services/sync/store'
import { resetUploadCache } from './services/sync/engine'
import { cancelDownload, downloadScope, ensureLocal, getStatus as getSyncStatus, syncNow, testConnection } from './services/sync/engine'
import { cleanupOrphanObjects, estimateDownload, repairLocalBroken, runHealthCheck, verifyIntegrity } from './services/sync/health'
import { currentWallpaperImageId, setBubbleEnabled } from './bubble'
import { flushLibrary } from './services/library'
import { flushHistory } from './services/history'
import { flushSlideshow } from './services/slideshow'

/** 统一的错误包装：渲染层拿到 { ok, data } 而非异常堆栈 */
function wrap<A extends unknown[], R>(
  handler: (...args: A) => Promise<R> | R
): (event: Electron.IpcMainInvokeEvent, ...args: A) => Promise<{ ok: true; data: R } | { ok: false; error: string }> {
  return async (_event, ...args) => {
    try {
      return { ok: true, data: await handler(...args) }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error(`[ipc] 处理失败:`, message)
      return { ok: false, error: message }
    }
  }
}

export function registerIpcHandlers(): void {
  // ---------- 应用 ----------
  ipcMain.handle(IPC.APP_GET_STATE, () => ({
    settings: getSettings(),
    platform: process.platform,
    version: app.getVersion()
  }))

  ipcMain.handle(
    IPC.APP_SET_THEME,
    wrap((theme: 'system' | 'light' | 'dark') => {
      nativeTheme.themeSource = theme
      return updateSettings({ theme })
    })
  )

  ipcMain.handle(
    IPC.APP_SET_IMPORT_MODE,
    wrap((mode: 'copy' | 'reference') => updateSettings({ importMode: mode }))
  )

  ipcMain.handle(
    IPC.APP_SET_DEFAULT_FILL,
    wrap((mode: FillMode) => updateSettings({ defaultFillMode: mode }))
  )

  // 存储位置信息（当前根目录 / 是否自定义 / 占用大小）
  ipcMain.handle(
    IPC.APP_GET_STORAGE,
    wrap(async () => ({
      root: storageRoot(),
      custom: hasCustomStorageDir(),
      missing: customStorageDirMissing(),
      sizeBytes: await dirSize(storageRoot())
    }))
  )

  /**
   * 更换存储目录：弹目录选择框 → 整体复制全部数据到新位置 →
   * 写入自定义目录指针（userData 根下）+ 新位置自描述标记 → 通知渲染层 → 延迟自动重启生效。
   * （复制而非移动：迁移中断不会丢数据；重启成功后可手动删除旧目录）
   */
  ipcMain.handle(
    IPC.APP_CHANGE_STORAGE,
    wrap(async () => {
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
  )

  ipcMain.handle(IPC.APP_OPEN_USER_DATA, () => {
    void shell.openPath(app.getPath('userData'))
    return { ok: true }
  })

  ipcMain.handle(IPC.APP_QUIT, () => {
    ;(app as unknown as { __isQuitting?: boolean }).__isQuitting = true
    app.quit()
    return { ok: true }
  })

  // ---------- 素材库 ----------
  ipcMain.handle(
    IPC.DIALOG_PICK_IMPORT,
    wrap(async (mode: 'files' | 'folder') => {
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
        filters: [
          { name: '图片', extensions: ['jpg', 'jpeg', 'png', 'webp', 'heic', 'heif'] }
        ]
      })
      return res.canceled ? [] : res.filePaths
    })
  )

  ipcMain.handle(IPC.LIBRARY_IMPORT, wrap((payload: { paths: string[] }) => importPaths(payload.paths)))
  ipcMain.handle(IPC.LIBRARY_GET_ALL, () => getLibrary())
  ipcMain.handle(
    IPC.LIBRARY_RENAME_IMAGE,
    wrap((payload: { id: string; fileName: string }) => renameImage(payload.id, payload.fileName))
  )
  ipcMain.handle(
    IPC.LIBRARY_DELETE_IMAGE,
    wrap((payload: { id: string }) => deleteImage(payload.id))
  )
  ipcMain.handle(
    IPC.LIBRARY_UPDATE_IMAGE,
    wrap((payload: { id: string; patch: Partial<Pick<ImageItem, 'favorite' | 'categoryId' | 'tags'>> }) =>
      updateImage(payload.id, payload.patch)
    )
  )
  ipcMain.handle(
    IPC.LIBRARY_UPDATE_IMAGES,
    wrap((payload: { ids: string[]; patch: Partial<Pick<ImageItem, 'favorite' | 'categoryId' | 'tags'>> }) =>
      updateImages(payload.ids, payload.patch)
    )
  )
  ipcMain.handle(
    IPC.LIBRARY_DELETE_IMAGES,
    wrap((payload: { ids: string[]; mode?: 'all' | 'local' }) => deleteImages(payload.ids, payload.mode ?? 'all'))
  )
  ipcMain.handle(IPC.LIBRARY_RESTORE_IMAGES, wrap((payload: { ids: string[] }) => restoreImages(payload.ids)))
  ipcMain.handle(IPC.LIBRARY_APPLY_ENTRIES, wrap((payload: { entries: { id: string; patch: Pick<ImageItem, 'favorite' | 'categoryId' | 'tags'> }[] }) => applyEntries(payload.entries)))
  ipcMain.handle(
    IPC.LIBRARY_SET_TAGS_MANY,
    wrap((payload: { entries: { id: string; tags: string[] }[] }) => setTagsMany(payload.entries))
  )
  ipcMain.handle(IPC.LIBRARY_ADD_CATEGORY, wrap((payload: { name: string }) => addCategory(payload.name)))
  ipcMain.handle(IPC.LIBRARY_RENAME_CATEGORY, wrap((payload: { id: string; name: string }) => renameCategory(payload.id, payload.name)))
  ipcMain.handle(IPC.LIBRARY_DELETE_CATEGORY, wrap((payload: { id: string }) => deleteCategory(payload.id)))
  ipcMain.handle(
    IPC.LIBRARY_REORDER_CATEGORIES,
    wrap((payload: { ids: string[] }) => reorderCategories(payload.ids))
  )

  // ---------- 智能相册 ----------
  ipcMain.handle(IPC.ALBUM_ADD, wrap((payload: { name: string; rules: import('@shared/types').SmartAlbumRules }) => addAlbum(payload.name, payload.rules)))
  ipcMain.handle(IPC.ALBUM_UPDATE, wrap((payload: { id: string; patch: Partial<Pick<import('@shared/types').SmartAlbum, 'name' | 'rules'>> }) => updateAlbum(payload.id, payload.patch)))
  ipcMain.handle(IPC.ALBUM_DELETE, wrap((payload: { id: string }) => deleteAlbum(payload.id)))
  ipcMain.handle(IPC.ALBUM_COUNT, wrap((payload: { rules: import('@shared/types').SmartAlbumRules }) => countAlbum(payload.rules)))

  // ---------- 壁纸 ----------
  ipcMain.handle(IPC.WALLPAPER_LIST_MONITORS, wrap(() => listMonitors()))

  ipcMain.handle(
    IPC.WALLPAPER_APPLY,
    wrap(async (payload: { imageId: string; monitorIds: string[]; fillMode: FillMode }) => {
      const image = getLibrary().images.find((img) => img.id === payload.imageId)
      if (!image) throw new Error('图片不存在（可能已被删除）')
      // 云端图按需下载后再设置（本地已有文件则直接跳过）
      const filePath = image.localFile && fs.existsSync(image.path)
        ? image.path
        : await ensureLocal(payload.imageId)
      const result = await applyWallpaper(filePath, payload.monitorIds, payload.fillMode)
      // 设置成功 → 写入历史
      recordApply(image.id, result.applied, payload.fillMode)
      return result
    })
  )

  // ---------- MinIO 同步 ----------
  ipcMain.handle(IPC.SYNC_GET_CONFIG, () => ({
    config: getSyncCfg(),
    status: getSyncStatus(),
    secretSet: syncHasSecret()
  }))

  ipcMain.handle(
    IPC.SYNC_SET_CONFIG,
    wrap((patch: Partial<SyncConfig>) => {
      const before = getSyncCfg()
      const after = updateSyncConfig(patch)
      // 同步目标身份变化 → 清空上传缓存，避免旧桶的"已上传"标记导致新桶漏传
      const identity = (c: SyncConfig) => [c.endpoint, c.port, c.useSSL, c.bucket, c.accessKey].join('|')
      if (identity(before) !== identity(after)) {
        resetUploadCache()
        console.log('[sync] 同步目标已变更，上传缓存已重置')
      }
      return after
    })
  )

  ipcMain.handle(
    IPC.SYNC_SET_SECRET,
    wrap((payload: { secretKey: string }) => saveSecret(payload.secretKey))
  )

  ipcMain.handle(IPC.SYNC_TEST, () => testConnection())

  ipcMain.handle(IPC.SYNC_NOW, wrap(() => syncNow()))

  ipcMain.handle(
    IPC.SYNC_DOWNLOAD,
    wrap((scope: SyncDownloadScope) => downloadScope(scope))
  )

  ipcMain.handle(
    IPC.SYNC_ENSURE_LOCAL,
    wrap(async (payload: { imageId: string }) => ({ path: await ensureLocal(payload.imageId) }))
  )
  ipcMain.handle(IPC.SYNC_CANCEL_DOWNLOAD, () => {
    cancelDownload()
    return { ok: true }
  })
  ipcMain.handle(IPC.SYNC_HEALTH_CHECK, wrap(() => runHealthCheck()))
  ipcMain.handle(IPC.SYNC_HEALTH_CLEAN_ORPHANS, wrap((payload: { keys: string[] }) => cleanupOrphanObjects(payload.keys)))
  ipcMain.handle(IPC.SYNC_HEALTH_REPAIR_BROKEN, wrap((payload: { ids: string[] }) => repairLocalBroken(payload.ids)))
  ipcMain.handle(
    IPC.SYNC_VERIFY_INTEGRITY,
    wrap(() =>
      verifyIntegrity((current, total) => {
        for (const win of BrowserWindow.getAllWindows()) {
          win.webContents.send('sync:progress', { phase: 'finalizing', current, total, message: '校验文件完整性…' })
        }
      })
    )
  )
  ipcMain.handle(IPC.SYNC_DOWNLOAD_ESTIMATE, wrap(() => estimateDownload()))

  // ---------- 轮播 ----------
  ipcMain.handle(IPC.SLIDESHOW_GET, () => getSlideshowConfig())
  ipcMain.handle(IPC.SLIDESHOW_SET, wrap((patch: Parameters<typeof setSlideshowConfig>[0]) => setSlideshowConfig(patch)))
  ipcMain.handle(IPC.SLIDESHOW_NEXT, wrap(() => nextSlideshowNow()))

  // ---------- 悬浮球 ----------
  ipcMain.handle(
    IPC.BUBBLE_SET_ENABLED,
    wrap((payload: { enabled: boolean }) => {
      setBubbleEnabled(payload.enabled)
      return { enabled: payload.enabled }
    })
  )

  ipcMain.handle(IPC.BUBBLE_CURRENT, () => ({ imageId: currentWallpaperImageId() }))

  // ---------- 历史 ----------
  ipcMain.handle(IPC.HISTORY_LIST, () => listHistory())

  ipcMain.handle(
    IPC.HISTORY_APPLY,
    wrap(async (payload: { historyId: string }) => {
      const entry = listHistory().find((h) => h.id === payload.historyId)
      if (!entry) throw new Error('历史记录不存在')
      const image = getLibrary().images.find((img) => img.id === entry.imageId)
      if (!image) throw new Error('该壁纸的图片文件已不在素材库中')
      const result = await applyWallpaper(image.path, entry.monitorIds, entry.fillMode)
      recordApply(image.id, result.applied, entry.fillMode)
      return result
    })
  )

  ipcMain.handle(IPC.HISTORY_CLEAR, () => clearHistory())

  // ---------- 裁剪 ----------
  ipcMain.handle(
    IPC.CROP_APPLY,
    wrap((payload: { imageId: string; rect: CropRect; label?: string }) =>
      cropToNewImage(payload.imageId, payload.rect, payload.label ?? '')
    )
  )
}
