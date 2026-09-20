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
  /** 批量选择模式 */
  selectionMode: boolean
  /** 选中的图片 ID 集合（选择模式下） */
  selectedIds: string[]
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
  setSelectionMode: (on: boolean) => void
  toggleSelected: (id: string) => void
  setSelectedIds: (ids: string[]) => void
  clearSelection: () => void
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
  selectionMode: false,
  selectedIds: [],
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
  setSelectionMode: (on) => set({ selectionMode: on, ...(on ? {} : { selectedIds: [] }) }),
  toggleSelected: (id) =>
    set((s) => ({
      selectedIds: s.selectedIds.includes(id) ? s.selectedIds.filter((x) => x !== id) : [...s.selectedIds, id]
    })),
  setSelectedIds: (ids) => set({ selectedIds: ids }),
  clearSelection: () => set({ selectedIds: [] }),
  toast: (message, type = 'success') => {
    const id = toastSeq++
    set({ toasts: [...get().toasts, { id, message, type }] })
    // 3 秒后自动消失
    setTimeout(() => get().dismissToast(id), 3000)
  },
  dismissToast: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
  setDarkMode: (dark) => set({ darkMode: dark })
}))
