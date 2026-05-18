import path from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src/renderer'),
    },
  },
  // Electron 42 ships Chromium 134 — skip the polyfills/transforms that target
  // older browsers. Trims bundle size and shortens parse time on first paint.
  build: {
    target: 'chrome134',
  },
});
