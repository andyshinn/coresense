import { defineConfig } from 'vite';

export default defineConfig({
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
