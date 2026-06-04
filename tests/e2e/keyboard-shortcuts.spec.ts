import { expect, test } from '@playwright/test';
import type { Channel } from '../../src/shared/types';
import { launchApp } from './support/launch';

const CHANNELS: Channel[] = [
  {
    key: 'ch:Public',
    name: 'Public',
    kind: 'public',
    idx: 0,
    secretHex: '00112233445566778899aabbccddeeff',
  },
];

test('opens and closes the keyboard shortcuts overlay with ?', async () => {
  const { page, close } = await launchApp({ channels: CHANNELS });
  try {
    const overlay = page.getByTestId('help-overlay');

    // Wait for the app shell to be rendered before interacting.
    await page.getByTestId('connection-status-footer').waitFor({ state: 'attached' });

    // Not present until summoned.
    await expect(overlay).toHaveCount(0);

    // "?" opens it. Blur any focused text field first so the guardTyping check
    // does not suppress the shortcut, then type "?" which produces e.key==="?".
    // Note: keyboard.press('Shift+/') sends e.key==="/" in Electron/Playwright,
    // not "?" — use keyboard.type('?') to get the correct key value.
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.keyboard.type('?');
    await expect(overlay).toBeVisible();
    await expect(overlay.getByText('Keyboard Shortcuts')).toBeVisible();
    await expect(overlay.getByText('Command palette', { exact: true })).toBeVisible();

    // Esc closes it.
    await page.keyboard.press('Escape');
    await expect(overlay).toHaveCount(0);
  } finally {
    await close();
  }
});
