import { expect, test } from '@playwright/test';
import { launchApp } from './support/launch';

test('replayed connect session populates connection + owner in the UI', async () => {
  // Boot-time replay (default e2e-connect fixture) emits transportState('connected')
  // and RESP_SELF_INFO through the fully-wired pipeline.
  const { page, close } = await launchApp();
  try {
    // The footer leaves its "Not connected" empty-state once connected. It does
    // NOT settle on a literal "Connected": the post-connect handshake shows
    // "Syncing N/M", which never finishes because the fixture carries no sync
    // responses. "not Not connected" is the stable connected signal.
    await expect(page.getByTestId('connection-status-footer')).not.toContainText('Not connected');
    // RESP_SELF_INFO carries the advert name "egrme.sh Hand".
    await expect(page.getByTestId('owner-name')).toHaveText('egrme.sh Hand');
  } finally {
    await close();
  }
});
