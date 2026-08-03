import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import os from 'os'

export default defineConfig({
  plugins: [react()],
  // Dropbox syncs this workspace and locks files mid-write, causing EBUSY
  // errors when Vite's dep cache lives under node_modules/.vite. Keep it outside.
  cacheDir: path.join(os.tmpdir(), 'ai-graph-frontend-vite-cache'),
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 3000,
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
    },
  },
})
