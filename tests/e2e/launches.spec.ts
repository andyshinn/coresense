import { expect, test } from '@playwright/test';
import { launchApp } from './support/launch';

test('app launches and renders the main shell', async () => {
  const { page, close } = await launchApp();
  try {
    // The LeftNav carries aria-label="Primary navigation" and is always
    // present once the three-pane shell mounts.
    await expect(page.locator('[aria-label="Primary navigation"]')).toBeVisible();
  } finally {
    await close();
  }
});
