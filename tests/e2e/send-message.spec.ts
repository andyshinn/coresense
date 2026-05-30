import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { launchApp } from './support/launch';

// The renderer gates the composer on the channel being PRESENT ON THE DEVICE
// (ChannelView: composerDisabled = !client || !onDevice, where onDevice =
// channelPresence.has(key)). A channel seeded only into channels.json is NOT
// on-device — presence is populated exclusively from RESP_CHANNEL_INFO frames
// the radio reports during the handshake (session.handleChannelInfo →
// devicePresence.add). The replay transport's sendBytes is a no-op, so the
// handshake's GET_CHANNEL enumeration never elicits responses; the only way to
// make a channel on-device under replay is to REPLAY a RESP_CHANNEL_INFO frame.
//
// So we build a fixture that carries the standard connect frames
// (RESP_DEVICE_INFO 0x0d + RESP_SELF_INFO 0x05) PLUS a RESP_CHANNEL_INFO 0x12
// for slot 0 named "Public". handleChannelInfo upserts that channel, adds it to
// devicePresence, and broadcasts both — enabling the composer for ch:Public.
const DEVICE_INFO =
  '0d0baf280000000031392041707220323032360048656c7465632054313134000000000000000000000000000000000000000000000000000000000076312e31352e30000000000000000000000000000001';
const SELF_INFO =
  '050114161a3d3c6a09f057457bcf0ae5403e5c60072919d193ed8caff58501b7590dd5d508fdcc0109472cfa00012a00bde40d0024f4000007056567726d652e73682048616e64';
// RESP_CHANNEL_INFO: [0x12][idx=0][name "Public" in 32B][16B key].
const CHANNEL_INFO_PUBLIC =
  '12005075626c6963000000000000000000000000000000000000000000000000000000112233445566778899aabbccddeeff';

test('sending a channel message shows it in the conversation', async () => {
  const fixtureDir = mkdtempSync(join(tmpdir(), 'coresense-e2e-fixture-'));
  const fixturePath = join(fixtureDir, 'connect-with-channel.json');
  writeFileSync(
    fixturePath,
    JSON.stringify([{ hex: DEVICE_INFO }, { hex: SELF_INFO }, { hex: CHANNEL_INFO_PUBLIC }]),
  );

  const { page, close } = await launchApp({ fixture: fixturePath });
  try {
    // Drive the replayed connect through the fully-wired pipeline (the boot-time
    // replay races ahead of the server/protocol-session subscriptions; see
    // connect-replay.spec.ts). This connect emits transportState('connected'),
    // re-dispatches the fixture frames, and handleChannelInfo marks ch:Public
    // on-device — which is what enables the composer.
    await page.evaluate(async () => {
      const cs = (window as { coresense?: { httpPort: number; apiKey: string } }).coresense;
      if (!cs) throw new Error('window.coresense missing — not the Electron window');
      const res = await fetch(`http://127.0.0.1:${cs.httpPort}/api/transport/connect`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${cs.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceId: 'replay' }),
      });
      if (!res.ok) throw new Error(`connect failed: ${res.status} ${await res.text()}`);
    });

    const item = page.getByTestId('channel-nav-item').filter({ hasText: 'Public' });
    // The channel arrives via the async channels broadcast — wait for the row to
    // attach, then expand the Channels group only if it's genuinely hidden (a
    // blind toggle would collapse the default-open group).
    await item.waitFor({ state: 'attached' });
    if (!(await item.isVisible())) await page.getByText('Channels', { exact: true }).click();
    await item.click();

    // Composer is enabled only once ch:Public is on-device; wait it out.
    const composer = page.getByTestId('message-composer-input');
    await expect(composer).toBeEnabled();
    await composer.fill('hello world');
    await page.getByTestId('message-send-button').click();

    await expect(page.getByTestId('message-row').filter({ hasText: 'hello world' })).toBeVisible();
  } finally {
    await close();
  }
});
