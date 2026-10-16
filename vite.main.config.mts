import Info from 'unplugin-info/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [
    // Exposes version (from package.json) and git SHA at build time via the
    // virtual modules `~build/package` and `~build/git`. Read in
    // src/main/build-info.ts, surfaced by src/main/about.ts and forwarded to
    // the renderer through the existing Capabilities handshake — single source
    // of truth.
    Info({}),
  ],
  build: {
    // Electron 44 bundles Node.js 24 — match the target so we don't down-level
    // syntax the runtime supports natively.
    target: 'node24',
    rollupOptions: {
      external: [
        'electron',
        'electron-squirrel-startup',
        '@stoprocent/noble',
        'serialport',
        'ws',
        'bufferutil',
        'utf-8-validate',
        // Forge externalizes Node builtins from `builtinModules`, which omits
        // prefix-only builtins like node:sqlite, so it must be listed by hand.
        // Only `pnpm start` surfaces the miss; `make` builds fine without it.
        'node:sqlite',
      ],
    },
  },
});
