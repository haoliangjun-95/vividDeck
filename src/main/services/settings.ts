/** 应用设置（主题 / 导入模式 / 默认填充模式 / 存储目录），本地持久化 */
import type { AppSettings } from '@shared/types'
import { JsonStore } from './store'

const settingsStore = new JsonStore<AppSettings>('settings', {
  theme: 'system',
  importMode: 'copy',
  defaultFillMode: 'fill',
  storageDir: '',
  bubbleEnabled: true
})

export function getSettings(): AppSettings {
  return settingsStore.get()
}

export function updateSettings(patch: Partial<AppSettings>): AppSettings {
  return settingsStore.set(patch)
}

export function flushSettings(): void {
  settingsStore.flush()
}
