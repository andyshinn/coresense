import { defineConfig } from 'vite';

export default defineConfig({
  build: {
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
