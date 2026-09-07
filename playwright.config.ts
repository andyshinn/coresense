import { defineConfig } from '@playwright/test';

// Electron apps are NOT single-instance — this app has no
// requestSingleInstanceLock() — but every launch shares global OS state
// (windows, focus, mDNS names, the bridge's TCP port), so run specs serially.
// The HTTP/WS port is no longer shared: launchApp() forces CORESENSE_HTTP_PORT
// to 0 (see tests/e2e/support/launch.ts and issue #21).
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 20_000 },
  reporter: [['list'], ['html', { open: 'never' }]],
});
