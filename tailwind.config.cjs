/** @type {import('tailwindcss').Config} */
module.exports = {
  // 暗色模式跟随 html 上的 dark 类（由 nativeTheme 同步）
  darkMode: 'class',
  content: ['./src/renderer/index.html', './src/renderer/src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // 品牌色（亮/暗主题下由 CSS 变量微调，见 styles.css）
        brand: {
          DEFAULT: '#6366f1',
          50: '#eef2ff',
          100: '#e0e7ff',
          500: '#6366f1',
          600: '#4f46e5',
          700: '#4338ca'
        }
      }
    }
  },
  plugins: []
}
