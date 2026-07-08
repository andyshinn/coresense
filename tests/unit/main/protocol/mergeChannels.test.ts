import { describe, expect, it } from 'vitest';
import { mergeSyncedChannels } from '../../../../src/main/protocol/mergeChannels';
import type { Channel } from '../../../../src/shared/types';

// The radio (meshcore-ts) enumerates channels carrying only radio-owned fields
// (key/name/kind/secretHex/idx). coresense adds app-owned fields (order/muted/
// pinned) that the lib never sends. `mergeSyncedChannels` reconciles a fresh
// radio list with the persisted list so a sync never wipes app state.
describe('mergeSyncedChannels', () => {
  it('seeds order from the radio slot idx when a channel is first seen', () => {
    // Bug #1: with no seeded order every channel collapses to alphabetical.
    const incoming: Channel[] = [
      { key: 'ch:Zulu', name: 'Zulu', kind: 'private', idx: 0 },
      { key: 'ch:Alpha', name: 'Alpha', kind: 'private', idx: 1 },
    ];

    const merged = mergeSyncedChannels([], incoming);

    expect(merged.find((c) => c.key === 'ch:Zulu')?.order).toBe(0);
    expect(merged.find((c) => c.key === 'ch:Alpha')?.order).toBe(1);
  });

  it('preserves an existing order across a re-sync (incoming carries no order)', () => {
    // Bug #2: a drag-reorder writes order; the next sync must not erase it.
    const prev: Channel[] = [
      { key: 'ch:Alpha', name: 'Alpha', kind: 'private', idx: 1, order: 0 },
      { key: 'ch:Zulu', name: 'Zulu', kind: 'private', idx: 0, order: 1 },
    ];
    const incoming: Channel[] = [
      { key: 'ch:Zulu', name: 'Zulu', kind: 'private', idx: 0 },
      { key: 'ch:Alpha', name: 'Alpha', kind: 'private', idx: 1 },
    ];

    const merged = mergeSyncedChannels(prev, incoming);

    expect(merged.find((c) => c.key === 'ch:Alpha')?.order).toBe(0);
    expect(merged.find((c) => c.key === 'ch:Zulu')?.order).toBe(1);
  });

  it('preserves app-owned muted/pinned flags across a re-sync', () => {
    const prev: Channel[] = [{ key: 'ch:Alpha', name: 'Alpha', kind: 'private', idx: 0, muted: true, pinned: true }];
    const incoming: Channel[] = [{ key: 'ch:Alpha', name: 'Alpha', kind: 'private', idx: 0 }];

    const merged = mergeSyncedChannels(prev, incoming);

    expect(merged[0]?.muted).toBe(true);
    expect(merged[0]?.pinned).toBe(true);
  });

  it('takes radio-owned fields (name/idx) from the incoming list', () => {
    // Channel renamed / moved slot on the device: the radio wins for its fields.
    const prev: Channel[] = [{ key: 'ch:Alpha', name: 'OldName', kind: 'private', idx: 3, order: 0 }];
    const incoming: Channel[] = [{ key: 'ch:Alpha', name: 'NewName', kind: 'private', idx: 5 }];

    const merged = mergeSyncedChannels(prev, incoming);

    expect(merged[0]?.name).toBe('NewName');
    expect(merged[0]?.idx).toBe(5);
    expect(merged[0]?.order).toBe(0); // app-owned order still preserved
  });

  it('retains an app-stored channel the radio did not enumerate this pass', () => {
    // The lib emits `channels` incrementally (one cumulative list per
    // RESP_CHANNEL_INFO), and coresense also keeps app-only channels (e.g. after
    // "remove from device", idx cleared). A sync that omits a channel must NOT
    // drop it — membership is owned by explicit DELETE, not by a sync. Otherwise
    // the omitted channel loses its muted/order (Bug: muting broken on restart).
    const prev: Channel[] = [
      { key: 'ch:Alpha', name: 'Alpha', kind: 'private', idx: 0, order: 0 },
      { key: 'ch:Beta', name: 'Beta', kind: 'private', order: 3, muted: true },
    ];
    const incoming: Channel[] = [{ key: 'ch:Alpha', name: 'Alpha', kind: 'private', idx: 0 }];

    const merged = mergeSyncedChannels(prev, incoming);

    const beta = merged.find((c) => c.key === 'ch:Beta');
    expect(beta).toBeDefined();
    expect(beta?.muted).toBe(true);
    expect(beta?.order).toBe(3);
  });

  it('preserves muted/order through an incremental sync burst (restart scenario)', () => {
    // Simulate a reconnect where the radio re-enumerates channels one at a time.
    // Both channels were muted and hand-ordered before the restart.
    const persisted: Channel[] = [
      { key: 'ch:Alpha', name: 'Alpha', kind: 'private', idx: 0, order: 1, muted: true },
      { key: 'ch:Beta', name: 'Beta', kind: 'private', idx: 1, order: 0, muted: true },
    ];
    const firstEmit: Channel[] = [{ key: 'ch:Alpha', name: 'Alpha', kind: 'private', idx: 0 }];
    const secondEmit: Channel[] = [
      { key: 'ch:Alpha', name: 'Alpha', kind: 'private', idx: 0 },
      { key: 'ch:Beta', name: 'Beta', kind: 'private', idx: 1 },
    ];

    const afterFirst = mergeSyncedChannels(persisted, firstEmit);
    const afterSecond = mergeSyncedChannels(afterFirst, secondEmit);

    const beta = afterSecond.find((c) => c.key === 'ch:Beta');
    const alpha = afterSecond.find((c) => c.key === 'ch:Alpha');
    expect(alpha?.muted).toBe(true);
    expect(alpha?.order).toBe(1);
    expect(beta?.muted).toBe(true);
    expect(beta?.order).toBe(0);
  });
});

const ch = (over: Partial<Channel> = {}): Channel => ({
  key: 'ch:General',
  name: 'General',
  kind: 'hashtag',
  ...over,
});

describe('mergeSyncedChannels createdAt', () => {
  it('stamps createdAt on a first-seen radio channel', () => {
    const before = Date.now();
    const [merged] = mergeSyncedChannels([], [ch()]);
    expect(typeof merged.createdAt).toBe('number');
    expect(merged.createdAt as number).toBeGreaterThanOrEqual(before);
  });

  it('preserves an existing createdAt across a re-sync', () => {
    const prev = [ch({ createdAt: 1000 })];
    const [merged] = mergeSyncedChannels(prev, [ch({ name: 'General renamed' })]);
    expect(merged.createdAt).toBe(1000);
    expect(merged.name).toBe('General renamed'); // radio-owned field still updates
  });

  it('carries a not-re-enumerated channel through untouched', () => {
    const prev = [ch({ key: 'ch:Only', name: 'Only', createdAt: 2000 })];
    const merged = mergeSyncedChannels(prev, []);
    expect(merged).toHaveLength(1);
    expect(merged[0].createdAt).toBe(2000);
  });
});
