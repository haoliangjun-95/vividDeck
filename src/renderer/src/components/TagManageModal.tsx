/**
 * 标签管理弹窗：重命名 / 合并到（侧栏标签右键入口）
 * 全库替换与智能相册规则改写在主进程完成（shared/tagOps）；此处负责
 * 输入校验、筛选引用跟随（改名/合并后画廊筛选不指向已消失的标签）与结果提示。
 */
import { useState } from 'react'
import { ArrowRight, Check } from 'lucide-react'
import { normalizeTagName } from '@shared/tagOps'
import { useLibraryStore } from '../store/library'
import { useUIStore } from '../store/ui'
import { Modal } from './ui'

export function TagManageModal({
  mode,
  tag,
  onClose
}: {
  mode: 'rename' | 'merge'
  tag: string
  onClose: () => void
}) {
  const tags = useLibraryStore((s) => s.tags)
  const filter = useLibraryStore((s) => s.filter)
  const setFilter = useLibraryStore((s) => s.setFilter)
  const renameTag = useLibraryStore((s) => s.renameTag)
  const mergeTags = useLibraryStore((s) => s.mergeTags)
  const toast = useUIStore((s) => s.toast)
  const [name, setName] = useState(tag)
  const [busy, setBusy] = useState(false)
  /** 合并模式：勾选要并入 tag 的源标签 */
  const [picked, setPicked] = useState<string[]>([])

  const others = tags.filter((t) => t !== tag)
  const validName = normalizeTagName(name)
  const renameReady = validName !== null && validName !== tag

  const doRename = async (): Promise<void> => {
    if (!renameReady || busy) return
    setBusy(true)
    try {
      const to = validName
      const n = await renameTag(tag, to)
      // 筛选引用跟随改名（旧名已不存在）
      if (filter.tags.includes(tag)) {
        setFilter({ tags: filter.tags.map((t) => (t === tag ? to : t)) })
      }
      toast(`已重命名「${tag}」→「${to}」（${n} 张图片，智能相册规则已同步）`)
      onClose()
    } catch (err) {
      toast(`重命名失败：${err instanceof Error ? err.message : String(err)}`, 'error')
    } finally {
      setBusy(false)
    }
  }

  const doMerge = async (): Promise<void> => {
    if (picked.length === 0 || busy) return
    setBusy(true)
    try {
      const n = await mergeTags(picked, tag)
      // 筛选清理：源标签移除（目标已在则不重复加入）
      if (filter.tags.some((t) => picked.includes(t))) {
        setFilter({
          tags: Array.from(
            new Set(
              filter.tags
                .filter((t) => !picked.includes(t))
                .concat(filter.tags.includes(tag) ? [] : [tag])
            )
          )
        })
      }
      toast(`已把 ${picked.length} 个标签合并进「${tag}」（${n} 张图片，智能相册规则已同步）`)
      onClose()
    } catch (err) {
      toast(`合并失败：${err instanceof Error ? err.message : String(err)}`, 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      title={mode === 'rename' ? `重命名标签「${tag}」` : `合并标签到「${tag}」`}
      onClose={onClose}
      width="max-w-md"
    >
      {mode === 'rename' ? (
        <div className="space-y-3">
          <input
            className="field w-full"
            value={name}
            autoFocus
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void doRename()
            }}
            placeholder="新标签名（≤50 字符）"
          />
          <p className="text-xs text-neutral-400">
            全库图片与所有智能相册规则（标签交集/并集）同步替换；不影响图片本身。
          </p>
          <div className="flex justify-end gap-2 border-t border-neutral-200 pt-3 dark:border-neutral-800">
            <button className="btn-ghost" onClick={onClose}>
              取消
            </button>
            <button
              className="btn-primary"
              disabled={!renameReady || busy}
              onClick={() => void doRename()}
            >
              重命名
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {others.length === 0 ? (
            <p className="text-xs text-neutral-400">没有其他标签可合并。</p>
          ) : (
            <div className="flex max-h-48 flex-wrap gap-1.5 overflow-y-auto">
              {others.map((t) => {
                const active = picked.includes(t)
                return (
                  <button
                    key={t}
                    className={`rounded-full px-2 py-0.5 text-xs transition-colors ${
                      active
                        ? 'bg-indigo-600 text-white'
                        : 'bg-neutral-100 text-neutral-600 hover:bg-indigo-100 hover:text-indigo-700 dark:bg-neutral-800 dark:text-neutral-300'
                    }`}
                    onClick={() =>
                      setPicked(active ? picked.filter((p) => p !== t) : [...picked, t])
                    }
                  >
                    {active ? '✓ ' : '+ '}
                    {t}
                  </button>
                )
              })}
            </div>
          )}
          <p className="text-xs text-neutral-400">
            勾选的标签将全部并入「{tag}」（同名去重），图片与智能相册规则同步改写。
          </p>
          <div className="flex items-center justify-between border-t border-neutral-200 pt-3 dark:border-neutral-800">
            <span className="flex items-center gap-1 text-xs text-neutral-400">
              {picked.length > 0 && (
                <>
                  {picked.slice(0, 3).join('、')}
                  {picked.length > 3 ? ` 等 ${picked.length} 个` : ''}
                  <ArrowRight size={12} />
                  {tag}
                </>
              )}
            </span>
            <div className="flex gap-2">
              <button className="btn-ghost" onClick={onClose}>
                取消
              </button>
              <button
                className="btn-primary"
                disabled={picked.length === 0 || busy}
                onClick={() => void doMerge()}
              >
                <Check size={14} />
                合并 {picked.length > 0 ? `${picked.length} 个` : ''}
              </button>
            </div>
          </div>
        </div>
      )}
    </Modal>
  )
}
