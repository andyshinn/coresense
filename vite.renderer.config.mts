import path from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { viteStaticCopy } from 'vite-plugin-static-copy';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    viteStaticCopy({
      // `stripBase: true` drops the node_modules/emojibase-data/en/ prefix so
      // the files land flat at emoji/en/{data,messages}.json. Point frimousse's
      // `emojibaseUrl` prop at this path (e.g. an app:// or relative base) to
      // serve the picker's data offline instead of jsdelivr's CDN default.
      targets: [
        { src: 'node_modules/emojibase-data/en/data.json', dest: 'emoji/en', rename: { stripBase: true } },
        { src: 'node_modules/emojibase-data/en/messages.json', dest: 'emoji/en', rename: { stripBase: true } },
      ],
    }),
  ],
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
