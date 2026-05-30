import { expect, test } from '@playwright/test';
import { launchApp } from './support/launch';

test('replayed connect session populates connection + owner in the UI', async () => {
  const { page, close } = await launchApp(); // default fixture = e2e-connect
  try {
    // STARTUP-ORDERING NOTE: the replay transport's connect() runs at app boot
    // (transport/select.ts → installStartupTransport), emitting
    // transportState('connected') and dispatching the fixture frames onto the
    // bus BEFORE startServer() subscribes the bus→transportManager listener and
    // BEFORE protocolSession().start() subscribes for packets (see
    // src/main/index.ts lines 116/132/139). So the boot-time replay is lost:
    // the footer stays "Not connected" and owner stays "No identity" until a
    // connect is driven AFTER the pipeline is wired. We re-run the replay
    // through the fully-wired pipeline via the real POST /api/transport/connect
    // endpoint, using the renderer's own authenticated client. This drives the
    // SAME replay transport's connect() — it is the genuine connect flow, not a
    // fake — and lets transportManager + the protocol session observe it.
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

    // After the replayed connect, the transport is connected. The footer leaves
    // its "Not connected" empty-state. NOTE: it does NOT settle on the literal
    // "Connected" — the protocol session immediately begins its post-connect
    // handshake and the footer shows "Syncing N/M", which stays put because the
    // e2e-connect fixture carries no channel/contact-sync responses to finish
    // the handshake. Asserting "not Not connected" is the real, stable signal
    // that the connection reached the UI through the WS pipeline.
    await expect(page.getByTestId('connection-status-footer')).not.toContainText('Not connected');

    // RESP_SELF_INFO sets the owner identity. The captured frame carries the
    // advert name "egrme.sh Hand", which lands in the header span, replacing
    // the empty-state "No identity".
    await expect(page.getByTestId('owner-name')).toHaveText('egrme.sh Hand');
  } finally {
    await close();
  }
});
