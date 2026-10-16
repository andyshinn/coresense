import { describe, expect, it } from 'vitest';
import { markerSignature } from '../../../../../src/renderer/components/map/cluster/markerCache';

const subject = { key: 'c:ab', name: 'Alpha', kind: 'chat' as const };
const state = { selected: false, faded: false, stale: false, showLabel: false };

describe('markerSignature', () => {
  it('encodes the prefix, kind, name and every state flag', () => {
    expect(markerSignature('contact', subject, state)).toBe('contact:chat:Alpha:_:_:_:_');
    expect(markerSignature('spider', subject, { selected: true, faded: true, stale: true, showLabel: true })).toBe(
      'spider:chat:Alpha:S:F:T:L',
    );
  });

  it('changes whenever a rendered input changes', () => {
    const base = markerSignature('contact', subject, state);
    const variants = [
      markerSignature('spider', subject, state),
      markerSignature('contact', { ...subject, kind: 'repeater' }, state),
      markerSignature('contact', { ...subject, name: 'Beta' }, state),
      markerSignature('contact', subject, { ...state, selected: true }),
      markerSignature('contact', subject, { ...state, faded: true }),
      markerSignature('contact', subject, { ...state, stale: true }),
      markerSignature('contact', subject, { ...state, showLabel: true }),
    ];
    expect(new Set([base, ...variants]).size).toBe(variants.length + 1);
  });

  it('ignores the contact key, which is the cache key rather than a visual input', () => {
    expect(markerSignature('contact', { ...subject, key: 'c:cd' }, state)).toBe(markerSignature('contact', subject, state));
  });
});
