import { describe, expect, it } from 'vitest';
import { resolveHop } from '../../../../../src/renderer/components/path/resolveRepeater';
import type { Contact, MessageHop } from '../../../../../src/shared/types';

const repeater = (publicKeyHex: string, name: string): Contact => ({
  key: `c:${publicKeyHex}`,
  publicKeyHex,
  name,
  kind: 'repeater',
});

const hop = (over: Partial<MessageHop> = {}): MessageHop => ({ kind: 'hop', shortId: 'ab', name: null, pk: null, ...over });

describe('resolveHop', () => {
  it('names the hop after the first matching repeater, case-insensitively', () => {
    const r = resolveHop(hop({ shortId: 'AB' }), [repeater('ab01', 'Hilltop'), repeater('cd02', 'Valley')]);
    expect(r.resolved?.name).toBe('Hilltop');
    expect(r.label).toBe('Hilltop');
    expect(r.hasConflict).toBe(false);
  });

  it('flags a prefix shared by more than one repeater', () => {
    const r = resolveHop(hop(), [repeater('ab01', 'Hilltop'), repeater('ab02', 'Ridge')]);
    expect(r.candidates.map((c) => c.name)).toEqual(['Hilltop', 'Ridge']);
    expect(r.label).toBe('Hilltop');
    expect(r.hasConflict).toBe(true);
  });

  it("falls back to the hop's own name, unless it is unnamed", () => {
    expect(resolveHop(hop({ name: 'Relay' }), []).label).toBe('Relay');
    expect(resolveHop(hop({ name: 'Relay', unnamed: true }), []).label).toBe('Unknown repeater');
  });

  it('labels an unresolved origin as the sender and never matches it against repeaters', () => {
    const r = resolveHop({ kind: 'origin', shortId: 'ab', name: null, pk: null, unnamed: true }, [repeater('ab01', 'X')]);
    expect(r.candidates).toEqual([]);
    expect(r.label).toBe('Unknown sender');
  });
});
