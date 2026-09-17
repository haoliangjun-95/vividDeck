/** window.api 类型声明（渲染层使用） */
import type { VividDeckApi } from './index'

declare global {
  interface Window {
    api: VividDeckApi
  }
}

export {}
