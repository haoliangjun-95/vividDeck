/**
 * 应用外壳：布局组装、主题跟随系统、窗口级拖放导入、轮播事件监听
 */
import React, { useEffect, useState } from 'react'
import { Sidebar } from './components/Sidebar'
import { Toolbar } from './components/Toolbar'
import { GalleryGrid } from './components/GalleryGrid'
import { Lightbox } from './components/Lightbox'
import { SetWallpaperDialog } from './components/SetWallpaperDialog'
import { CropModal } from './components/CropModal'
import { CategoryManager } from './components/CategoryManager'
import { SlideshowPanel } from './components/SlideshowPanel'
import { HistoryPanel } from './components/HistoryPanel'
import { SettingsPanel } from './components/SettingsPanel'
import { Drawer, ToastHost } from './components/ui'
import { useLibraryStore } from './store/library'
import { useUIStore } from './store/ui'

export default function App(): JSX.Element {
  const load = useLibraryStore((s) => s.load)
  const loaded = useLibraryStore((s) => s.loaded)
  const importPaths = useLibraryStore((s) => s.importFiles)
  const toast = useUIStore((s) => s.toast)
  const drawer = useUIStore((s) => s.drawer)
  const closeDrawer = useUIStore((s) => s.closeDrawer)
  const [dragOver, setDragOver] = useState(false)

  // 初始加载素材库
  useEffect(() => {
    void load()
  }, [load])

  // 主题跟随：nativeTheme.themeSource 变化 → prefers-color-scheme → html.dark
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = (): void => {
      document.documentElement.classList.toggle('dark', mq.matches)
      useUIStore.getState().setDarkMode(mq.matches)
    }
    apply()
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [])

  // 轮播事件：托盘/定时切换后提示
  useEffect(() => {
    const off = window.api.onSlideshowTick(({ entry, manual }) => {
      void load()
      const name = useLibraryStore.getState().images.find((img) => img.id === entry.imageId)?.fileName
      if (!manual && name) toast(`轮播已切换：${name}`, 'info')
    })
    return off
  }, [load, toast])

  // 窗口级拖放导入（任意位置）
  useEffect(() => {
    const onDragOver = (e: DragEvent): void => {
      // 仅响应文件拖入（忽略内部卡片拖拽）
      if (e.dataTransfer?.types.includes('Files')) {
        e.preventDefault()
        setDragOver(true)
      }
    }
    const onDragLeave = (): void => setDragOver(false)
    const onDrop = (e: DragEvent): void => {
      setDragOver(false)
      if (!e.dataTransfer?.files.length) return
      e.preventDefault()
      const paths = Array.from(e.dataTransfer.files).map((f) => window.api.filePathOf(f))
      if (paths.length === 0) return
      void importPaths(paths).then((r) => {
        if (r.added > 0) toast(`拖入导入 ${r.added} 张图片`)
      })
    }
    window.addEventListener('dragover', onDragOver)
    window.addEventListener('dragleave', onDragLeave)
    window.addEventListener('drop', onDrop)
    return () => {
      window.removeEventListener('dragover', onDragOver)
      window.removeEventListener('dragleave', onDragLeave)
      window.removeEventListener('drop', onDrop)
    }
  }, [importPaths, toast])

  return (
    <div className="flex h-full">
      <Sidebar />
      <main className="flex min-w-0 flex-1 flex-col">
        <Toolbar />
        {loaded ? (
          <GalleryGrid />
        ) : (
          <div className="flex flex-1 items-center justify-center text-sm text-neutral-400">正在加载素材库…</div>
        )}
      </main>

      {/* 抽屉 */}
      {drawer === 'slideshow' && (
        <Drawer title="轮播计划" onClose={closeDrawer}>
          <SlideshowPanel />
        </Drawer>
      )}
      {drawer === 'history' && (
        <Drawer title="壁纸历史" onClose={closeDrawer}>
          <HistoryPanel />
        </Drawer>
      )}
      {drawer === 'settings' && (
        <Drawer title="设置" onClose={closeDrawer}>
          <SettingsPanel />
        </Drawer>
      )}

      {/* 弹窗层 */}
      <Lightbox />
      <SetWallpaperDialog />
      <CropModal />
      <CategoryManager />
      <ToastHost />

      {/* 全窗口拖放遮罩 */}
      {dragOver && (
        <div className="pointer-events-none fixed inset-0 z-[70] flex items-center justify-center border-4 border-dashed border-indigo-500 bg-indigo-500/10">
          <div className="rounded-xl bg-white/90 px-6 py-4 text-sm font-medium text-indigo-700 shadow-xl dark:bg-neutral-900/90 dark:text-indigo-300">
            松开鼠标，导入图片 / 文件夹
          </div>
        </div>
      )}
    </div>
  )
}
