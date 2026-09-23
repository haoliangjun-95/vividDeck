/**
 * 工具栏：导入图片/文件夹、关键词搜索、分辨率与文件大小筛选、排序
 */
import React, { useEffect, useRef, useState } from 'react'
import { FilePlus2, FolderPlus, ListChecks, Loader2, Search } from 'lucide-react'
import { useLibraryStore, selectFilteredImages, type SortKey } from '../store/library'
import { useUIStore } from '../store/ui'

const MIN_WIDTH_OPTIONS = [
  { value: 0, label: '分辨率不限' },
  { value: 1920, label: '≥ 1080P' },
  { value: 2560, label: '≥ 2K' },
  { value: 3840, label: '≥ 4K' }
]

const SIZE_OPTIONS = [
  { min: 0, max: 0, label: '大小不限' },
  { min: 0, max: 1, label: '< 1MB' },
  { min: 1, max: 5, label: '1 ~ 5MB' },
  { min: 5, max: 20, label: '5 ~ 20MB' },
  { min: 20, max: 0, label: '> 20MB' }
]

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: 'added-desc', label: '最新添加' },
  { value: 'added-asc', label: '最早添加' },
  { value: 'name-asc', label: '文件名' },
  { value: 'size-desc', label: '文件最大' }
]

export function Toolbar(): JSX.Element {
  const filter = useLibraryStore((s) => s.filter)
  const setFilter = useLibraryStore((s) => s.setFilter)
  const sort = useLibraryStore((s) => s.sort)
  const setSort = useLibraryStore((s) => s.setSort)
  const importing = useLibraryStore((s) => s.importing)
  const importFiles = useLibraryStore((s) => s.importFiles)
  const total = useLibraryStore(selectFilteredImages).length
  const totalCount = useLibraryStore((s) => s.images.length)
  const toast = useUIStore((s) => s.toast)
  const selectionMode = useUIStore((s) => s.selectionMode)
  const setSelectionMode = useUIStore((s) => s.setSelectionMode)

  // 搜索防抖：本地输入即时回显，250ms 后才提交到 store 触发全量过滤
  const [keyword, setKeyword] = useState(filter.keyword)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      if (keyword !== filter.keyword) setFilter({ keyword })
    }, 250)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keyword])

  const doImport = async (mode: 'files' | 'folder'): Promise<void> => {
    try {
      const paths = await window.api.pickImport(mode)
      if (paths.length === 0) return
      const result = await importFiles(paths)
      if (result.added > 0) toast(`成功导入 ${result.added} 张图片`)
      if (result.skipped > 0) toast(`${result.skipped} 张跳过（重复或无法解析）`, 'info')
    } catch (err) {
      toast(`导入失败：${err instanceof Error ? err.message : String(err)}`, 'error')
    }
  }

  const sizeValue = `${filter.minSizeMB}-${filter.maxSizeMB}`

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-neutral-200 px-4 py-2.5 dark:border-neutral-800">
      <button className="btn-primary" disabled={importing} onClick={() => void doImport('files')}>
        {importing ? <Loader2 size={15} className="animate-spin" /> : <FilePlus2 size={15} />}
        导入图片
      </button>
      <button className="btn-ghost border border-neutral-300 dark:border-neutral-700" disabled={importing} onClick={() => void doImport('folder')}>
        <FolderPlus size={15} />
        导入文件夹
      </button>

      {/* 批量选择开关（选择模式下高亮，Esc 退出） */}
      <button
        className={`${selectionMode ? 'btn bg-indigo-600 text-white hover:bg-indigo-500' : 'btn-ghost border border-neutral-300 dark:border-neutral-700'}`}
        onClick={() => setSelectionMode(!selectionMode)}
        title={selectionMode ? '退出批量选择（Esc）' : '批量选中后可设置分类 / 删除'}
      >
        <ListChecks size={15} />
        {selectionMode ? '退出选择' : '批量选择'}
      </button>

      <div className="relative ml-auto">
        <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-neutral-400" />
        <input
          className="field w-56 !pl-7"
          placeholder="搜索文件名…"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
        />
      </div>

      <select
        className="field"
        value={filter.minWidth}
        onChange={(e) => setFilter({ minWidth: Number(e.target.value) })}
        title="按分辨率筛选"
      >
        {MIN_WIDTH_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>

      <select
        className="field"
        value={sizeValue}
        onChange={(e) => {
          const [min, max] = e.target.value.split('-').map(Number)
          setFilter({ minSizeMB: min, maxSizeMB: max })
        }}
        title="按文件大小筛选"
      >
        {SIZE_OPTIONS.map((o) => (
          <option key={o.label} value={`${o.min}-${o.max}`}>
            {o.label}
          </option>
        ))}
      </select>

      <select className="field" value={sort} onChange={(e) => setSort(e.target.value as SortKey)} title="排序">
        {SORT_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>

      <span className="w-20 text-right text-xs tabular-nums text-neutral-400">
        {total} / {totalCount}
      </span>
    </div>
  )
}
