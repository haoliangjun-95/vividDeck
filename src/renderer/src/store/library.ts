/**
 * 素材库状态：数据 + 筛选 + 排序 + 全部业务动作（渲染层唯一数据源）
 */
import { create } from 'zustand'
import type { Category, ImageItem, ImportResult, LibraryData, LibraryFilter, SmartAlbum, SmartAlbumRules } from '@shared/types'
import { matchAlbum } from '@shared/album'

export type SortKey = 'added-desc' | 'added-asc' | 'name-asc' | 'size-desc'

interface LibraryState {
  images: ImageItem[]
  categories: Category[]
  tags: string[]
  albums: SmartAlbum[]
  loaded: boolean
  /** 导入进行中（界面显示加载态） */
  importing: boolean
  filter: LibraryFilter
  sort: SortKey

  load: () => Promise<void>
  applyData: (data: LibraryData) => void
  importFiles: (paths: string[]) => Promise<ImportResult>
  toggleFavorite: (id: string) => Promise<void>
  assignCategory: (id: string, categoryId: string | null) => Promise<void>
  setTags: (id: string, tags: string[]) => Promise<void>
  rename: (id: string, fileName: string) => Promise<void>
  remove: (id: string) => Promise<void>
  /** 批量：设置分类（null = 移出分类） */
  assignCategoryMany: (ids: string[], categoryId: string | null) => Promise<void>
  /** 批量：删除（废纸篓 + 墓碑同步传播） */
  removeMany: (ids: string[]) => Promise<void>
  /** 批量：按图设置标签（增/删混合，单次事务） */
  setTagsMany: (entries: { id: string; tags: string[] }[]) => Promise<void>
  addAlbum: (name: string, rules: SmartAlbumRules) => Promise<void>
  updateAlbum: (id: string, patch: Partial<Pick<SmartAlbum, 'name' | 'rules'>>) => Promise<void>
  deleteAlbum: (id: string) => Promise<void>
  addCategory: (name: string) => Promise<void>
  renameCategory: (id: string, name: string) => Promise<void>
  reorderCategories: (ids: string[]) => Promise<void>
  deleteCategory: (id: string) => Promise<void>
  setFilter: (patch: Partial<LibraryFilter>) => void
  setSort: (sort: SortKey) => void
}

const DEFAULT_FILTER: LibraryFilter = {
  keyword: '',
  categoryId: 'all',
  tags: [],
  albumId: null,
  minWidth: 0,
  minSizeMB: 0,
  maxSizeMB: 0
}

export const useLibraryStore = create<LibraryState>((set, get) => ({
  images: [],
  categories: [],
  tags: [],
  albums: [],
  loaded: false,
  importing: false,
  filter: DEFAULT_FILTER,
  sort: 'added-desc',

  load: async () => {
    const data = await window.api.getLibrary()
    get().applyData(data)
    set({ loaded: true })
  },

  applyData: (data) =>
    set({ images: data.images, categories: data.categories, tags: data.tags, albums: data.albums ?? [] }),

  importFiles: async (paths) => {
    set({ importing: true })
    try {
      const result = await window.api.importPaths(paths)
      await get().load()
      return result
    } finally {
      set({ importing: false })
    }
  },

  toggleFavorite: async (id) => {
    const image = get().images.find((img) => img.id === id)
    if (!image) return
    const data = await window.api.updateImage(id, { favorite: !image.favorite })
    get().applyData(data)
  },

  assignCategory: async (id, categoryId) => {
    const data = await window.api.updateImage(id, { categoryId })
    get().applyData(data)
  },

  setTags: async (id, tags) => {
    const data = await window.api.updateImage(id, { tags })
    get().applyData(data)
  },

  rename: async (id, fileName) => {
    const data = await window.api.renameImage(id, fileName)
    get().applyData(data)
  },

  remove: async (id) => {
    const data = await window.api.deleteImage(id)
    get().applyData(data)
  },

  assignCategoryMany: async (ids, categoryId) => {
    const data = await window.api.updateImages(ids, { categoryId })
    get().applyData(data)
  },

  removeMany: async (ids) => {
    const data = await window.api.deleteImages(ids)
    get().applyData(data)
  },

  setTagsMany: async (entries) => {
    const data = await window.api.setTagsMany(entries)
    get().applyData(data)
  },

  addAlbum: async (name, rules) => {
    const data = await window.api.addAlbum(name, rules)
    get().applyData(data)
  },

  updateAlbum: async (id, patch) => {
    const data = await window.api.updateAlbum(id, patch)
    get().applyData(data)
  },

  deleteAlbum: async (id) => {
    const data = await window.api.deleteAlbum(id)
    get().applyData(data)
  },

  addCategory: async (name) => {
    const data = await window.api.addCategory(name)
    get().applyData(data)
  },

  renameCategory: async (id, name) => {
    const data = await window.api.renameCategory(id, name)
    get().applyData(data)
  },

  reorderCategories: async (ids) => {
    const data = await window.api.reorderCategories(ids)
    get().applyData(data)
  },

  deleteCategory: async (id) => {
    const data = await window.api.deleteCategory(id)
    get().applyData(data)
  },

  setFilter: (patch) => set({ filter: { ...get().filter, ...patch } }),
  setSort: (sort) => set({ sort })
}))

/** 应用筛选 + 排序后的图片列表（组件内用 useMemo 调用） */
export function selectFilteredImages(state: LibraryState): ImageItem[] {
  const { images, filter, sort } = state
  const kw = filter.keyword.trim().toLowerCase()
  const album = state.albums.find((a) => a.id === filter.albumId)

  const filtered = images.filter((img) => {
    // 智能相册规则（与其他条件 AND 叠加）
    if (album && !matchAlbum(img, album)) return false
    if (filter.categoryId === 'favorites') {
      if (!img.favorite) return false
    } else if (filter.categoryId === 'uncategorized') {
      if (img.categoryId !== null) return false
    } else if (filter.categoryId !== 'all') {
      if (img.categoryId !== filter.categoryId) return false
    }
    // 多选标签：任一命中即显示
    if (filter.tags.length > 0 && !filter.tags.some((t) => img.tags.includes(t))) return false
    if (filter.minWidth > 0 && img.width < filter.minWidth) return false
    if (filter.minSizeMB > 0 && img.sizeBytes < filter.minSizeMB * 1024 * 1024) return false
    if (filter.maxSizeMB > 0 && img.sizeBytes > filter.maxSizeMB * 1024 * 1024) return false
    if (kw && !img.fileName.toLowerCase().includes(kw)) return false
    return true
  })

  const sorted = [...filtered]
  switch (sort) {
    case 'added-asc':
      sorted.sort((a, b) => a.addedAt - b.addedAt)
      break
    case 'name-asc':
      sorted.sort((a, b) => a.fileName.localeCompare(b.fileName, 'zh-CN'))
      break
    case 'size-desc':
      sorted.sort((a, b) => b.sizeBytes - a.sizeBytes)
      break
    default:
      sorted.sort((a, b) => b.addedAt - a.addedAt)
  }
  return sorted
}
