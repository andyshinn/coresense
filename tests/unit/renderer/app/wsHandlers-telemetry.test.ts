import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../src/renderer/lib/notify', () => ({
  notify: { success: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

import { createWsMessageHandler } from '../../../../src/renderer/app/wsHandlers';
import { notify } from '../../../../src/renderer/lib/notify';
import { useStore } from '../../../../src/renderer/lib/store';
import type { SavedRequestDto } from '../../../../src/shared/telemetry/types';
import type { WsMessage } from '../../../../src/shared/types';

const A = 'a'.repeat(64);

const saved: SavedRequestDto = {
  id: 'r1',
  nodeKey: A,
  source: 'repeater',
  requestedAt: 1000,
  repliedAt: null,
  outcome: 'timeout',
  error: 'timeout',
  roundTripMs: null,
  hops: null,
  route: 'flood',
  aclRole: null,
  permsGranted: null,
  rawHex: null,
  readings: [],
  restHex: '',
};

const handle = createWsMessageHandler({ setSystemDark: () => {}, handleMenuAction: () => {} });

beforeEach(() => {
  vi.clearAllMocks();
  useStore.setState({ telemetryByNode: {}, telemetryLoaded: {}, telemetryInFlight: [], telemetrySelectedId: {} });
});

describe('ws telemetry handlers', () => {
  it('telemetrySaved adds the request to its node, without a toast', () => {
    handle({ type: 'telemetrySaved', payload: { request: saved } });
    expect(useStore.getState().telemetryByNode[A]).toEqual([saved]);
    expect(notify.success).not.toHaveBeenCalled();
    expect(notify.error).not.toHaveBeenCalled();
  });

  it('telemetryDeleted removes the ids', () => {
    handle({ type: 'telemetrySaved', payload: { request: saved } });
    handle({ type: 'telemetrySaved', payload: { request: { ...saved, id: 'r2', requestedAt: 2000 } } });
    handle({ type: 'telemetryDeleted', payload: { nodeKey: A, ids: ['r1'] } });
    expect(useStore.getState().telemetryByNode[A].map((r) => r.id)).toEqual(['r2']);
  });

  it('telemetryInFlight replaces the pending snapshot', () => {
    const inFlight = [{ nodeKey: A, source: 'repeater' as const, startedAt: 5, deadlineAt: 20_005 }];
    handle({ type: 'telemetryInFlight', payload: { inFlight } });
    expect(useStore.getState().telemetryInFlight).toEqual(inFlight);
    handle({ type: 'telemetryInFlight', payload: { inFlight: [] } });
    expect(useStore.getState().telemetryInFlight).toEqual([]);
  });

  it('ignores the legacy repeaterTelemetry push', () => {
    const before = useStore.getState();
    handle({
      type: 'repeaterTelemetry',
      payload: { contactKey: `c:${A}`, receivedAt: 1, payloadHex: '', fields: [] },
    } as unknown as WsMessage);
    expect(useStore.getState()).toBe(before);
  });
});
