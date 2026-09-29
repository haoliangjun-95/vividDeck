/**
 * Vitest 配置（#12）：覆盖纯逻辑高价值区
 * - sync/merge.ts（LWW/墓碑/同 hash 去重）、sync/health.ts（对账）
 * - shared/album.ts（matchAlbum 组合语义）
 * - renderer lib/virtualGrid.ts（虚拟滚动行数学）
 * 组件级测试（jsdom）留待后续按需扩展，当前 node 环境即可。
 */
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const root = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  resolve: {
    alias: {
      '@shared': path.resolve(root, 'src/shared'),
      '@renderer': path.resolve(root, 'src/renderer/src'),
      '@main': path.resolve(root, 'src/main')
    }
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      // 覆盖被测的纯逻辑与 service 层（此前 include 只列 4 个文件，严重低估）
      include: ['src/shared/**/*.ts', 'src/main/services/**/*.ts', 'src/renderer/src/lib/**/*.ts'],
      reporter: ['text', 'html']
    }
  }
})
