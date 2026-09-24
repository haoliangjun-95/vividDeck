/**
 * 智能相册编辑器：规则表单（标签交集/并集、横竖图、宽高比、分类、收藏、最小宽度）
 * + 实时匹配计数预览。创建/编辑共用。
 */
import React, { useEffect, useState } from 'react'
import { Sparkles, Trash2 } from 'lucide-react'
import { Modal } from './ui'
import { useLibraryStore } from '../store/library'
import { useUIStore } from '../store/ui'
import type { SmartAlbum, SmartAlbumRules } from '@shared/types'

const ASPECT_PRESETS = [
  { label: '16:9 横屏', min: 1.6, max: 1.95 },
  { label: '16:10', min: 1.5, max: 1.66 },
  { label: '4:3', min: 1.24, max: 1.4 },
  { label: '1:1 方图', min: 0.95, max: 1.05 },
  { label: '9:16 竖屏', min: 0.51, max: 0.63 },
  { label: '超宽 ≥2.2', min: 2.2, max: undefined }
]

export function AlbumEditorModal({
  editing,
  initialRules,
  onClose
}: {
  editing?: SmartAlbum
  /** 「存为相册」入口传入的当前筛选转规则起点 */
  initialRules?: SmartAlbumRules
  onClose: () => void
}): JSX.Element {
  const tags = useLibraryStore((s) => s.tags)
  const categories = useLibraryStore((s) => s.categories)
  const addAlbum = useLibraryStore((s) => s.addAlbum)
  const updateAlbum = useLibraryStore((s) => s.updateAlbum)
  const deleteAlbum = useLibraryStore((s) => s.deleteAlbum)
  const toast = useUIStore((s) => s.toast)
  const setFilter = useLibraryStore((s) => s.setFilter)

  const [name, setName] = useState(editing?.name ?? '')
  const [rules, setRules] = useState<SmartAlbumRules>(editing?.rules ?? initialRules ?? {})
  const [count, setCount] = useState<number | null>(null)
  // 标签匹配模式：any=任一命中（并集）/ all=全部命中（交集）；初值取自已编辑相册或入口规则
  const [tagMode, setTagMode] = useState<'all' | 'any'>(
    (editing?.rules ?? initialRules ?? {}).tagsAll?.length ? 'all' : 'any'
  )

  // 实时匹配计数（防抖 400ms）
  useEffect(() => {
    const t = setTimeout(() => {
      void window.api
        .countAlbum(rules)
        .then(setCount)
        .catch(() => setCount(null))
    }, 400)
    return () => clearTimeout(t)
  }, [rules])

  const patch = (p: Partial<SmartAlbumRules>): void => setRules((r) => ({ ...r, ...p }))

  const toggleIn = (list: string[] | undefined, v: string): string[] => {
    const cur = list ?? []
    return cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v]
  }

  // 切换交集/并集：把已选标签迁移到目标字段并清空另一字段，避免语义漂移
  const switchTagMode = (mode: 'all' | 'any'): void => {
    setTagMode(mode)
    setRules((r) =>
      mode === 'all'
        ? { ...r, tagsAll: r.tagsAny ?? [], tagsAny: undefined }
        : { ...r, tagsAny: r.tagsAll ?? [], tagsAll: undefined }
    )
  }

  const save = async (): Promise<void> => {
    if (!name.trim()) return
    try {
      if (editing) {
        await updateAlbum(editing.id, { name: name.trim(), rules })
      } else {
        // 创建后自动选中该相册，画廊立即过滤到新相册内容
        const newId = await addAlbum(name.trim(), rules)
        setFilter({ albumId: newId })
      }
      toast(editing ? '相册已更新' : `已创建智能相册「${name.trim()}」`)
      onClose()
    } catch (err) {
      toast(`保存失败：${err instanceof Error ? err.message : String(err)}`, 'error')
    }
  }

  const chip = (active: boolean): string =>
    `rounded-full px-2 py-0.5 text-xs transition-colors ${
      active
        ? 'bg-indigo-600 text-white'
        : 'bg-neutral-100 text-neutral-600 hover:bg-indigo-100 hover:text-indigo-700 dark:bg-neutral-800 dark:text-neutral-300'
    }`

  return (
    <Modal title={editing ? '编辑智能相册' : '新建智能相册'} onClose={onClose} width="max-w-lg">
      <div className="space-y-4">
        <label className="block text-xs">
          <span className="mb-1 block text-neutral-400">相册名称</span>
          <input
            className="field w-full"
            value={name}
            autoFocus
            placeholder="如：横屏风景大片"
            onChange={(e) => setName(e.target.value)}
          />
        </label>

        {tags.length > 0 && (
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-xs font-medium">
                标签（{tagMode === 'all' ? '全部命中' : '任一命中'}）
              </span>
              <div className="flex gap-1">
                <button
                  type="button"
                  className={chip(tagMode === 'any')}
                  onClick={() => switchTagMode('any')}
                >
                  任一
                </button>
                <button
                  type="button"
                  className={chip(tagMode === 'all')}
                  onClick={() => switchTagMode('all')}
                >
                  全部
                </button>
              </div>
            </div>
            <div className="flex max-h-20 flex-wrap gap-1.5 overflow-y-auto">
              {tags.map((t) => {
                const active = tagMode === 'all' ? rules.tagsAll : rules.tagsAny
                return (
                  <button
                    key={t}
                    className={chip((active ?? []).includes(t))}
                    onClick={() =>
                      patch(
                        tagMode === 'all'
                          ? { tagsAll: toggleIn(rules.tagsAll, t) }
                          : { tagsAny: toggleIn(rules.tagsAny, t) }
                      )
                    }
                  >
                    #{t}
                  </button>
                )
              })}
            </div>
          </div>
        )}

        <div>
          <div className="mb-1.5 text-xs font-medium">方向与比例</div>
          <div className="flex flex-wrap gap-1.5">
            <button
              className={chip(rules.orientation === 'landscape')}
              onClick={() =>
                patch({ orientation: rules.orientation === 'landscape' ? undefined : 'landscape' })
              }
            >
              横图
            </button>
            <button
              className={chip(rules.orientation === 'portrait')}
              onClick={() =>
                patch({ orientation: rules.orientation === 'portrait' ? undefined : 'portrait' })
              }
            >
              竖图
            </button>
            {ASPECT_PRESETS.map((p) => {
              const active = rules.minAspect === p.min && rules.maxAspect === p.max
              return (
                <button
                  key={p.label}
                  className={chip(active)}
                  onClick={() =>
                    patch(
                      active
                        ? { minAspect: undefined, maxAspect: undefined }
                        : { minAspect: p.min, maxAspect: p.max }
                    )
                  }
                >
                  {p.label}
                </button>
              )
            })}
          </div>
        </div>

        <div>
          <div className="mb-1.5 text-xs font-medium">分类（任一命中）</div>
          <div className="flex flex-wrap gap-1.5">
            {categories.map((c) => (
              <button
                key={c.id}
                className={chip((rules.categoryIds ?? []).includes(c.id))}
                onClick={() => patch({ categoryIds: toggleIn(rules.categoryIds, c.id) })}
              >
                {c.name}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3 text-xs">
          <label className="flex items-center gap-1.5">
            <input
              type="checkbox"
              className="h-3.5 w-3.5 accent-indigo-600"
              checked={rules.favoriteOnly ?? false}
              onChange={(e) => patch({ favoriteOnly: e.target.checked || undefined })}
            />
            仅收藏
          </label>
          <label className="flex items-center gap-1.5">
            最小宽度
            <select
              className="field !py-1"
              value={rules.minWidth ?? 0}
              onChange={(e) => patch({ minWidth: Number(e.target.value) || undefined })}
            >
              <option value={0}>不限</option>
              <option value={1920}>1080P</option>
              <option value={2560}>2K</option>
              <option value={3840}>4K</option>
            </select>
          </label>
        </div>

        <div className="flex items-center justify-between border-t border-neutral-200 pt-3 dark:border-neutral-800">
          <span className="text-xs text-neutral-400">
            {count === null ? '计算中…' : `当前规则匹配 ${count} 张图片`}
          </span>
          <div className="flex gap-2">
            {editing && (
              <button
                className="btn-danger"
                onClick={() => {
                  if (!confirm(`删除智能相册「${editing.name}」？（不影响图片本身）`)) return
                  void deleteAlbum(editing.id).then(() => {
                    setFilter({ albumId: null })
                    toast('相册已删除', 'info')
                    onClose()
                  })
                }}
              >
                <Trash2 size={14} />
                删除
              </button>
            )}
            <button className="btn-ghost" onClick={onClose}>
              取消
            </button>
            <button className="btn-primary" disabled={!name.trim()} onClick={() => void save()}>
              <Sparkles size={14} />
              {editing ? '保存' : '创建'}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  )
}
