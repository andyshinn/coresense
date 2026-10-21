import { describe, expect, it } from 'vitest';
import { telemetryStore } from '../../../src/main/storage/telemetry';
import type { SavedRequest } from '../../../src/shared/telemetry/types';

const NODE_A = 'aa'.repeat(32);
const NODE_B = 'bb'.repeat(32);

let seq = 0;
function req(over: Partial<SavedRequest> = {}): SavedRequest {
  seq += 1;
  return {
    id: `req-${seq}`,
    nodeKey: NODE_A,
    source: 'repeater',
    requestedAt: 1_760_000_000_000 + seq * 1000,
    repliedAt: 1_760_000_000_000 + seq * 1000 + 1800,
    outcome: 'ok',
    roundTripMs: 1800,
    hops: 2,
    route: 'direct',
    aclRole: 'admin',
    permsGranted: 0x07,
    raw: Uint8Array.from([0x01, 0x74, 0x01, 0xa9, 0x00, 0x00]),
    ...over,
  };
}

describe('telemetryStore', () => {
  it('round-trips every field, raw bytes included', () => {
    const r = req({ error: 'nope', outcome: 'error', aclRole: 'readOnly', route: 'flood', hops: null });
    telemetryStore.insert(r, 50);
    expect(telemetryStore.get(r.id)).toEqual(r);
  });

  it('stores a failed request with raw = null and no error field when none was given', () => {
    const r = req({ outcome: 'timeout', repliedAt: null, roundTripMs: null, raw: null });
    telemetryStore.insert(r, 50);
    const back = telemetryStore.get(r.id);
    expect(back?.raw).toBeNull();
    expect(back && 'error' in back).toBe(false);
  });

  it('lists one node newest first, ties broken by insertion order', () => {
    const old = req({ requestedAt: 1000 });
    const tieFirst = req({ requestedAt: 2000 });
    const tieSecond = req({ requestedAt: 2000 });
    const other = req({ nodeKey: NODE_B, requestedAt: 3000 });
    for (const r of [tieFirst, old, tieSecond, other]) telemetryStore.insert(r, 50);
    expect(telemetryStore.list(NODE_A).map((r) => r.id)).toEqual([tieSecond.id, tieFirst.id, old.id]);
  });

  it('prunes the node to `keep` on insert, in the same call, and reports what went', () => {
    const rows = [1, 2, 3].map((n) => req({ requestedAt: n * 1000 }));
    const otherNode = req({ nodeKey: NODE_B, requestedAt: 500 });
    telemetryStore.insert(otherNode, 2);
    expect(telemetryStore.insert(rows[0], 2)).toEqual([]);
    expect(telemetryStore.insert(rows[1], 2)).toEqual([]);
    expect(telemetryStore.insert(rows[2], 2)).toEqual([rows[0].id]);
    expect(telemetryStore.list(NODE_A).map((r) => r.id)).toEqual([rows[2].id, rows[1].id]);
    // Another node's history is untouched by this node's limit.
    expect(telemetryStore.list(NODE_B).map((r) => r.id)).toEqual([otherNode.id]);
  });

  it('pruneAll shrinks every node at once and groups the removed ids per node', () => {
    const a = [1, 2, 3].map((n) => req({ requestedAt: n * 1000 }));
    const b = [1, 2].map((n) => req({ nodeKey: NODE_B, requestedAt: n * 1000 }));
    for (const r of [...a, ...b]) telemetryStore.insert(r, 50);
    const pruned = telemetryStore.pruneAll(1);
    expect(pruned.find((p) => p.nodeKey === NODE_A)?.ids.sort()).toEqual([a[0].id, a[1].id].sort());
    expect(pruned.find((p) => p.nodeKey === NODE_B)?.ids).toEqual([b[0].id]);
    expect(telemetryStore.list(NODE_A).map((r) => r.id)).toEqual([a[2].id]);
    expect(telemetryStore.list(NODE_B).map((r) => r.id)).toEqual([b[1].id]);
    expect(telemetryStore.pruneAll(1)).toEqual([]);
  });

  it('deletes one request, reporting its node, and clears a whole node', () => {
    const one = req();
    const two = req();
    const kept = req({ nodeKey: NODE_B });
    for (const r of [one, two, kept]) telemetryStore.insert(r, 50);
    expect(telemetryStore.delete(one.id)).toEqual({ nodeKey: NODE_A });
    expect(telemetryStore.delete(one.id)).toBeNull();
    expect(telemetryStore.clear(NODE_A)).toBe(1);
    expect(telemetryStore.list(NODE_A)).toEqual([]);
    expect(telemetryStore.get(kept.id)?.id).toBe(kept.id);
  });
});
