import Info from 'unplugin-info/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [
    // Exposes version (from package.json) and git SHA at build time via the
    // virtual modules `~build/info` and `~build/git`. Read in src/main/about.ts
    // and forwarded to the renderer through the existing Capabilities handshake
    // — single source of truth.
    Info({ meta: false }),
  ],
  build: {
    // Electron 42 bundles Node.js 22 — match the target so we don't down-level
    // syntax the runtime supports natively.
    target: 'node22',
    rollupOptions: {
      external: [
        'electron',
        'electron-squirrel-startup',
        '@stoprocent/noble',
        'serialport',
        'ws',
        'bufferutil',
        'utf-8-validate',
      ],
    },
  },
});
