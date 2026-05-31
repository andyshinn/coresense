import { defineConfig } from '@playwright/test';

// Electron apps are single-instance and share global OS state (windows, the
// local HTTP/WS server port), so run specs serially.
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 20_000 },
  reporter: [['list'], ['html', { open: 'never' }]],
});
