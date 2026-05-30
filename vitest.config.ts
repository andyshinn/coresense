import path from 'node:path';
import { defineConfig } from 'vitest/config';

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
            // Stub out the electron host APIs so integration tests run in a
            // plain Node environment without an Electron process.
            electron: path.resolve(__dirname, 'tests/support/electron-stub.ts'),
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
