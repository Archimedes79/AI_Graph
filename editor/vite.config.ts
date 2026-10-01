import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { readFileSync, readdirSync } from 'fs'
import { createRequire } from 'module'
import path from 'path'
import os from 'os'

/**
 * `licenses.txt` beside the built page: every package it is made of, with its
 * licence text. Most of them (MIT, ISC, BSD) are given on condition that their
 * notice goes with every copy, and a minified build keeps hardly any of it.
 * Each page links the file (`rel="license"`), which is also how a deploy
 * bundle, carrying what `runtime.html` references, comes to carry it.
 */
function licenses(): Plugin {
  const folderOf = (name: string): string =>
    path.dirname(createRequire(import.meta.url).resolve(`${name}/package.json`)).replace(/\\/g, '/')
  return {
    name: 'licenses',
    apply: 'build',
    transformIndexHtml: () => [{ tag: 'link', attrs: { rel: 'license', href: '/licenses.txt' }, injectTo: 'head' }],
    generateBundle(_options, bundle) {
      // A package's folder, and the licence file that covers what of it is in
      // the page -- its own, unless named. Two reach the page without being
      // imported, so no module names them: the base stylesheet `@tailwind base`
      // writes in, under the licence of the stylesheets it was made from, and
      // the loader the bundler adds for the page's chunks.
      const packages = new Map([[folderOf('tailwindcss'), 'src/css/LICENSE'], [folderOf('vite'), '']])
      for (const file of Object.values(bundle)) {
        if (file.type !== 'chunk') continue
        for (const [id, module] of Object.entries(file.modules)) {
          const where = id.replace(/^\0/, '').replace(/\?.*$/, '').replace(/\\/g, '/')
          const at = where.lastIndexOf('/node_modules/')
          if (at < 0 || !module.renderedLength) continue
          const [first, second] = where.slice(at + '/node_modules/'.length).split('/')
          packages.set(`${where.slice(0, at)}/node_modules/${first.startsWith('@') ? `${first}/${second}` : first}`, '')
        }
      }
      const notices = [...packages].map(([folder, named]) => {
        const { name, version, license } = JSON.parse(readFileSync(`${folder}/package.json`, 'utf8'))
        const text = named || readdirSync(folder).find((entry) => /^licen[cs]e/i.test(entry))
        return {
          name,
          // A licence file that goes on to list what its package bundles is cut
          // there: that code is not in this page.
          notice: `${name} ${version} (${license})\n\n${text
            ? readFileSync(`${folder}/${text}`, 'utf8').split(/^#+ Licenses of bundled dependencies/m)[0].trim()
            : 'The package carries no licence text of its own.'}`,
        }
      }).sort((a, b) => a.name.localeCompare(b.name))
      this.emitFile({
        type: 'asset',
        fileName: 'licenses.txt',
        source: ['The packages this page is built from, and the terms each comes under.', ...notices.map((each) => each.notice)]
          .join(`\n\n${'-'.repeat(72)}\n\n`) + '\n',
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), licenses()],
  // Dropbox syncs this workspace and locks files mid-write, causing EBUSY
  // errors when Vite's dep cache lives under node_modules/.vite. Keep it outside.
  cacheDir: path.join(os.tmpdir(), 'ai-graph-editor-vite-cache'),
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
      // The engine lives beside the editor, not inside it: it must run under
      // Node and Deno with no build step, so it cannot live in a React app's
      // source tree. The editor imports it for the things that must not be
      // said twice -- which ports a block contributes, above all, since those
      // are what the graph's edges attach to.
      '@engine': path.resolve(__dirname, '../engine/src'),
    },
  },
  server: {
    // Bind IPv4 explicitly. Node 17+ stopped reordering DNS results, so Vite's
    // default `localhost` resolves to ::1 and binds IPv6 ONLY -- which leaves
    // http://127.0.0.1:3000 dead while http://localhost:3000 works, and that is
    // a miserable thing to debug.
    // The engine is outside the project root, so the dev server has to be
    // told it may read it.
    fs: { allow: [path.resolve(__dirname, '..')] },
    host: '127.0.0.1',
    port: 3000,
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
        // The engine answers only its own origin (host/http.ts `foreignRequest`);
        // the dev page on :3000 is the editor all the same.
        headers: { origin: 'http://localhost:8000' },
      },
    },
  },
})
