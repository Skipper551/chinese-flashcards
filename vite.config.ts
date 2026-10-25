/// <reference types="vitest/config" />
import { cp, readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32, deflateRawSync } from 'node:zlib';
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

const skillDir = fileURLToPath(new URL('./.claude/skills/lecture-to-deck/', import.meta.url));
const recognizerData = fileURLToPath(new URL('./public/vendor/hanzilookup/mmah.json', import.meta.url));

/** A zip archive of the given files (deflated, UTF-8 names, Unix permissions), using only node:zlib. */
function zip(files: { name: string; data: Buffer; mode: number }[]): Buffer {
  const local: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const { name, data, mode } of files) {
    const isDir = name.endsWith('/');
    const body = isDir ? Buffer.alloc(0) : deflateRawSync(data);
    const nameBytes = Buffer.from(name);
    // Shared by the local and central headers: version 2.0, UTF-8 flag, method, a fixed 1980-01-01 timestamp, sizes.
    const common = Buffer.alloc(26);
    common.writeUInt16LE(20, 0);
    common.writeUInt16LE(0x0800, 2);
    common.writeUInt16LE(isDir ? 0 : 8, 4);
    common.writeUInt16LE(0, 6);
    common.writeUInt16LE(0x21, 8);
    common.writeUInt32LE(isDir ? 0 : crc32(data), 10);
    common.writeUInt32LE(body.length, 14);
    common.writeUInt32LE(data.length, 18);
    common.writeUInt16LE(nameBytes.length, 22);
    const head = Buffer.alloc(4);
    head.writeUInt32LE(0x04034b50);
    local.push(head, common, nameBytes, body);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE((3 << 8) | 20, 4); // made on Unix, so the permissions below apply
    common.copy(entry, 6, 0, 26);
    entry.writeUInt32LE(((mode << 16) | (isDir ? 0x10 : 0)) >>> 0, 38);
    entry.writeUInt32LE(offset, 42);
    central.push(entry, nameBytes);
    offset += 30 + nameBytes.length + body.length;
  }
  const centralSize = central.reduce((n, b) => n + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, ...central, end]);
}

/**
 * Serves the lecture-to-deck Claude skill as lecture-to-deck.zip, for uploading to Claude. The zip also carries the
 * characters the recognizer knows (scripts/known-chars.txt), as the skill's checker can't reach this repo from there.
 */
function skillZip(): Plugin {
  async function build() {
    const files = [{ name: 'lecture-to-deck/', data: Buffer.alloc(0), mode: 0o40755 }];
    const entries = await readdir(skillDir, { recursive: true, withFileTypes: true });
    for (const entry of entries.sort((a, b) => a.parentPath.localeCompare(b.parentPath) || a.name.localeCompare(b.name))) {
      const full = join(entry.parentPath, entry.name);
      const path = relative(skillDir, full);
      if (/(^|\/)(__pycache__|\.[^/]*)(\/|$)/.test(path)) continue; // caches and hidden files
      if (entry.isDirectory()) files.push({ name: `lecture-to-deck/${path}/`, data: Buffer.alloc(0), mode: 0o40755 });
      else
        files.push({
          name: `lecture-to-deck/${path}`,
          data: await readFile(full),
          mode: path.endsWith('.py') ? 0o100755 : 0o100644,
        });
    }
    const chars = (JSON.parse(await readFile(recognizerData, 'utf8')).chars as [string][]).map((c) => c[0]).join('');
    files.push({ name: 'lecture-to-deck/scripts/known-chars.txt', data: Buffer.from(chars + '\n'), mode: 0o100644 });
    return zip(files);
  }
  return {
    name: 'skill-zip',
    configureServer(server) {
      server.middlewares.use(`${base}lecture-to-deck.zip`, async (_req, res) => {
        res.setHeader('Content-Type', 'application/zip');
        res.end(await build());
      });
    },
    async generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'lecture-to-deck.zip', source: await build() });
    },
  };
}

export default defineConfig({
  base,
  plugins: [
    preact(),
    hanziData(),
    skillZip(),
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
