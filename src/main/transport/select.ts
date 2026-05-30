import type { ITransport } from './types';

interface TransportSink {
  setTransport(t: ITransport): void;
}

/**
 * Choose and install the startup transport from the environment. When
 * CORESENSE_FAKE_TRANSPORT names a replay fixture, install the env-gated
 * FileReplayTransport; otherwise install the real BleTransport. The transport
 * is installed but NOT connected here — the caller triggers connect() after the
 * bus subscribers are wired, so the replayed transportState/packets have
 * listeners. Both modules load via dynamic import so the unused path's native
 * deps (noble for BLE) never load.
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
    return transport;
  }
  const { BleTransport } = await import('./ble');
  const transport = new BleTransport();
  manager.setTransport(transport);
  return transport;
}
