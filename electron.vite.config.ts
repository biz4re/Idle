import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'node:path'

export default defineConfig({
  main: {},
  preload: { plugins: [externalizeDepsPlugin({ exclude: ['tldts', 'tldts-core'] })], build: { rollupOptions: { input: { index: resolve('src/preload/index.ts'), page: resolve('src/preload/page.ts') } } } },
  renderer: {
    plugins: [react(), tailwindcss()],
    server: { host: '127.0.0.1' },
  },
})
