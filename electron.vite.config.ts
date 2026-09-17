import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

/**
 * electron-vite 构建配置
 * - main / preload：输出 **ESM**（package.json "type": "module"）。
 *   关键原因：wallpaper 为 ESM-only 包，CJS 产物中 require() 会抛 ERR_REQUIRE_ESM；
 *   Electron 28+ 原生支持 ESM 主进程与非沙箱 preload。
 * - sharp、wallpaper 等依赖保持 external，由 electron-builder 打包（asarUnpack 释放原生二进制）
 * - renderer：React + Tailwind，常规 Vite 打包
 */
const sharedAlias = {
  '@shared': resolve(process.cwd(), 'src/shared')
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: sharedAlias },
    build: {
      outDir: 'out/main',
      rollupOptions: {
        input: { index: 'src/main/index.ts' },
        output: { format: 'es', entryFileNames: '[name].js' }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: sharedAlias },
    build: {
      outDir: 'out/preload',
      rollupOptions: {
        input: { index: 'src/preload/index.ts' },
        output: { format: 'es', entryFileNames: '[name].mjs' }
      }
    }
  },
  renderer: {
    root: 'src/renderer',
    plugins: [react()],
    resolve: { alias: sharedAlias },
    build: {
      outDir: 'out/renderer',
      rollupOptions: {
        input: { index: 'src/renderer/index.html' }
      }
    }
  }
})
