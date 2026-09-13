import { afterEach, describe, expect, it } from 'vitest';
import { createRoutes } from '../../../src/main/api/routes';
import { bus } from '../../../src/main/events/bus';
import { stateHolder } from '../../../src/main/state/holder';
import { packetStore } from '../../../src/main/storage/packets';
import { DEFAULT_PACKET_LOG_SETTINGS, DEFAULT_UI_STATE, PACKET_LOG_BOUNDS, type UiState } from '../../../src/shared/types';

function app() {
  return createRoutes({
    port: () => 8080,
    wsClients: () => 0,
    bridgeStatus: () => ({ running: false, clients: 0 }) as never,
  });
}

const put = (body: unknown) =>
  app().request('/api/ui-state', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

let off: (() => void) | null = null;
afterEach(() => {
  off?.();
  off = null;
});

// packetLog sizes main's packets-table prune and is adopted by every client's
// applyUiState, so main must never store or broadcast a missing/garbage value.
describe('PUT /api/ui-state normalises packetLog', () => {
  it('replaces a null packetLog with defaults in both the holder and the broadcast', async () => {
    const broadcast: UiState[] = [];
    const onUi = (u: UiState) => broadcast.push(u);
    bus.on('uiState', onUi);
    off = () => bus.off('uiState', onUi);

    const res = await put({ ...DEFAULT_UI_STATE, packetLog: null });

    expect(res.status).toBe(200);
    expect(stateHolder().getUiState().packetLog).toEqual(DEFAULT_PACKET_LOG_SETTINGS);
    expect(broadcast.at(-1)?.packetLog).toEqual(DEFAULT_PACKET_LOG_SETTINGS);
  });

  it('clamps out-of-range retention a client sent', async () => {
    await put({ ...DEFAULT_UI_STATE, packetLog: { liveBufferSize: 1, storedHistorySize: 1e12 } });
    expect(stateHolder().getUiState().packetLog).toEqual({
      liveBufferSize: PACKET_LOG_BOUNDS.liveBufferSize.min,
      storedHistorySize: PACKET_LOG_BOUNDS.storedHistorySize.max,
    });
  });

  it("keeps the current retention when a client's ui-state omits packetLog", async () => {
    await put({ ...DEFAULT_UI_STATE, packetLog: { liveBufferSize: 5000, storedHistorySize: 90000 } });
    const { packetLog: _omitted, ...legacy } = DEFAULT_UI_STATE;
    await put(legacy);
    expect(stateHolder().getUiState().packetLog).toEqual({ liveBufferSize: 5000, storedHistorySize: 90000 });
  });

  it('prunes stored packets as soon as stored history is lowered, including to 0', async () => {
    await put({ ...DEFAULT_UI_STATE, packetLog: { liveBufferSize: 2000, storedHistorySize: 1000 } });
    const pkt = { transportType: 'ble', kind: 'mesh', hex: '88', bytes: [], payloadHex: '15', payloadBytes: [] } as const;
    for (let i = 0; i < 3; i++) packetStore.record({ ...pkt, timestamp: i, bytes: [], payloadBytes: [] }, 1000);

    await put({ ...DEFAULT_UI_STATE, packetLog: { liveBufferSize: 2000, storedHistorySize: 0 } });
    expect(packetStore.recent(10)).toEqual([]);
  });
});
