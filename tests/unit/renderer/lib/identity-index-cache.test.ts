import { describe, expect, it } from 'vitest';
import { discoveredNameIndex } from '../../../../src/renderer/lib/identity';
import type { DiscoveredContact } from '../../../../src/shared/contacts/discovered';

// useIdentityHash runs once per rendered message row, and its useMemo depends
// on the `discovered` array — which gets a fresh identity on every websocket
// message. So during a contact sync the index was rebuilt
// (rows on screen) x (ws messages) times. Memoising on the array identity
// collapses that to once per message.

function rows(n: number): DiscoveredContact[] {
  return Array.from({ length: n }, (_, i) => ({
    key: `c:${i}`,
    publicKeyHex: i.toString(16).padStart(64, '0'),
    name: `Node ${i}`,
    kind: 'chat',
    hops: 1,
    firstHeardMs: 0,
    onRadio: true,
    favourite: false,
    blocked: false,
  })) as DiscoveredContact[];
}

describe('discoveredNameIndex', () => {
  it('returns the same index for repeated calls with the same array', () => {
    const list = rows(5);

    expect(discoveredNameIndex(list)).toBe(discoveredNameIndex(list));
  });

  it('rebuilds when the array identity changes', () => {
    const first = discoveredNameIndex(rows(5));
    const second = discoveredNameIndex(rows(5));

    expect(second).not.toBe(first);
    expect(second.get('Node 3')?.[0]?.name).toBe('Node 3');
  });

  it('groups rows by name, keeping every row for a duplicated name', () => {
    const list = rows(2);
    list[1] = { ...list[1], name: 'Node 0' };

    const index = discoveredNameIndex(list);

    expect(index.get('Node 0')).toHaveLength(2);
  });

  it('handles an empty pool', () => {
    expect(discoveredNameIndex([]).size).toBe(0);
  });
});
