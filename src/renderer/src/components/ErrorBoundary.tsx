/**
 * React 错误边界（清单 #15）：组件抛错不再白屏
 * - 全局边界（main.tsx 包裹 App）：全屏兜底 UI + 「重新加载」按钮
 * - 局部边界（传 section）：仅降级该区块，其余界面可继续使用；支持「重试」就地恢复
 */
import React from 'react'

interface ErrorBoundaryProps {
  children: React.ReactNode
  /** 区块名称：提供时渲染紧凑的局部回退，缺省渲染全屏回退 */
  section?: string
}

interface ErrorBoundaryState {
  error: Error | null
}

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    // 渲染层 console 可在 DevTools 查看；主进程日志见 electron-log 落盘文件
    console.error(`[ErrorBoundary] ${this.props.section ?? '全局'}`, error, info.componentStack)
  }

  private readonly reload = (): void => {
    window.location.reload()
  }

  private readonly reset = (): void => {
    this.setState({ error: null })
  }

  render(): React.ReactNode {
    const { error } = this.state
    if (!error) return this.props.children

    if (this.props.section) {
      return (
        <div className="m-3 rounded-lg border border-red-200 bg-red-50 p-4 text-sm dark:border-red-900/50 dark:bg-red-950/30">
          <div className="font-medium text-red-700 dark:text-red-300">
            「{this.props.section}」加载失败
          </div>
          <div className="mt-1 break-all text-xs text-red-600/80 dark:text-red-400/80">
            {error.message}
          </div>
          <div className="mt-2 flex gap-2">
            <button className="btn-ghost !px-2 !text-xs" onClick={this.reset}>
              重试
            </button>
            <button className="btn-ghost !px-2 !text-xs" onClick={this.reload}>
              重载整页
            </button>
          </div>
        </div>
      )
    }

    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 bg-neutral-50 p-8 text-center dark:bg-[#111116]">
        <div className="text-lg font-semibold">界面遇到了问题</div>
        <p className="max-w-md text-sm text-neutral-500">
          渲染进程发生未捕获错误，重新加载即可恢复。
        </p>
        <div className="max-w-md break-all text-xs text-neutral-400">{error.message}</div>
        <button className="btn-primary mt-2" onClick={this.reload}>
          重新加载
        </button>
      </div>
    )
  }
}
