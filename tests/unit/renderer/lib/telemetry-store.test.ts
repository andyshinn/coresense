import { beforeEach, describe, expect, it } from 'vitest';
import { useStore } from '../../../../src/renderer/lib/store';
import type { SavedRequestDto, TelemetryInFlight } from '../../../../src/shared/telemetry/types';
import { type AppSettings, DEFAULT_APP_SETTINGS, type StateSnapshot } from '../../../../src/shared/types';

const A = 'a'.repeat(64);
const B = 'b'.repeat(64);

function req(id: string, requestedAt: number, over: Partial<SavedRequestDto> = {}): SavedRequestDto {
  return {
    id,
    nodeKey: A,
    source: 'repeater',
    requestedAt,
    repliedAt: requestedAt + 1000,
    outcome: 'ok',
    roundTripMs: 1000,
    hops: 1,
    route: 'direct',
    aclRole: 'admin',
    permsGranted: 0x07,
    rawHex: '017401a9',
    readings: [{ ch: 1, typeId: 116, offset: 0, len: 4, value: 4.25 }],
    restHex: '',
    ...over,
  };
}

function withRetention(keep: number): AppSettings {
  return { ...DEFAULT_APP_SETTINGS, telemetry: { retentionPerNode: keep } };
}

const ids = (key: string) => (useStore.getState().telemetryByNode[key] ?? []).map((r) => r.id);

beforeEach(() => {
  useStore.setState({
    appSettings: DEFAULT_APP_SETTINGS,
    telemetryByNode: {},
    telemetryLoaded: {},
    telemetryInFlight: [],
    telemetrySelectedId: {},
    telemetryCompare: {},
    telemetryFetchLedger: {},
  });
});

describe('setTelemetryList', () => {
  it('stores newest first under the bare key and marks the node loaded', () => {
    useStore.getState().setTelemetryList(`c:${A.toUpperCase()}`, [req('old', 1), req('new', 3), req('mid', 2)]);
    expect(ids(A)).toEqual(['new', 'mid', 'old']);
    expect(useStore.getState().telemetryLoaded[A]).toBe(true);
  });

  it('keeps a save pushed while the GET was in flight, but drops older rows the server no longer has', () => {
    const s = useStore.getState();
    s.setTelemetryList(A, [req('gone', 1), req('r2', 2)]);
    s.beginTelemetryFetch(A);
    // Pushed during a refetch: newer than anything the stale response holds.
    s.applyTelemetrySaved(req('r4', 4));
    s.setTelemetryList(A, [req('r3', 3), req('r2', 2)]);
    expect(ids(A)).toEqual(['r4', 'r3', 'r2']);
    expect(useStore.getState().telemetryFetchLedger[A]).toBeUndefined();
  });

  it('drops a held row the server deleted while we missed the push, however new it is', () => {
    const s = useStore.getState();
    s.setTelemetryList(A, [req('r1', 1), req('r2', 2)]);
    // r2 was deleted elsewhere and the telemetryDeleted push never arrived.
    s.beginTelemetryFetch(A);
    s.setTelemetryList(A, [req('r1', 1)]);
    expect(ids(A)).toEqual(['r1']);
  });

  it('keeps a delete pushed while the GET ran, even though the stale response still has the row', () => {
    const s = useStore.getState();
    s.setTelemetryList(A, [req('r1', 1), req('r2', 2)]);
    s.beginTelemetryFetch(A);
    s.applyTelemetryDeleted({ nodeKey: A, ids: ['r2'] });
    s.setTelemetryList(A, [req('r1', 1), req('r2', 2)]);
    expect(ids(A)).toEqual(['r1']);
  });

  it('keeps a clear pushed while the GET ran, and only the saves pushed after it', () => {
    const s = useStore.getState();
    s.setTelemetryList(A, [req('r1', 1)]);
    s.beginTelemetryFetch(A);
    s.applyTelemetrySaved(req('r2', 2));
    s.applyTelemetryDeleted({ nodeKey: A, ids: 'all' });
    s.applyTelemetrySaved(req('r3', 3));
    s.setTelemetryList(A, [req('r2', 2), req('r1', 1)]);
    expect(ids(A)).toEqual(['r3']);
  });

  it('drops a selection and compare ids the fresh list no longer holds', () => {
    const s = useStore.getState();
    s.setTelemetryList(A, [req('r1', 1), req('r2', 2)]);
    s.setTelemetrySelected(A, 'r1');
    s.setTelemetryCompare(A, ['r2', 'r1']);
    s.setTelemetryList(A, [req('r2', 2)]);
    expect(useStore.getState().telemetrySelectedId[A]).toBeUndefined();
    expect(useStore.getState().telemetryCompare[A]).toEqual(['r2']);
  });
});

