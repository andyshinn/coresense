import { describe, expect, it } from 'vitest';
import type { RosterRow } from '../../../../src/renderer/shell/rightrail/sections/peopleModel';
import {
  bucketFor,
  filterRoster,
  fmtAge,
  fmtCount,
  groupByBucket,
  maxCount,
  sortRoster,
  toRosterRows,
  volumeWidth,
} from '../../../../src/renderer/shell/rightrail/sections/peopleModel';

const NOW = new Date('2026-07-25T14:30:00').getTime();
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

const row = (over: Partial<RosterRow> = {}): RosterRow => ({
  id: 'name:alice',
  name: 'alice',
  pubkey: 'abc',
  contactKey: 'c:abc',
  source: 'contact',
  ambiguous: false,
  blocked: false,
  inContacts: true,
  self: false,
  msgCount: 1,
  lastSeenAt: NOW,
  ...over,
});

describe('fmtAge', () => {
  it('renders an em dash for a missing or impossible timestamp', () => {
    expect(fmtAge(0, NOW)).toBe('—');
    expect(fmtAge(-1, NOW)).toBe('—');
    expect(fmtAge(Number.NaN, NOW)).toBe('—');
  });

  it('clamps a future timestamp to now rather than showing a negative age', () => {
    expect(fmtAge(NOW + HOUR, NOW)).toBe('now');
  });

  it('walks the compact ladder', () => {
    expect(fmtAge(NOW - 30_000, NOW)).toBe('now');
    expect(fmtAge(NOW - 59_999, NOW)).toBe('now');
    expect(fmtAge(NOW - 12 * MIN, NOW)).toBe('12m');
    expect(fmtAge(NOW - 59 * MIN, NOW)).toBe('59m');
    expect(fmtAge(NOW - 3 * HOUR, NOW)).toBe('3h');
    expect(fmtAge(NOW - 2 * DAY, NOW)).toBe('2d');
    expect(fmtAge(NOW - 6 * DAY, NOW)).toBe('6d');
    expect(fmtAge(NOW - 21 * DAY, NOW)).toBe('3w');
  });

  it('never renders 24h — the sub-day rung caps at 23h', () => {
    expect(fmtAge(NOW - 1439 * MIN, NOW)).toBe('23h');
  });

  it('rounds hours but floors days and weeks', () => {
    expect(fmtAge(NOW - 100 * MIN, NOW)).toBe('2h'); // 1.67 rounds up
    expect(fmtAge(NOW - (2 * DAY + 23 * HOUR), NOW)).toBe('2d'); // floors
  });
});

describe('fmtCount', () => {
  it('never exceeds three characters', () => {
    for (const n of [0, 7, 999, 1000, 12_345, 99_999, 1_000_000]) {
      expect(fmtCount(n).length).toBeLessThanOrEqual(3);
    }
  });

  it('prints small counts literally and abbreviates thousands', () => {
    expect(fmtCount(0)).toBe('0');
    expect(fmtCount(999)).toBe('999');
    expect(fmtCount(1000)).toBe('1k');
    expect(fmtCount(12_345)).toBe('12k');
    expect(fmtCount(99_999)).toBe('99k');
  });

  it('clamps runaway counts at 99k', () => {
    expect(fmtCount(1_000_000)).toBe('99k');
  });
});

describe('bucketFor', () => {
  it('is calendar-relative, not rolling', () => {
    expect(bucketFor(new Date('2026-07-25T00:05:00').getTime(), NOW)).toBe('today');
    expect(bucketFor(new Date('2026-07-24T23:55:00').getTime(), NOW)).toBe('yesterday');
    expect(bucketFor(new Date('2026-07-23T12:00:00').getTime(), NOW)).toBe('week');
    expect(bucketFor(new Date('2026-07-18T12:00:00').getTime(), NOW)).toBe('week');
    expect(bucketFor(new Date('2026-07-17T12:00:00').getTime(), NOW)).toBe('earlier');
  });

  it('crosses a month boundary correctly', () => {
    const aug1 = new Date('2026-08-01T09:00:00').getTime();
    expect(bucketFor(new Date('2026-07-31T22:00:00').getTime(), aug1)).toBe('yesterday');
    expect(bucketFor(new Date('2026-07-30T22:00:00').getTime(), aug1)).toBe('week');
  });
});

