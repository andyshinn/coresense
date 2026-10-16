import path from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// `~build/git` and `~build/package` are virtual modules supplied by
// unplugin-info only when the app is bundled through Vite. Test runs have no
// such plugin, so anything that transitively imports src/main/build-info.ts
// (e.g. the Hono API routes) fails to resolve them. Alias both to a static
// stub for every project.
const buildInfoAlias = {
  '~build/git': path.resolve(__dirname, 'tests/support/build-info-stub.ts'),
  '~build/package': path.resolve(__dirname, 'tests/support/build-info-stub.ts'),
};

// Every project resolves `@` to the renderer, as vite.renderer.config.mts and
// tsconfig's `paths` do, plus the build-info stubs above.
const sharedResolve = {
  alias: {
    '@': path.resolve(__dirname, 'src/renderer'),
    ...buildInfoAlias,
  },
};

// One config with three projects: `unit` (pure Node, no Electron),
// `integration` (main-process modules wired together) and `dom` (renderer
// components under a DOM environment).
export default defineConfig({
  test: {
    projects: [
      {
        resolve: sharedResolve,
        test: {
          name: 'unit',
          environment: 'node',
          include: ['tests/unit/**/*.test.ts'],
        },
      },
      {
        resolve: sharedResolve,
        test: {
          name: 'integration',
          environment: 'node',
          include: ['tests/integration/**/*.test.ts'],
          setupFiles: ['tests/integration/setup.ts'],
        },
      },
      {
        // Renderer component tests. Unlike `unit`/`integration` (node-only),
        // these mount real React components in jsdom so we get the real
        // React-flush-then-document-bubble timing and a real Event.composedPath
        // (see tests/component/deselect-on-outside-click.test.tsx). The react
        // plugin transforms TSX; jsdom supplies the DOM.
        plugins: [react()],
        resolve: sharedResolve,
        test: {
          name: 'dom',
          environment: 'jsdom',
          include: ['tests/component/**/*.test.tsx'],
          setupFiles: ['tests/component/setup.ts'],
        },
      },
    ],
    coverage: {
      provider: 'v8',
      reportsDirectory: './coverage',
      include: ['src/**'],
      // Vendored shadcn primitives and type-only declarations aren't ours to cover.
      exclude: ['src/renderer/components/ui/**', '**/*.d.ts'],
    },
  },
});
