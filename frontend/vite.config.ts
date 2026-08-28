import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import os from 'os'

export default defineConfig({
  plugins: [react()],
  // Dropbox syncs this workspace and locks files mid-write, causing EBUSY
  // errors when Vite's dep cache lives under node_modules/.vite. Keep it outside.
  cacheDir: path.join(os.tmpdir(), 'ai-graph-frontend-vite-cache'),
  build: {
    rollupOptions: {
      // Two entry points, one bundle of shared chunks: index.html is the
      // editor, runtime.html is what a deployed graph serves (see
      // src/runtime/RuntimeApp.tsx). They share every widget component, which
      // is the point -- a deployed tool renders through the same code the
      // designer previewed.
      input: {
        index: path.resolve(__dirname, 'index.html'),
        runtime: path.resolve(__dirname, 'runtime.html'),
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    // Bind IPv4 explicitly. Node 17+ stopped reordering DNS results, so Vite's
    // default `localhost` resolves to ::1 and binds IPv6 ONLY -- which leaves
    // http://127.0.0.1:3000 dead while http://localhost:3000 works, and that is
    // a miserable thing to debug.
    host: '127.0.0.1',
    port: 3000,
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
    },
  },
})
