import { describe, expect, it } from 'vitest';
import { messagesStore } from '../../../src/main/storage/messages';
import { searchMessages } from '../../../src/main/storage/search';
import type { Message } from '../../../src/shared/types';

const CTX = { contacts: [], blockRules: [], regexCache: new Map() };

function seed(n: number): void {
  for (let i = 0; i < n; i++) {
    messagesStore.insert({
      id: `m${i}`,
      key: 'ch:Ops',
      body: `beacon ${i}`,
      ts: 1_700_000_000_000 + i,
      state: 'received',
    } as Message);
  }
}

const search = (limit: unknown, offset?: unknown) =>
  searchMessages({ query: 'beacon', sort: 'recency', limit, offset } as Parameters<typeof searchMessages>[0], CTX);

// Regression: /api/search validates only query and sort, and SQLite reads a
// negative LIMIT as "no limit", so `limit: -1` used to return every matching
// row. Non-numeric values reached the statement as NaN.
describe('search — limit/offset sanitising', () => {
  it('falls back to the default page size for a negative, zero or non-numeric limit', () => {
    seed(120);
    for (const bad of [-1, 0, Number.NaN, 'all']) {
      const r = search(bad);
      expect(r.messages).toHaveLength(100);
      expect(r.total.messages).toBe(120);
    }
  });

  it('honours a valid limit and treats a bad offset as 0', () => {
    seed(5);
    expect(search(2).messages.map((m) => m.id)).toEqual(['m4', 'm3']);
    expect(search(2, -3).messages.map((m) => m.id)).toEqual(['m4', 'm3']);
    expect(search(2, 'x').messages.map((m) => m.id)).toEqual(['m4', 'm3']);
    expect(search(2, 2).messages.map((m) => m.id)).toEqual(['m2', 'm1']);
  });
});
