import { fileURLToPath, URL } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

export default defineConfig(({ mode }) => {
  const rootDir = fileURLToPath(new URL('../..', import.meta.url))
  const env = loadEnv(mode, rootDir, '')

  return {
    plugins: [react(), tailwindcss()],
    // 配置只有仓库根目录一份 .env，前后端共用
    envDir: rootDir,
    resolve: {
      alias: {
        // 直接指向 shared 的 TS 源码，改了契约前端立刻重新编译
        '@contract/shared': fileURLToPath(new URL('../../packages/shared/src/index.ts', import.meta.url)),
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
    server: { port: Number(env.WEB_PORT ?? 5273), strictPort: true },
  }
})
