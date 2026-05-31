import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { launchApp } from './support/launch';

// Boot replay of e2e-channel.json includes a RESP_CHANNEL_INFO for slot 0
// "Public", which marks ch:Public on-device — the composer is gated on
// channelPresence (onDevice), not on channels.json seeding. POST /api/messages
// inserts + broadcasts the optimistic message before TX, so it renders despite
// the replay transport's no-op sendBytes.
const CHANNEL_FIXTURE = join(process.cwd(), 'tests', 'fixtures', 'frames', 'e2e-channel.json');

test('sending a channel message shows it in the conversation', async () => {
  const { page, close } = await launchApp({ fixture: CHANNEL_FIXTURE });
  try {
    const item = page.getByTestId('channel-nav-item').filter({ hasText: 'Public' });
    await item.waitFor({ state: 'attached' });
    if (!(await item.isVisible())) await page.getByText('Channels', { exact: true }).click();
    await item.click();

    const composer = page.getByTestId('message-composer-input');
    await expect(composer).toBeEnabled();
    await composer.fill('hello world');
    await page.getByTestId('message-send-button').click();

    await expect(page.getByTestId('message-row').filter({ hasText: 'hello world' })).toBeVisible();
  } finally {
    await close();
  }
});