describe('applyTelemetrySaved', () => {
  it('holds a pushed save for a node that was never loaded, without marking it loaded', () => {
    useStore.getState().applyTelemetrySaved(req('r1', 1));
    expect(ids(A)).toEqual(['r1']);
    expect(useStore.getState().telemetryLoaded[A]).toBeUndefined();
  });

  it('inserts in requestedAt order and replaces a request with the same id', () => {
    const s = useStore.getState();
    s.setTelemetryList(A, [req('r1', 1), req('r3', 3)]);
    s.applyTelemetrySaved(req('r2', 2));
    s.applyTelemetrySaved(req('r3', 3, { outcome: 'timeout' }));
    expect(ids(A)).toEqual(['r3', 'r2', 'r1']);
    expect(useStore.getState().telemetryByNode[A][0].outcome).toBe('timeout');
  });

  it('leaves other nodes untouched (same list reference)', () => {
    const s = useStore.getState();
    s.setTelemetryList(B, [req('b1', 1, { nodeKey: B })]);
    const before = useStore.getState().telemetryByNode[B];
    s.applyTelemetrySaved(req('a1', 2));
    expect(useStore.getState().telemetryByNode[B]).toBe(before);
  });

  it('clears the pinned selection so the new request shows', () => {
    const s = useStore.getState();
    s.setTelemetryList(A, [req('r1', 1), req('r2', 2)]);
    s.setTelemetrySelected(A, 'r1');
    s.applyTelemetrySaved(req('r3', 3));
    expect(useStore.getState().telemetrySelectedId[A]).toBeUndefined();
  });

  it('caps the list at the retention setting, dropping pruned ids from compare', () => {
    useStore.setState({ appSettings: withRetention(2) });
    const s = useStore.getState();
    s.setTelemetryList(A, [req('r1', 1), req('r2', 2)]);
    s.setTelemetryCompare(A, ['r2', 'r1']);
    s.applyTelemetrySaved(req('r3', 3));
    expect(ids(A)).toEqual(['r3', 'r2']);
    expect(useStore.getState().telemetryCompare[A]).toEqual(['r2']);
  });
});

describe('applyTelemetryDeleted', () => {
  it('removes listed ids and falls back to the newest when the selected one went', () => {
    const s = useStore.getState();
    s.setTelemetryList(A, [req('r1', 1), req('r2', 2), req('r3', 3)]);
    s.setTelemetrySelected(A, 'r2');
    s.setTelemetryCompare(A, ['r3', 'r2']);
    s.applyTelemetryDeleted({ nodeKey: A, ids: ['r2'] });
    expect(ids(A)).toEqual(['r3', 'r1']);
    expect(useStore.getState().telemetrySelectedId[A]).toBeUndefined();
    expect(useStore.getState().telemetryCompare[A]).toEqual(['r3']);
  });

  it('keeps a selection that survived', () => {
    const s = useStore.getState();
    s.setTelemetryList(A, [req('r1', 1), req('r2', 2)]);
    s.setTelemetrySelected(A, 'r1');
    s.applyTelemetryDeleted({ nodeKey: A, ids: ['r2'] });
    expect(useStore.getState().telemetrySelectedId[A]).toBe('r1');
  });

  it("'all' empties the node, leaves compare mode and counts as loaded", () => {
    const s = useStore.getState();
    s.applyTelemetrySaved(req('r1', 1));
    s.setTelemetrySelected(A, 'r1');
    s.setTelemetryCompare(A, ['r1']);
    s.applyTelemetryDeleted({ nodeKey: A, ids: 'all' });
    const st = useStore.getState();
    expect(st.telemetryByNode[A]).toEqual([]);
    expect(st.telemetryLoaded[A]).toBe(true);
    expect(st.telemetrySelectedId[A]).toBeUndefined();
    expect(st.telemetryCompare[A]).toBeUndefined();
  });

  it('is a no-op list-wise for a node that was never loaded', () => {
    useStore.getState().applyTelemetryDeleted({ nodeKey: A, ids: ['x'] });
    expect(useStore.getState().telemetryByNode[A]).toBeUndefined();
  });
});