describe('sortRoster', () => {
  const rows = [
    row({ id: 'a', name: 'carol', msgCount: 5, lastSeenAt: NOW - HOUR }),
    row({ id: 'b', name: 'alice', msgCount: 9, lastSeenAt: NOW - 3 * HOUR }),
    row({ id: 'c', name: 'bob', msgCount: 5, lastSeenAt: NOW - 2 * HOUR }),
  ];

  it('recent sorts by last seen, newest first', () => {
    expect(sortRoster(rows, 'recent').map((r) => r.name)).toEqual(['carol', 'bob', 'alice']);
  });

  it('loud sorts by count, breaking ties on recency then name', () => {
    expect(sortRoster(rows, 'loud').map((r) => r.name)).toEqual(['alice', 'carol', 'bob']);
  });

  it('name sorts case-insensitively', () => {
    expect(sortRoster(rows, 'name').map((r) => r.name)).toEqual(['alice', 'bob', 'carol']);
  });

  it('name ignores leading emoji and punctuation', () => {
    const decorated = [row({ id: 'x', name: '🚀 zeta' }), row({ id: 'y', name: '!alpha' }), row({ id: 'z', name: 'mid' })];
    expect(sortRoster(decorated, 'name').map((r) => r.name)).toEqual(['!alpha', 'mid', '🚀 zeta']);
  });

  it('does not mutate its input', () => {
    const input = [...rows];
    sortRoster(input, 'name');
    expect(input.map((r) => r.name)).toEqual(['carol', 'alice', 'bob']);
  });
});

describe('filterRoster', () => {
  const rows = [row({ id: 'a', name: 'Alice', inContacts: true }), row({ id: 'b', name: 'bob', inContacts: false })];

  it('all with an empty query is a passthrough', () => {
    expect(filterRoster(rows, 'all', '')).toHaveLength(2);
  });

  it('contacts keeps only saved people', () => {
    expect(filterRoster(rows, 'contacts', '').map((r) => r.name)).toEqual(['Alice']);
  });

  it('searches case-insensitively on a substring', () => {
    expect(filterRoster(rows, 'all', 'LIC').map((r) => r.name)).toEqual(['Alice']);
  });

  it('composes filter and query', () => {
    expect(filterRoster(rows, 'contacts', 'bob')).toHaveLength(0);
  });
});

describe('groupByBucket', () => {
  it('omits empty buckets and keeps row order inside each', () => {
    const rows = [
      row({ id: 'a', lastSeenAt: NOW - HOUR }),
      row({ id: 'b', lastSeenAt: NOW - 30 * DAY }),
      row({ id: 'c', lastSeenAt: NOW - 2 * HOUR }),
    ];
    const buckets = groupByBucket(rows, NOW);
    expect(buckets.map((b) => b.id)).toEqual(['today', 'earlier']);
    expect(buckets[0].rows.map((r) => r.id)).toEqual(['a', 'c']);
  });

  it('returns nothing for an empty roster', () => {
    expect(groupByBucket([], NOW)).toEqual([]);
  });
});

describe('volume bar', () => {
  it('scales against the loudest row in the set', () => {
    expect(maxCount([row({ msgCount: 4 }), row({ msgCount: 10 })])).toBe(10);
    expect(volumeWidth(5, 10)).toBe('50%');
  });

  it('floors at 6% so a quiet row still shows a mark', () => {
    expect(volumeWidth(1, 1000)).toBe('6%');
  });

  it('renders a bare track when there is nothing to scale against', () => {
    expect(maxCount([])).toBe(0);
    expect(volumeWidth(0, 0)).toBe('0%');
  });
});

