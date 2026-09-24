/**
 * 日志系统 + 崩溃兜底（清单 #14）
 * - electron-log 落盘：捕获主进程全部 console.*（同步引擎等既有调用点无需改动）
 * - 脱敏：key=value 形式凭据、URL userinfo、已配置的 endpoint/accessKey 精确替换
 * - 崩溃兜底：uncaughtException / unhandledRejection / render-process-gone / child-process-gone
 *
 * 日志位置：macOS ~/Library/Logs/vividdeck/main.log；Windows %APPDATA%/vividDeck/logs/main.log
 * （以 logFilePath() 实际解析为准）
 */
import { app, BrowserWindow, dialog } from 'electron'
import log from 'electron-log/main'
import { getSyncConfig } from './sync/store'

/** 敏感字段名（对象中出现这些 key 时值整体替换为 ***） */
const SENSITIVE_KEYS = new Set([
  'accesskey',
  'secretkey',
  'secret',
  'password',
  'passwd',
  'token',
  'authorization',
  'credential'
])

/** 单个日志文件上限：10MB，electron-log 超限自动归档为 main.old.log */
const LOG_MAX_SIZE = 10 * 1024 * 1024

/** 字符串模式脱敏 */
function redactText(text: string): string {
  let out = text
    // key=value / key: value 形式的凭据（JSON、查询串、拼接日志均可命中）
    .replace(
      /((?:access|secret|api)?[-_]?key|secret|password|passwd|token|authorization)(['"]?\s*[:=]\s*)(['"]?)[^\s"',;)}\]]+/gi,
      '$1$2$3***'
    )
    // URL 中的 user:pass@
    .replace(/\/\/([^/\s:@]+):([^@\s]+)@/g, '//$1:***@')
  // 已配置的 endpoint / accessKey 按精确串替换（懒读取，失败不影响日志本身）
  try {
    const cfg = getSyncConfig()
    if (cfg.accessKey) out = out.split(cfg.accessKey).join('***')
    if (cfg.endpoint) out = out.split(cfg.endpoint).join('<endpoint>')
  } catch {
    /* 配置尚未就绪时跳过精确替换 */
  }
  return out
}

/** 递归处理日志参数：字符串做模式脱敏；普通对象中敏感 key 的值替换；Error 等实例保持原样 */
function redactValue(value: unknown): unknown {
  if (typeof value === 'string') return redactText(value)
  if (Array.isArray(value)) return value.map(redactValue)
  if (value !== null && typeof value === 'object') {
    const proto = Object.getPrototypeOf(value) as unknown
    if (proto === Object.prototype || proto === null) {
      const out: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        out[k] = SENSITIVE_KEYS.has(k.toLowerCase()) ? '***' : redactValue(v)
      }
      return out
    }
  }
  return value
}

/** 日志文件绝对路径（供崩溃对话框展示；解析失败时给占位串） */
export function logFilePath(): string {
  try {
    return log.transports.file.getFile().path
  } catch {
    return '(日志路径未解析)'
  }
}

// 注：electron-log v5 file transport 为 fs.writeFileSync 同步写入，
// log.error 返回即已落盘，崩溃路径无需额外 flush。

/**
 * 初始化日志系统（app 启动最早期调用一次，可早于 ready）
 * 之后主进程所有 console.* 都会同时落盘。
 */
export function initLogger(): void {
  log.initialize()
  log.transports.file.level = 'info'
  log.transports.file.maxSize = LOG_MAX_SIZE
  // 打包后关闭 console transport（避免重复输出）；开发时保留便于调试
  log.transports.console.level = app.isPackaged ? false : 'debug'
  // 落盘 / 输出前统一脱敏
  log.hooks.push((message) => {
    message.data = message.data.map(redactValue)
    return message
  })
  // 捕获既有 console.*（engine/library/slideshow 等无需改动即落盘）
  Object.assign(console, log.functions)
  log.info(
    `[logger] vividDeck v${app.getVersion()} 启动，electron ${process.versions.electron}，` +
      `平台 ${process.platform}，日志：${logFilePath()}`
  )
}

/** 渲染进程崩溃计数（防止崩溃循环时无限重载） */
const renderCrashCounts = new Map<number, number>()

/** 安装主进程崩溃兜底 handler（此前全无） */
export function installCrashHandlers(): void {
  process.on('uncaughtException', (err) => {
    log.error('[crash] 主进程未捕获异常:', err)
    dialog.showErrorBox(
      'vividDeck 遇到错误',
      '主进程发生未捕获异常，应用即将退出。\n' +
        '如反复出现，请把日志文件发给开发者排查：\n' +
        `${logFilePath()}\n\n` +
        (err instanceof Error ? err.message : String(err))
    )
    app.exit(1)
  })

  process.on('unhandledRejection', (reason) => {
    // 只记录不退出：Promise 拒绝通常不应终止壁纸应用
    log.error('[crash] 未处理的 Promise rejection:', reason)
  })

  app.on('render-process-gone', (_event, contents, details) => {
    log.error(`[crash] 渲染进程退出 reason=${details.reason} exitCode=${details.exitCode}`)
    if (details.reason === 'clean-exit' || contents.isDestroyed()) return
    const count = (renderCrashCounts.get(contents.id) ?? 0) + 1
    renderCrashCounts.set(contents.id, count)
    if (count === 1) {
      // 首次崩溃：静默重载，尽量不打断使用（主进程轮播不受影响）
      contents.reload()
      return
    }
    // 连续崩溃：停止自动恢复，展示日志位置便于排查
    const win = BrowserWindow.fromWebContents(contents)
    if (win && !win.isDestroyed()) {
      dialog.showErrorBox(
        '界面连续崩溃',
        `渲染进程已连续崩溃 ${count} 次，已停止自动恢复。\n日志位置：\n${logFilePath()}`
      )
    }
  })

  app.on('child-process-gone', (_event, details) => {
    log.error(
      `[crash] 子进程退出 type=${details.type} reason=${details.reason} exitCode=${details.exitCode}`
    )
  })
}
