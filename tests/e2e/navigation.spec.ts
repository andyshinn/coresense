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
  {
    key: 'ch:Private',
    name: 'Private',
    kind: 'public',
    idx: 1,
    secretHex: 'ffeeddccbbaa99887766554433221100',
  },
];

test('navigates between channels and pins one to the top', async () => {
  const { page, close } = await launchApp({ channels: CHANNELS });
  try {
    const publicItem = page.getByTestId('channel-nav-item').filter({ hasText: 'Public' });
    const privateItem = page.getByTestId('channel-nav-item').filter({ hasText: 'Private' });
    // Seeded channels arrive via the async /api/state/snapshot fetch on mount.
    // Wait for the row to attach before checking visibility — an early
    // isVisible()===false + blind toggle would COLLAPSE the default-open
    // Channels group and hide the rows permanently.
    await publicItem.waitFor({ state: 'attached' });
    if (!(await publicItem.isVisible())) await page.getByText('Channels', { exact: true }).click();

    await publicItem.click();
    await expect(page.getByTestId('channel-view')).toHaveAttribute('data-channel-key', 'ch:Public');

    await privateItem.click();
    await expect(page.getByTestId('channel-view')).toHaveAttribute('data-channel-key', 'ch:Private');

    // Pin "Private" via its right-click context menu.
    await privateItem.click({ button: 'right' });
    await page.getByTestId('pin-toggle-menu-item').click();
    await expect(privateItem.getByTestId('channel-pin-indicator')).toBeVisible();
  } finally {
    await close();
  }
});
