/**
 * ESLint flat config（#13 工程基建）
 * 三环境分层：main/preload/shared = Node，renderer = Browser + react-hooks
 * 规则基线：@eslint/js recommended + typescript-eslint recommended + prettier 兼容
 */
import js from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
import prettier from 'eslint-config-prettier'

export default tseslint.config(
  {
    ignores: ['out/**', 'dist/**', 'release/**', '**/*.tsbuildinfo', '.serena/**']
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // 渲染进程：浏览器环境 + React Hooks 规则
    files: ['src/renderer/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    languageOptions: {
      globals: { ...globals.browser }
    },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn'
    }
  },
  {
    // 主进程 / preload / 共享层 / 脚本 / 根级 CJS 配置：Node 环境
    files: [
      'src/main/**/*.ts',
      'src/preload/**/*.ts',
      'src/shared/**/*.ts',
      'scripts/**/*.{js,cjs,mjs}',
      '*.cjs'
    ],
    languageOptions: {
      globals: { ...globals.node }
    }
  },
  {
    // CommonJS 脚本/配置允许 require()
    files: ['**/*.cjs'],
    rules: {
      '@typescript-eslint/no-require-imports': 'off'
    }
  },
  {
    // 渐进收紧：存量代码先以 warn 拦截增量，不清零不阻塞提交
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }
      ],
      'no-empty': ['error', { allowEmptyCatch: true }]
    }
  },
  prettier
)
