import type { ITransport } from './types';

interface TransportSink {
  setTransport(t: ITransport): void;
}

/**
 * Choose and install the startup transport from the environment. When
 * CORESENSE_FAKE_TRANSPORT names a replay fixture, install the env-gated
 * FileReplayTransport and kick off replay; otherwise install the real
 * BleTransport. Both modules load via dynamic import so the unused path's
 * native deps (noble for BLE) never load.
 */
export async function installStartupTransport(
  env: NodeJS.ProcessEnv,
  manager: TransportSink,
): Promise<ITransport> {
  const fixture = env.CORESENSE_FAKE_TRANSPORT;
  if (fixture) {
    const { FileReplayTransport } = await import('./replay');
    const transport = new FileReplayTransport(fixture);
    manager.setTransport(transport);
    // Kick off replay immediately — there is no UI "connect" step in E2E.
    void transport.connect('replay');
    return transport;
  }
  const { BleTransport } = await import('./ble');
  const transport = new BleTransport();
  manager.setTransport(transport);
  return transport;
}
