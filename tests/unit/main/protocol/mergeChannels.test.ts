import { describe, expect, it } from 'vitest';
import { mergeSyncedChannels } from '../../../../src/main/protocol/mergeChannels';
import type { Channel } from '../../../../src/shared/types';

// The radio (meshcore-ts) enumerates channels carrying only radio-owned fields
// (key/name/kind/secretHex/idx). coresense adds app-owned fields (order/muted/
// pinned) that the lib never sends. `mergeSyncedChannels` reconciles a fresh
// radio list with the persisted list so a sync never wipes app state.
describe('mergeSyncedChannels', () => {
  it('seeds order from the radio slot idx when a channel is first seen', () => {
    // Bug #2: with no seeded order every channel collapses to alphabetical.
    const incoming: Channel[] = [
      { key: 'ch:Zulu', name: 'Zulu', kind: 'private', idx: 0 },
      { key: 'ch:Alpha', name: 'Alpha', kind: 'private', idx: 1 },
    ];

    const merged = mergeSyncedChannels([], incoming);

    expect(merged.find((c) => c.key === 'ch:Zulu')?.order).toBe(0);
    expect(merged.find((c) => c.key === 'ch:Alpha')?.order).toBe(1);
  });

  it('preserves an existing order across a re-sync (incoming carries no order)', () => {
    // Bug #1: a drag-reorder writes order; the next sync must not erase it.
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

  it('drops channels no longer present on the radio', () => {
    const prev: Channel[] = [{ key: 'ch:Gone', name: 'Gone', kind: 'private', idx: 0, order: 0 }];
    const incoming: Channel[] = [{ key: 'ch:Alpha', name: 'Alpha', kind: 'private', idx: 0 }];

    const merged = mergeSyncedChannels(prev, incoming);

    expect(merged.map((c) => c.key)).toEqual(['ch:Alpha']);
  });
});
