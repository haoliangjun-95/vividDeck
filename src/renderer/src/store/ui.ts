/**
 * UI 状态：抽屉 / 弹窗 / 轻提示，以及主题跟随
 */
import { create } from 'zustand'

export type DrawerKey = 'slideshow' | 'history' | 'settings' | null
export interface Toast {
  id: number
  message: string
  type: 'success' | 'error' | 'info'
}

interface UIState {
  drawer: DrawerKey
  /** 灯箱正在查看的图片 ID */
  lightboxImageId: string | null
  /** 正在设置壁纸的图片 ID */
  wallpaperImageId: string | null
  /** 正在裁剪的图片 ID */
  cropImageId: string | null
  categoryManagerOpen: boolean
  toasts: Toast[]
  /** 主题：'light' | 'dark' 实际生效值（跟随系统计算后） */
  darkMode: boolean

  openDrawer: (drawer: DrawerKey) => void
  closeDrawer: () => void
  openLightbox: (id: string) => void
  closeLightbox: () => void
  openWallpaperDialog: (id: string) => void
  closeWallpaperDialog: () => void
  openCrop: (id: string) => void
  closeCrop: () => void
  setCategoryManagerOpen: (open: boolean) => void
  toast: (message: string, type?: Toast['type']) => void
  dismissToast: (id: number) => void
  setDarkMode: (dark: boolean) => void
}

let toastSeq = 1

export const useUIStore = create<UIState>((set, get) => ({
  drawer: null,
  lightboxImageId: null,
  wallpaperImageId: null,
  cropImageId: null,
  categoryManagerOpen: false,
  toasts: [],
  darkMode: window.matchMedia('(prefers-color-scheme: dark)').matches,

  openDrawer: (drawer) => set({ drawer }),
  closeDrawer: () => set({ drawer: null }),
  openLightbox: (id) => set({ lightboxImageId: id }),
  closeLightbox: () => set({ lightboxImageId: null }),
  openWallpaperDialog: (id) => set({ wallpaperImageId: id }),
  closeWallpaperDialog: () => set({ wallpaperImageId: null }),
  openCrop: (id) => set({ cropImageId: id }),
  closeCrop: () => set({ cropImageId: null }),
  setCategoryManagerOpen: (open) => set({ categoryManagerOpen: open }),
  toast: (message, type = 'success') => {
    const id = toastSeq++
    set({ toasts: [...get().toasts, { id, message, type }] })
    // 3 秒后自动消失
    setTimeout(() => get().dismissToast(id), 3000)
  },
  dismissToast: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
  setDarkMode: (dark) => set({ darkMode: dark })
}))