describe('toRosterRows', () => {
  it('emits a You row for the null bucket and still drops unknown', () => {
    const rows = toRosterRows(
      [
        { fromPk: null, count: 1, lastTs: NOW },
        { fromPk: 'unknown', count: 2, lastTs: NOW },
        { fromPk: 'name:alice', count: 3, lastTs: NOW },
      ],
      [],
      [],
    );
    expect(rows.map((r) => r.name)).toEqual(['You', 'alice']);
  });

  it('carries the self count and last-send straight off the null bucket', () => {
    const [r] = toRosterRows([{ fromPk: null, count: 7, lastTs: NOW - HOUR }], [], []);
    expect(r).toEqual({
      id: 'self',
      name: 'You',
      pubkey: null,
      contactKey: null,
      source: 'none',
      ambiguous: false,
      blocked: false,
      inContacts: false,
      self: true,
      msgCount: 7,
      lastSeenAt: NOW - HOUR,
    });
  });

  // The user-visible symptom: a channel only we have posted to rendered
  // "No one has been heard in this channel yet" under an activity chart
  // showing our own bars. The empty-note guard is `all.length === 0`.
  it('yields a row for a roster that contains only our own sends', () => {
    expect(toRosterRows([{ fromPk: null, count: 4, lastTs: NOW }], [], [])).toHaveLength(1);
  });

  it('does not collide with a poster literally named self', () => {
    const rows = toRosterRows(
      [
        { fromPk: null, count: 1, lastTs: NOW },
        { fromPk: 'name:self', count: 2, lastTs: NOW },
      ],
      [],
      [],
    );
    expect(rows.map((r) => r.id)).toEqual(['self', 'name:self']);
    expect(new Set(rows.map((r) => r.id)).size).toBe(2);
  });

  it('marks a saved poster as a contact', () => {
    const contacts = [{ key: 'c:abc', publicKeyHex: 'abc', name: 'alice', kind: 'chat' as const }];
    const [r] = toRosterRows([{ fromPk: 'name:alice', count: 3, lastTs: NOW }], contacts, []);
    expect(r).toMatchObject({
      inContacts: true,
      contactKey: 'c:abc',
      pubkey: 'abc',
      self: false,
      msgCount: 3,
      lastSeenAt: NOW,
    });
  });
});

describe('the You row behaves like any other participant', () => {
  const self = row({ id: 'self', name: 'You', pubkey: null, contactKey: null, inContacts: false, self: true });

  // Deliberately NOT pinned to the top. The rail states a statistic; hoisting
  // ourselves above louder posters would misreport it.
  it('sorts by volume, not by being us', () => {
    const rows = [self, row({ id: 'name:alice', name: 'alice', msgCount: 9 })];
    expect(sortRoster(rows, 'loud').map((r) => r.name)).toEqual(['alice', 'You']);
  });

  it('sorts by recency, not by being us', () => {
    const rows = [self, row({ id: 'name:alice', name: 'alice', lastSeenAt: NOW + HOUR })];
    expect(sortRoster(rows, 'recent').map((r) => r.name)).toEqual(['alice', 'You']);
  });

  // Renormalising over our own row shrinks everyone else's bar when we are the
  // loudest. That is the correct answer to "who's loud here" — pinned so it
  // stays a decision rather than a surprise.
  it('renormalises the volume bars when we are the loudest', () => {
    const rows = [row({ ...self, msgCount: 10 }), row({ id: 'name:alice', name: 'alice', msgCount: 5 })];
    expect(maxCount(rows)).toBe(10);
    expect(volumeWidth(5, maxCount(rows))).toBe('50%');
  });

  // You are not in your own contact list, so the Contacts filter hides the row
  // rather than quietly redefining that toggle as "contacts, plus you".
  it('is hidden by the contacts filter', () => {
    expect(filterRoster([self], 'contacts', '').length).toBe(0);
    expect(filterRoster([self], 'all', '').length).toBe(1);
  });

  it('is searchable by name', () => {
    expect(filterRoster([self], 'all', 'you').map((r) => r.name)).toEqual(['You']);
  });
});
