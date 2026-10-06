import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath, URL } from 'node:url'

// 纯前端应用：没有后端，也就没有 /api 代理，数据全部走 src/api/local-service.ts。
// 缓存目录按提交号隔离（VITE_CACHE_DIR），提交一变缓存就重建，避免旧提交的预打包产物串味。
const cacheDir = process.env.VITE_CACHE_DIR || 'node_modules/.vite'

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  cacheDir,
  server: {
    host: '127.0.0.1',
    port: 5173,
    // 关掉自动打开页面：起服务时只打印地址，不拉起浏览器
    open: false,
    strictPort: false,
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
})
