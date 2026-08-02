import { describe, expect, it } from 'vitest';
import { openDb } from '../../../src/main/storage/db';
import { rebuildConversationsIndex } from '../../../src/main/storage/search';
import type { Contact } from '../../../src/shared/types';

// rebuildConversationsIndex wipes and repopulates conversations_fts. If the
// wipe is not part of the same transaction as the repopulate, a rebuild that
// throws partway leaves the index EMPTY — and the caller (holder.persistNow)
// has already cleared its dirty flag, so it is never rebuilt for the session.
// The rebuild must be atomic: a failure leaves the prior index intact.

const pk = (i: number): string => i.toString(16).padStart(64, '0');

const contact = (name: string, i: number): Contact => ({
  key: `c:${i}`,
  publicKeyHex: pk(i),
  name,
  kind: 'chat',
});

function ftsCount(): number {
  const row = openDb().prepare(`SELECT COUNT(*) AS n FROM conversations_fts`).get() as { n: number };
  return row.n;
}

describe('rebuildConversationsIndex atomicity', () => {
  it('preserves the existing index when a rebuild fails partway', () => {
    rebuildConversationsIndex({ channels: [], contacts: [contact('Alice', 1)] });
    expect(ftsCount()).toBe(1);

    // A contact whose name is not a string makes the FTS insert throw mid-loop,
    // after the first (good) contact has already been inserted.
    const bad = { ...contact('X', 3), name: {} as unknown as string } as Contact;
    expect(() => rebuildConversationsIndex({ channels: [], contacts: [contact('Bob', 2), bad] })).toThrow();

    // The failed rebuild must not have wiped the prior index.
    expect(ftsCount()).toBe(1);
  });
});
