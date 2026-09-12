import { describe, expect, it } from 'vitest';
import { deriveContactView } from '../../../../src/renderer/lib/contactManagerView';
import type { ContactManagerState } from '../../../../src/renderer/lib/store';
import type { DiscoveredContact } from '../../../../src/shared/contacts/discovered';

const NOW = 1_750_000_000_000;
const HOUR = 3_600_000;

function contact(name: string, over: Partial<DiscoveredContact> = {}): DiscoveredContact {
  const pk = name.toLowerCase().padEnd(64, '0');
  return {
    key: `c:${pk}`,
    publicKeyHex: pk,
    name,
    kind: 'chat',
    firstHeardMs: NOW - 10 * HOUR,
    onRadio: true,
    favourite: false,
    blocked: false,
    ...over,
  };
}

function cm(over: Partial<ContactManagerState> = {}): ContactManagerState {
  return {
    search: '',
    stateTab: 'all',
    types: [],
    heard: 'any',
    favOnly: false,
    sortField: 'lastHeard',
    sortDir: 'asc',
    layout: 'table',
    compact: true,
    showKeys: true,
    selected: [],
    focusKey: null,
    ...over,
  };
}

const names = (rows: DiscoveredContact[]) => rows.map((r) => r.name);

// The Contact Manager sorts with ONE comparator multiplied by the direction, so
// anything a comparator invents for a missing value rides the asc/desc flip.
// `hops ?? 99` therefore didn't mean "unknown": it meant "99 hops", which sorts
// last ascending and FIRST descending — burying every measured row under the
// unmeasured majority on the second click of the Hops header (#45 item 8).
describe('deriveContactView — hops sort', () => {
  const rows = [
    contact('Delta', { hops: undefined }),
    contact('Alpha', { hops: 3 }),
    contact('Bravo', { hops: 0 }),
    contact('Charlie', { hops: undefined }),
  ];

  it('sorts known hop counts ascending with unknowns pinned last', () => {
    const view = deriveContactView(rows, cm({ sortField: 'hops', sortDir: 'asc' }), NOW);
    expect(names(view.rows)).toEqual(['Bravo', 'Alpha', 'Charlie', 'Delta']);
  });

  it('keeps unknowns last when the direction flips — absence is not a magnitude', () => {
    const view = deriveContactView(rows, cm({ sortField: 'hops', sortDir: 'desc' }), NOW);
    expect(names(view.rows)).toEqual(['Alpha', 'Bravo', 'Charlie', 'Delta']);
  });

  it('does not treat a 0-hop (direct) contact as unknown', () => {
    const view = deriveContactView(rows, cm({ sortField: 'hops', sortDir: 'desc' }), NOW);
    // Descending by hop count: 3 then 0. If 0 were mistaken for "no value" it
    // would land in the pinned group with Charlie/Delta.
    expect(view.rows[1].name).toBe('Bravo');
  });

  it('orders the unknown group by name, stably in both directions', () => {
    const asc = deriveContactView(rows, cm({ sortField: 'hops', sortDir: 'asc' }), NOW);
    const desc = deriveContactView(rows, cm({ sortField: 'hops', sortDir: 'desc' }), NOW);
    expect(names(asc.rows).slice(-2)).toEqual(['Charlie', 'Delta']);
    expect(names(desc.rows).slice(-2)).toEqual(['Charlie', 'Delta']);
  });
});

// `lastHeardMs ?? 0` is the same defect in the other column: a never-heard row
// sorted as if it had been heard at the epoch.
describe('deriveContactView — last-heard sort', () => {
  const rows = [
    contact('Never', { lastHeardMs: undefined }),
    contact('Recent', { lastHeardMs: NOW - HOUR }),
    contact('Older', { lastHeardMs: NOW - 50 * HOUR }),
    contact('AlsoNever', { lastHeardMs: undefined }),
  ];

  it('sorts newest first with never-heard rows pinned last', () => {
    const view = deriveContactView(rows, cm({ sortField: 'lastHeard', sortDir: 'asc' }), NOW);
    expect(names(view.rows)).toEqual(['Recent', 'Older', 'AlsoNever', 'Never']);
  });

  it('keeps never-heard rows last when the direction flips', () => {
    const view = deriveContactView(rows, cm({ sortField: 'lastHeard', sortDir: 'desc' }), NOW);
    expect(names(view.rows)).toEqual(['Older', 'Recent', 'AlsoNever', 'Never']);
  });
});

