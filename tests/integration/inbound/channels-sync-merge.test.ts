import { describe, expect, it } from 'vitest';
import { stateHolder } from '../../../src/main/state/holder';
import type { Channel } from '../../../src/shared/types';
import { captureBus } from '../../support/bus';
import { makeTestSession } from '../../support/session-harness';

// End-to-end wiring of the `channels` sync handler (adapterEvents.ts): a fresh
// radio enumeration carries idx but never coresense's app-only `order`. The
// handler must seed `order` from `idx` on first sight and preserve a user's
// drag-reorder across later syncs instead of wholesale-replacing the list.
const radioChannels: Channel[] = [
  { key: 'ch:Zulu', name: 'Zulu', kind: 'private', idx: 0 },
  { key: 'ch:Alpha', name: 'Alpha', kind: 'private', idx: 1 },
];

describe('channels sync merge (handler → holder → bus)', () => {
  it('seeds order from idx on first sync, then keeps a reorder across a re-sync', () => {
    const { adapter } = makeTestSession();
    const holder = stateHolder();
    holder.setChannels([]); // clean slate for a deterministic assertion

    const emitted = captureBus('channels');

    // First sync: order seeded from the radio slot idx (Bug #1 — otherwise the
    // LeftNav falls back to alphabetical, which would put Alpha before Zulu).
    adapter.session.events.emit('channels', radioChannels);
    const first = emitted.last();
    expect(first?.find((c) => c.key === 'ch:Zulu')?.order).toBe(0);
    expect(first?.find((c) => c.key === 'ch:Alpha')?.order).toBe(1);

    // User drags Alpha above Zulu (as /api/channels/reorder rewrites order).
    holder.setChannels(holder.getChannels().map((c) => ({ ...c, order: c.key === 'ch:Alpha' ? 0 : 1 })));

    // Re-sync: the radio re-enumerates without order. The manual order must
    // survive (Bug #2 — a wholesale replace would erase it).
    adapter.session.events.emit('channels', radioChannels);
    const second = emitted.last();
    expect(second?.find((c) => c.key === 'ch:Alpha')?.order).toBe(0);
    expect(second?.find((c) => c.key === 'ch:Zulu')?.order).toBe(1);
  });

  it('keeps muted through an incremental re-enumeration on reconnect (restart)', () => {
    const { adapter } = makeTestSession();
    const holder = stateHolder();
    // State as loaded from disk on restart: both channels muted + hand-ordered.
    holder.setChannels([
      { key: 'ch:Zulu', name: 'Zulu', kind: 'private', idx: 0, order: 0, muted: true },
      { key: 'ch:Alpha', name: 'Alpha', kind: 'private', idx: 1, order: 1, muted: true },
    ]);

    const emitted = captureBus('channels');

    // The lib emits `channels` once per RESP_CHANNEL_INFO with the cumulative
    // list, so on reconnect it re-enumerates one channel at a time.
    adapter.session.events.emit('channels', [{ key: 'ch:Zulu', name: 'Zulu', kind: 'private', idx: 0 }]);
    adapter.session.events.emit('channels', [
      { key: 'ch:Zulu', name: 'Zulu', kind: 'private', idx: 0 },
      { key: 'ch:Alpha', name: 'Alpha', kind: 'private', idx: 1 },
    ]);

    const final = emitted.last();
    // Alpha was dropped from the first (partial) emit — its muted must survive.
    expect(final?.find((c) => c.key === 'ch:Zulu')?.muted).toBe(true);
    expect(final?.find((c) => c.key === 'ch:Alpha')?.muted).toBe(true);
  });
});
