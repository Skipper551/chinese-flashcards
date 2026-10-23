/// <reference types="vitest/config" />
import { cp, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import preact from '@preact/preset-vite';
import { VitePWA } from 'vite-plugin-pwa';

// GitHub Pages serves the app from /<repo-name>/, so the deploy workflow sets BASE_PATH.
const base = process.env.BASE_PATH ?? '/';

const hanziDataDir = fileURLToPath(new URL('./node_modules/hanzi-writer-data/', import.meta.url));

/**
 * Serves Hanzi Writer's per-character stroke data (about 9,500 files, 32 MB) at hanzi-data/: from node_modules
 * in dev, copied into dist/ on build. Too big to precache; the service worker caches files as they're used.
 */
function hanziData(): Plugin {
  let outDir = 'dist';
  return {
    name: 'hanzi-data',
    configResolved(config) {
      outDir = config.build.outDir;
    },
    configureServer(server) {
      server.middlewares.use(`${base}hanzi-data/`, async (req, res, next) => {
        const name = decodeURIComponent((req.url ?? '').split('?')[0].slice(1));
        if (!/^[^/\\]+\.json$/.test(name)) return next();
        try {
          const body = await readFile(hanziDataDir + name);
          res.setHeader('Content-Type', 'application/json');
          res.end(body);
        } catch {
          res.statusCode = 404;
          res.end();
        }
      });
    },
    async closeBundle() {
      await cp(hanziDataDir, `${outDir}/hanzi-data/`, {
        recursive: true,
        filter: (src) => !/(\.js|package\.json|README\.md|yarn\.lock)$/.test(src),
      });
    },
  };
}

export default defineConfig({
  base,
  plugins: [
    preact(),
    hanziData(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'apple-touch-icon-180x180.png'],
      manifest: {
        name: 'Chinese Flashcards',
        short_name: 'Flashcards',
        description: 'Write Chinese characters from memory with Apple Pencil.',
        lang: 'en',
        theme_color: '#b23a2e',
        background_color: '#faf6ef',
        display: 'standalone',
        orientation: 'any',
        start_url: base,
        scope: base,
        icons: [
          { src: 'pwa-64x64.png', sizes: '64x64', type: 'image/png' },
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: 'maskable-icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,json}'],
        globIgnores: ['hanzi-data/**'],
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.includes('/hanzi-data/'),
            handler: 'CacheFirst',
            options: { cacheName: 'hanzi-data', expiration: { maxEntries: 10000 } },
          },
        ],
      },
    }),
  ],
  test: {
    environment: 'node',
  },
});