// Fields where every row has a value keep their existing behaviour — the
// partition must not leak into them.
describe('deriveContactView — fields with no unknown state', () => {
  it('still sorts by name in both directions', () => {
    const rows = [contact('Charlie'), contact('Alpha'), contact('Bravo')];
    expect(names(deriveContactView(rows, cm({ sortField: 'name', sortDir: 'asc' }), NOW).rows)).toEqual([
      'Alpha',
      'Bravo',
      'Charlie',
    ]);
    expect(names(deriveContactView(rows, cm({ sortField: 'name', sortDir: 'desc' }), NOW).rows)).toEqual([
      'Charlie',
      'Bravo',
      'Alpha',
    ]);
  });
});

// The Last-heard filter reads the same our-clock column, and hard-excludes rows
// that have no value. Before #45 item 9 only a live advert ever wrote it, so a
// contact we DM'd an hour ago vanished from "Last hour" — this locks in why the
// receipt-path bumps matter to the UI, not just to one cell.
describe('deriveContactView — heard filter', () => {
  const rows = [
    contact('Chatty', { lastHeardMs: NOW - HOUR / 2 }),
    contact('Silent', { lastHeardMs: undefined }),
    contact('Stale', { lastHeardMs: NOW - 100 * HOUR }),
  ];

  it('keeps every row under "any time"', () => {
    expect(deriveContactView(rows, cm({ heard: 'any' }), NOW).rows).toHaveLength(3);
  });

  it('drops rows with no reception at all from a time-boxed window', () => {
    expect(names(deriveContactView(rows, cm({ heard: 'hour' }), NOW).rows)).toEqual(['Chatty']);
    expect(names(deriveContactView(rows, cm({ heard: 'day' }), NOW).rows)).toEqual(['Chatty']);
  });
});

describe('deriveContactView — tab counts', () => {
  it('counts over the search/type/heard/fav filtered set, not the state tab', () => {
    const rows = [
      contact('OnRadio', { onRadio: true }),
      contact('Discovered', { onRadio: false }),
      contact('Blocked', { onRadio: true, blocked: true }),
    ];
    // Viewing the "discovered" tab must not zero the other tabs' badges.
    const view = deriveContactView(rows, cm({ stateTab: 'discovered' }), NOW);
    expect(view.counts).toEqual({ all: 2, onRadio: 1, discovered: 1, blocked: 1 });
    expect(names(view.rows)).toEqual(['Discovered']);
  });
});

// The cell prefers the measured INBOUND count, so the comparator behind the
// column has to read the same value. A comparator keyed on `hops` alone pinned
// a row showing "2 hops in" into the unknown group next to the rows showing
// "Flood" — the sort disagreeing with the numbers the user can see (#45 item 7).
describe('deriveContactView — hops sort follows the rendered value', () => {
  const rows = [
    contact('Measured', { hops: undefined, observedHops: 2 }),
    contact('Routed', { hops: 4 }),
    contact('Unknown', { hops: undefined }),
    contact('Direct', { hops: undefined, observedHops: 0 }),
  ];

  it('sorts a measured inbound count among the rows that have a number', () => {
    const view = deriveContactView(rows, cm({ sortField: 'hops', sortDir: 'asc' }), NOW);
    expect(names(view.rows)).toEqual(['Direct', 'Measured', 'Routed', 'Unknown']);
  });

  it('does not pin a measured row with the ones that have no value at all', () => {
    const desc = deriveContactView(rows, cm({ sortField: 'hops', sortDir: 'desc' }), NOW);
    expect(names(desc.rows)).toEqual(['Routed', 'Measured', 'Direct', 'Unknown']);
  });

  it('compares the inbound value, not the outbound one, when both exist', () => {
    // 6 hops out but heard 1 hop in: it belongs next to the 1-hop row.
    const asymmetric = [contact('Near', { hops: 6, observedHops: 1 }), contact('Far', { hops: 1, observedHops: 5 })];
    const view = deriveContactView(asymmetric, cm({ sortField: 'hops', sortDir: 'asc' }), NOW);
    expect(names(view.rows)).toEqual(['Near', 'Far']);
  });
});
