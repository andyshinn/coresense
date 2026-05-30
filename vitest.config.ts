import path from 'node:path';
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

// Approach A from the testing design: one config, a `projects` array. Phase 1
// defines only the `unit` project (pure Node, no Electron). Phase 2 adds an
// `integration` project alongside it.
export default defineConfig({
  test: {
    projects: [
      {
        resolve: {
          alias: {
            '@': path.resolve(__dirname, 'src/renderer'),
            ...buildInfoAlias,
          },
        },
        test: {
          name: 'unit',
          environment: 'node',
          include: ['tests/unit/**/*.test.ts'],
        },
      },
      {
        resolve: {
          alias: {
            '@': path.resolve(__dirname, 'src/renderer'),
            ...buildInfoAlias,
          },
        },
        test: {
          name: 'integration',
          environment: 'node',
          include: ['tests/integration/**/*.test.ts'],
          setupFiles: ['tests/integration/setup.ts'],
        },
      },
    ],
    coverage: {
      provider: 'v8',
      reportsDirectory: './coverage',
      include: ['src/**'],
    },
  },
});