describe('telemetry in-flight', () => {
  const pending: TelemetryInFlight = { nodeKey: A, source: 'repeater', startedAt: 10, deadlineAt: null };

  it('replaces the whole snapshot on each push', () => {
    const s = useStore.getState();
    s.applyTelemetryInFlight([pending, { ...pending, nodeKey: B }]);
    s.applyTelemetryInFlight([{ ...pending, deadlineAt: 20 }]);
    expect(useStore.getState().telemetryInFlight).toEqual([{ ...pending, deadlineAt: 20 }]);
  });

  it('hydrates from the snapshot (and from an older main without the field) and resets loaded', () => {
    const s = useStore.getState();
    s.setTelemetryList(A, [req('r1', 1)]);
    // Only what hydrate dereferences; no telemetryInFlight, as an older main sends.
    const older = {
      transport: { state: 'idle' },
      channels: [],
      contacts: [],
      messages: [],
      blockRules: [],
      radioSettings: useStore.getState().radioSettings,
      appSettings: DEFAULT_APP_SETTINGS,
      uiState: useStore.getState().ui,
    } as unknown as StateSnapshot;
    s.hydrate({ ...older, telemetryInFlight: [pending] });
    expect(useStore.getState().telemetryInFlight).toEqual([pending]);
    expect(useStore.getState().telemetryLoaded).toEqual({});
    // The held list stays, so a mounted panel doesn't flash empty while it refetches.
    expect(ids(A)).toEqual(['r1']);
    s.hydrate(older);
    expect(useStore.getState().telemetryInFlight).toEqual([]);
  });
});

describe('resyncTelemetry (WS reconnect)', () => {
  it('replaces the in-flight snapshot and marks every node for a refetch, keeping the held lists', () => {
    const s = useStore.getState();
    s.setTelemetryList(A, [req('r1', 1)]);
    s.applyTelemetryInFlight([{ nodeKey: A, source: 'repeater', startedAt: 1, deadlineAt: null }]);
    // The final empty push was lost while the socket was down.
    s.resyncTelemetry([]);
    expect(useStore.getState().telemetryInFlight).toEqual([]);
    expect(useStore.getState().telemetryLoaded).toEqual({});
    expect(ids(A)).toEqual(['r1']);
  });
});

describe('selection and compare', () => {
  it('setTelemetrySelected stores per node; null clears', () => {
    const s = useStore.getState();
    s.setTelemetrySelected(`c:${A}`, 'r1');
    s.setTelemetrySelected(B, 'b1');
    expect(useStore.getState().telemetrySelectedId).toEqual({ [A]: 'r1', [B]: 'b1' });
    s.setTelemetrySelected(A, null);
    expect(useStore.getState().telemetrySelectedId).toEqual({ [B]: 'b1' });
  });

  it('setTelemetryCompare dedupes, caps at 6 and null leaves compare mode', () => {
    const s = useStore.getState();
    s.setTelemetryCompare(A, ['1', '2', '2', '3', '4', '5', '6', '7']);
    expect(useStore.getState().telemetryCompare[A]).toEqual(['1', '2', '3', '4', '5', '6']);
    s.setTelemetryCompare(A, []);
    expect(useStore.getState().telemetryCompare[A]).toEqual([]);
    s.setTelemetryCompare(A, null);
    expect(A in useStore.getState().telemetryCompare).toBe(false);
  });

  it('toggleTelemetryCompare ticks, unticks and ignores a 7th column', () => {
    const s = useStore.getState();
    for (const id of ['1', '2', '3', '4', '5', '6']) s.toggleTelemetryCompare(A, id);
    s.toggleTelemetryCompare(A, '7');
    expect(useStore.getState().telemetryCompare[A]).toEqual(['1', '2', '3', '4', '5', '6']);
    s.toggleTelemetryCompare(A, '3');
    expect(useStore.getState().telemetryCompare[A]).toEqual(['1', '2', '4', '5', '6']);
  });
});

describe('retention change', () => {
  it('trims held lists when retention shrinks, and leaves them when it grows', () => {
    useStore.setState({ appSettings: withRetention(5) });
    const s = useStore.getState();
    s.setTelemetryList(A, [req('r1', 1), req('r2', 2), req('r3', 3)]);
    s.setTelemetrySelected(A, 'r1');
    s.applyAppSettings(withRetention(2));
    expect(ids(A)).toEqual(['r3', 'r2']);
    expect(useStore.getState().telemetrySelectedId[A]).toBeUndefined();
    const held = useStore.getState().telemetryByNode;
    s.applyAppSettings(withRetention(10));
    expect(useStore.getState().telemetryByNode).toBe(held);
  });
});

describe('RepeaterAdminTab', () => {
  it("accepts the 'telemetry' deep link", () => {
    useStore.getState().setRepeaterAdminTab('telemetry');
    expect(useStore.getState().repeaterAdminTab).toBe('telemetry');
    useStore.getState().setRepeaterAdminTab(null);
  });
});
