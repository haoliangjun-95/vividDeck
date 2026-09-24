/**
 * MinIO 多设备同步面板（设置页）
 * 连接配置（密钥加密存储）/ 测试连接 / 启用与自动同步 / 状态与进度 / 批量下载
 */
import React, { useEffect, useState } from 'react'
import { CloudDownload, CloudUpload, HardDriveDownload, Loader2, RefreshCw } from 'lucide-react'
import { useUIStore } from '../store/ui'
import { useLibraryStore } from '../store/library'
import { formatTime } from '../lib/utils'
import type { SyncConfig, SyncHealthReport, SyncProgress, SyncStatus } from '@shared/types'
import { formatBytes } from '../lib/utils'

const PHASE_LABELS: Record<SyncProgress['phase'], string> = {
  connecting: '连接服务…',
  merging: '合并云端数据…',
  uploading: '上传图片…',
  downloading: '下载缩略图…',
  finalizing: '收尾…'
}

export function SyncSection(): JSX.Element | null {
  const toast = useUIStore((s) => s.toast)
  const [config, setConfig] = useState<SyncConfig | null>(null)
  const [status, setStatus] = useState<SyncStatus | null>(null)
  const [secretSet, setSecretSet] = useState(false)
  const [secret, setSecret] = useState('')
  const [testing, setTesting] = useState(false)
  const [progress, setProgress] = useState<SyncProgress | null>(null)
  const [busyDownload, setBusyDownload] = useState(false)
  /** 配置加载失败信息（IPC 异常时展示错误态而非静默消失） */
  const [loadError, setLoadError] = useState<string | null>(null)

  const reload = (): void => {
    window.api
      .getSyncInfo()
      .then((info) => {
        setConfig(info.config)
        setStatus(info.status)
        setSecretSet(info.secretSet)
        setLoadError(null)
      })
      .catch((err: unknown) => setLoadError(err instanceof Error ? err.message : String(err)))
  }

  useEffect(() => {
    reload()
    const offProgress = window.api.onSyncProgress(setProgress)
    const offDone = window.api.onSyncDone((r) => {
      setProgress(null)
      reload()
      if (r.ok && r.stats) {
        const s = r.stats
        toast(
          `同步完成：拉取 ${s.pulled} 条，上传 ${s.uploaded} 张，耗时 ${(s.durationMs / 1000).toFixed(1)}s`
        )
      } else if (!r.ok) {
        toast(`同步失败：${r.error}`, 'error')
      }
    })
    return () => {
      offProgress()
      offDone()
    }
  }, [toast])

  if (!config) {
    // 加载失败时给出可读错误态（此前静默返回 null，整个同步区消失无从排查）
    if (!loadError) return null
    return (
      <section className="space-y-2">
        <div className="flex items-center gap-1.5 font-medium">
          <CloudUpload size={14} />
          多设备同步（MinIO）
        </div>
        <div className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-600 dark:bg-red-950/50 dark:text-red-400">
          同步配置加载失败：{loadError}
          <button className="ml-2 underline hover:no-underline" onClick={reload}>
            重试
          </button>
        </div>
      </section>
    )
  }

  const patch = async (p: Partial<SyncConfig>): Promise<void> => {
    setConfig(await window.api.setSyncConfig(p))
    reload()
  }

  const saveAndTest = async (): Promise<void> => {
    setTesting(true)
    try {
      if (secret.trim()) {
        const r = await window.api.setSyncSecret(secret.trim())
        setSecretSet(true)
        setSecret('')
        if (!r.encrypted) toast('注意：当前系统不支持加密存储，密钥以仅本机可读的方式保存', 'info')
      }
      const result = await window.api.testSync()
      if (result.ok) {
        toast(result.bucketCreated ? '连接成功，已自动创建 bucket' : '连接成功')
      } else {
        toast(`连接失败：${result.error}`, 'error')
      }
    } catch (err) {
      toast(`保存失败：${err instanceof Error ? err.message : String(err)}`, 'error')
    } finally {
      setTesting(false)
    }
  }

  const doSync = async (): Promise<void> => {
    try {
      await window.api.syncNow()
    } catch (err) {
      toast(`同步失败：${err instanceof Error ? err.message : String(err)}`, 'error')
    }
  }

  const doDownload = async (
    type: 'all' | 'favorite' | 'category',
    categoryId?: string
  ): Promise<void> => {
    setBusyDownload(true)
    try {
      const r = await window.api.syncDownload({ type, categoryId })
      toast(
        r.failed > 0
          ? `下载完成 ${r.downloaded} 张，失败 ${r.failed} 张`
          : `已下载 ${r.downloaded} 张到本地`
      )
    } catch (err) {
      toast(`下载失败：${err instanceof Error ? err.message : String(err)}`, 'error')
    } finally {
      setBusyDownload(false)
    }
  }

  const running = status?.running ?? false

  return (
    <section className="space-y-3">
      <div className="flex items-center gap-1.5 font-medium">
        <CloudUpload size={14} />
        多设备同步（MinIO）
        {status?.enabled && (
          <span className="rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-normal text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
            已启用
          </span>
        )}
      </div>

      {/* 连接配置 */}
      <div className="card space-y-2.5 p-3">
        <div className="grid grid-cols-3 gap-2">
          <label className="col-span-2 text-xs">
            <span className="mb-1 block text-neutral-400">服务地址（域名或 IP）</span>
            <input
              className="field w-full"
              placeholder="minio.example.com 或 192.168.1.10"
              value={config.endpoint}
              onChange={(e) => setConfig({ ...config, endpoint: e.target.value.trim() })}
              onBlur={() => void patch({ endpoint: config.endpoint })}
            />
          </label>
          <label className="text-xs">
            <span className="mb-1 block text-neutral-400">端口</span>
            <input
              className="field w-full"
              type="number"
              value={config.port}
              onChange={(e) => setConfig({ ...config, port: Number(e.target.value) || 9000 })}
              onBlur={() => void patch({ port: config.port })}
            />
          </label>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <label className="text-xs">
            <span className="mb-1 block text-neutral-400">Bucket</span>
            <input
              className="field w-full"
              value={config.bucket}
              onChange={(e) => setConfig({ ...config, bucket: e.target.value.trim() })}
              onBlur={() => void patch({ bucket: config.bucket })}
            />
          </label>
          <label className="flex items-end gap-2 pb-1.5 text-xs">
            <input
              type="checkbox"
              className="h-3.5 w-3.5 accent-indigo-600"
              checked={config.useSSL}
              onChange={(e) => void patch({ useSSL: e.target.checked })}
            />
            HTTPS（{config.useSSL ? '已开启' : '局域网可用 HTTP'}）
          </label>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <label className="text-xs">
            <span className="mb-1 block text-neutral-400">Access Key</span>
            <input
              className="field w-full"
              value={config.accessKey}
              onChange={(e) => setConfig({ ...config, accessKey: e.target.value.trim() })}
              onBlur={() => void patch({ accessKey: config.accessKey })}
            />
          </label>
          <label className="text-xs">
            <span className="mb-1 block text-neutral-400">
              Secret Key{secretSet ? '（已加密保存，留空不修改）' : ''}
            </span>
            <input
              className="field w-full"
              type="password"
              placeholder={secretSet ? '••••••••' : ''}
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
            />
          </label>
        </div>
        <div className="flex items-center gap-2">
          <button
            className="btn-ghost border border-neutral-300 dark:border-neutral-700"
            disabled={testing}
            onClick={() => void saveAndTest()}
          >
            {testing ? <Loader2 size={14} className="animate-spin" /> : null}
            {testing ? '测试中…' : '保存并测试连接'}
          </button>
          <span className="text-[11px] text-neutral-400">
            {status?.configured
              ? '✓ 连接信息完整（bucket 不存在时会自动创建）'
              : '填写地址 / AccessKey / SecretKey 后测试'}
          </span>
        </div>
      </div>

      {/* 启用与自动同步 */}
      {status?.configured && (
        <div className="card space-y-2 p-3">
          <label className="flex cursor-pointer items-center justify-between text-sm">
            <span>启用同步</span>
            <button
              role="switch"
              aria-checked={config.enabled}
              className={`relative h-6 w-11 rounded-full transition-colors ${
                config.enabled ? 'bg-indigo-600' : 'bg-neutral-300 dark:bg-neutral-700'
              }`}
              onClick={() => void patch({ enabled: !config.enabled })}
            >
              <span
                className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${
                  config.enabled ? 'left-[22px]' : 'left-0.5'
                }`}
              />
            </button>
          </label>
          <label className="flex cursor-pointer items-center gap-2 text-xs text-neutral-500 dark:text-neutral-400">
            <input
              type="checkbox"
              className="h-3.5 w-3.5 accent-indigo-600"
              checked={config.autoSync}
              onChange={(e) => void patch({ autoSync: e.target.checked })}
            />
            自动同步（应用启动时 + 素材变动 30 秒后；关闭则仅手动触发）
          </label>
        </div>
      )}

      {/* 状态与操作 */}
      {status?.configured && config.enabled && (
        <div className="card space-y-2.5 p-3">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-neutral-400">
            <span>上次同步：{status.lastSyncAt ? formatTime(status.lastSyncAt) : '从未'}</span>
            {status.cloudOnlyCount > 0 && (
              <span>云端未下载：{status.cloudOnlyCount} 张（按需下载）</span>
            )}
          </div>
          {status.lastError && (
            <div className="rounded-md bg-red-50 px-2.5 py-1.5 text-xs text-red-600 dark:bg-red-950/50 dark:text-red-400">
              {status.lastError}
            </div>
          )}
          {progress && (
            <div>
              <div className="mb-1 flex justify-between text-xs text-neutral-400">
                <span>
                  {PHASE_LABELS[progress.phase]} {progress.message}
                </span>
                {progress.total > 0 && (
                  <span>
                    {progress.current}/{progress.total}
                  </span>
                )}
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-700">
                <div
                  className="h-full rounded-full bg-indigo-500 transition-all"
                  style={{
                    width:
                      progress.total > 0 ? `${(progress.current / progress.total) * 100}%` : '100%'
                  }}
                />
              </div>
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <button className="btn-primary" disabled={running} onClick={() => void doSync()}>
              {running ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
              {running ? '同步中…' : '立即同步'}
            </button>
            {status.cloudOnlyCount > 0 && !busyDownload && (
              <>
                <button
                  className="btn-ghost border border-neutral-300 dark:border-neutral-700"
                  onClick={() => void doDownload('all')}
                >
                  <CloudDownload size={14} />
                  全部下载（{status.cloudOnlyCount}）
                </button>
                <button
                  className="btn-ghost border border-neutral-300 dark:border-neutral-700"
                  onClick={() => void doDownload('favorite')}
                >
                  <HardDriveDownload size={14} />
                  下载收藏
                </button>
              </>
            )}
            {busyDownload && (
              <span className="flex items-center gap-2 text-xs text-neutral-400">
                <span className="flex items-center gap-1.5">
                  <Loader2 size={13} className="animate-spin" />
                  批量下载中…
                </span>
                <button
                  className="rounded-full border border-neutral-300 px-2 py-0.5 text-[11px] hover:border-red-400 hover:text-red-500 dark:border-neutral-600"
                  onClick={() => {
                    void window.api
                      .syncCancelDownload()
                      .then(() => toast('已发送取消信号，正在停止下载…', 'info'))
                  }}
                >
                  取消
                </button>
              </span>
            )}
          </div>
          <p className="text-[11px] leading-relaxed text-neutral-400">
            同步内容：图片元数据（分类/标签/收藏/文件名）全量双向同步；图片文件按需下载（查看、设壁纸、轮播时自动拉取），也可上方批量下载离线备用。冲突按"最后修改者胜"自动合并；删除会同步传播到所有设备。
          </p>

          {/* 同步体检 */}
          <HealthCheckSection />
        </div>
      )}
    </section>
  )
}

/** 同步体检：三方对账结果 + 修复动作 + 完整性校验 + 下载容量预估 */
function HealthCheckSection(): JSX.Element | null {
  const toast = useUIStore((st) => st.toast)
  const closeDrawer = useUIStore((st) => st.closeDrawer)
  const setFilter = useLibraryStore((st) => st.setFilter)
  const [report, setReport] = useState<SyncHealthReport | null>(null)
  const [checking, setChecking] = useState(false)
  const [verifying, setVerifying] = useState(false)
  const [estimate, setEstimate] = useState<{ count: number; sizeBytes: number } | null>(null)

  /** 深链：画廊过滤到该问题影响的图片，并关闭设置抽屉便于查看 */
  const openHealthFilter = (label: string, ids: string[]): void => {
    setFilter({ health: { label, ids } })
    closeDrawer()
    toast(`已在画廊过滤出「${label}」${ids.length} 张`)
  }

  const run = async (): Promise<void> => {
    setChecking(true)
    try {
      const r = await window.api.syncHealthCheck()
      setReport(r)
      setEstimate(await window.api.syncDownloadEstimate())
      toast('体检完成')
    } catch (err) {
      toast(`体检失败：${err instanceof Error ? err.message : String(err)}`, 'error')
    } finally {
      setChecking(false)
    }
  }

  if (checking === false && report === null && estimate === null) {
    return (
      <button
        className="btn-ghost w-full justify-center border border-neutral-300 text-xs dark:border-neutral-700"
        onClick={() => void run()}
      >
        🔍 同步体检（检查云端孤儿 / 缺失原图 / 本地断链）
      </button>
    )
  }

  const rows: {
    label: string
    count: number
    hint: string
    action?: { label: string; onClick: () => void }
    /** 点击问题名跳转画廊查看受影响图片 */
    deepLink?: { label: string; ids: string[] }
  }[] = []
  if (report) {
    if (report.cloudOrphanObjects.length > 0) {
      rows.push({
        label: '云端孤儿对象',
        count: report.cloudOrphanObjects.length,
        hint: '桶内已不需要的 objects（清理释放空间）',
        action: {
          label: `清理 ${report.cloudOrphanObjects.length} 个`,
          onClick: () => {
            if (
              !confirm(`删除桶中 ${report.cloudOrphanObjects.length} 个孤儿对象？此操作不可恢复。`)
            )
              return
            void window.api.syncCleanOrphans(report.cloudOrphanObjects).then((n) => {
              toast(`已清理 ${n} 个孤儿对象`)
              void run()
            })
          }
        }
      })
    }
    if (report.missingBinaries.length > 0) {
      rows.push({
        label: '云端缺失原图',
        count: report.missingBinaries.length,
        hint: '这些图片只有元数据，桶中没有文件（需在有原图的设备重新上传）',
        deepLink: { label: '云端缺失原图', ids: report.missingBinaries.map((m) => m.id) }
      })
    }
    if (report.localBroken.length > 0) {
      rows.push({
        label: '本地文件断链',
        count: report.localBroken.length,
        hint: '记录标记为本地但文件丢失；可标记回云端后重新下载',
        deepLink: { label: '本地文件断链', ids: report.localBroken.map((b) => b.id) },
        action: {
          label: `修复 ${report.localBroken.length} 条`,
          onClick: () => {
            void window.api.syncRepairBroken(report.localBroken.map((b) => b.id)).then((n) => {
              toast(`已修复 ${n} 条（已标记为云端，点击图片将重新下载）`)
              void run()
            })
          }
        }
      })
    }
    if (report.missingThumbs.length > 0) {
      rows.push({
        label: '缩略图缺失',
        count: report.missingThumbs.length,
        hint: '本地与云端均无缩略图（打开图片后自动补生成）',
        deepLink: { label: '缩略图缺失', ids: report.missingThumbs.map((m) => m.id) }
      })
    }
    if (report.expiredTombstonesCleaned.length > 0) {
      rows.push({
        label: '已清理过期墓碑',
        count: report.expiredTombstonesCleaned.length,
        hint: '90 天 TTL 自动清理'
      })
    }
  }

  return (
    <div className="space-y-2 rounded-lg border border-neutral-200 p-3 dark:border-neutral-700">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium">同步体检</span>
        <button
          className="btn-ghost !px-2 !py-0.5 text-[11px]"
          onClick={() => void run()}
          disabled={checking}
        >
          {checking ? '检查中…' : '重新检查'}
        </button>
      </div>
      {estimate && (
        <div className="text-[11px] text-neutral-400">
          云端未下载：<b>{estimate.count}</b> 张（约 {formatBytes(estimate.sizeBytes)}）
          {estimate.count > 0 && (
            <>
              {' · '}
              <button
                className="text-indigo-500 hover:underline"
                onClick={() => window.api.syncCancelDownload()}
              >
                取消进行中的下载
              </button>
            </>
          )}
        </div>
      )}
      {rows.length === 0 && !checking && (
        <div className="text-[11px] text-emerald-600 dark:text-emerald-400">
          ✓ 一切正常，未发现问题
        </div>
      )}
      {rows.map((r) => (
        <div key={r.label} className="flex items-center justify-between gap-2 text-[11px]">
          <div className="min-w-0 flex-1">
            <span className="font-medium text-amber-600 dark:text-amber-400">
              {r.deepLink ? (
                <button
                  className="underline decoration-dotted underline-offset-2 hover:text-amber-700 dark:hover:text-amber-300"
                  title="在画廊中过滤查看这些图片"
                  onClick={() => r.deepLink && openHealthFilter(r.deepLink.label, r.deepLink.ids)}
                >
                  {r.label} × {r.count}
                </button>
              ) : (
                <>
                  {r.label} × {r.count}
                </>
              )}
            </span>
            <span className="ml-1 text-neutral-400">{r.hint}</span>
          </div>
          {r.action && (
            <button
              className="btn-ghost shrink-0 !px-2 !py-0.5 text-[11px]"
              onClick={r.action.onClick}
            >
              {r.action.label}
            </button>
          )}
        </div>
      ))}
      <button
        className="btn-ghost w-full justify-center !py-1 text-[11px]"
        disabled={verifying}
        onClick={() => {
          if (!confirm('校验全部本地文件的完整性（内容哈希比对，大库耗时较长）？')) return
          setVerifying(true)
          void window.api
            .syncVerifyIntegrity()
            .then((bad) => {
              setVerifying(false)
              if (bad.length === 0) toast('完整性校验通过：全部本地文件与记录一致')
              else
                toast(
                  `${bad.length} 个文件内容与记录不符（可能已损坏）：${bad
                    .slice(0, 3)
                    .map((b) => b.fileName)
                    .join('、')}${bad.length > 3 ? ' 等' : ''}`,
                  'error'
                )
            })
            .catch(() => setVerifying(false))
        }}
      >
        {verifying ? '校验中…' : '校验本地文件完整性（内容哈希比对）'}
      </button>
    </div>
  )
}
