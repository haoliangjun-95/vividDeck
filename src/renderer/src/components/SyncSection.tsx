/**
 * MinIO 多设备同步面板（设置页）
 * 连接配置（密钥加密存储）/ 测试连接 / 启用与自动同步 / 状态与进度 / 批量下载
 */
import React, { useEffect, useState } from 'react'
import { CloudDownload, CloudUpload, HardDriveDownload, Loader2, RefreshCw } from 'lucide-react'
import { useUIStore } from '../store/ui'
import { formatTime } from '../lib/utils'
import type { SyncConfig, SyncProgress, SyncStatus } from '@shared/types'

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

  const reload = (): void => {
    void window.api.getSyncInfo().then((info) => {
      setConfig(info.config)
      setStatus(info.status)
      setSecretSet(info.secretSet)
    })
  }

  useEffect(() => {
    reload()
    const offProgress = window.api.onSyncProgress(setProgress)
    const offDone = window.api.onSyncDone((r) => {
      setProgress(null)
      reload()
      if (r.ok && r.stats) {
        const s = r.stats
        toast(`同步完成：拉取 ${s.pulled} 条，上传 ${s.uploaded} 张，耗时 ${(s.durationMs / 1000).toFixed(1)}s`)
      } else if (!r.ok) {
        toast(`同步失败：${r.error}`, 'error')
      }
    })
    return () => {
      offProgress()
      offDone()
    }
  }, [toast])

  if (!config) return null

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

  const doDownload = async (type: 'all' | 'favorite' | 'category', categoryId?: string): Promise<void> => {
    setBusyDownload(true)
    try {
      const r = await window.api.syncDownload({ type, categoryId })
      toast(r.failed > 0 ? `下载完成 ${r.downloaded} 张，失败 ${r.failed} 张` : `已下载 ${r.downloaded} 张到本地`)
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
          <button className="btn-ghost border border-neutral-300 dark:border-neutral-700" disabled={testing} onClick={() => void saveAndTest()}>
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
            {status.cloudOnlyCount > 0 && <span>云端未下载：{status.cloudOnlyCount} 张（按需下载）</span>}
          </div>
          {status.lastError && (
            <div className="rounded-md bg-red-50 px-2.5 py-1.5 text-xs text-red-600 dark:bg-red-950/50 dark:text-red-400">
              {status.lastError}
            </div>
          )}
          {progress && (
            <div>
              <div className="mb-1 flex justify-between text-xs text-neutral-400">
                <span>{PHASE_LABELS[progress.phase]} {progress.message}</span>
                {progress.total > 0 && (
                  <span>
                    {progress.current}/{progress.total}
                  </span>
                )}
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-700">
                <div
                  className="h-full rounded-full bg-indigo-500 transition-all"
                  style={{ width: progress.total > 0 ? `${(progress.current / progress.total) * 100}%` : '100%' }}
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
                <button className="btn-ghost border border-neutral-300 dark:border-neutral-700" onClick={() => void doDownload('all')}>
                  <CloudDownload size={14} />
                  全部下载（{status.cloudOnlyCount}）
                </button>
                <button className="btn-ghost border border-neutral-300 dark:border-neutral-700" onClick={() => void doDownload('favorite')}>
                  <HardDriveDownload size={14} />
                  下载收藏
                </button>
              </>
            )}
            {busyDownload && (
              <span className="flex items-center gap-1.5 text-xs text-neutral-400">
                <Loader2 size={13} className="animate-spin" />
                批量下载中…
              </span>
            )}
          </div>
          <p className="text-[11px] leading-relaxed text-neutral-400">
            同步内容：图片元数据（分类/标签/收藏/文件名）全量双向同步；图片文件按需下载（查看、设壁纸、轮播时自动拉取），也可上方批量下载离线备用。冲突按"最后修改者胜"自动合并；删除会同步传播到所有设备。
          </p>
        </div>
      )}
    </section>
  )
}
