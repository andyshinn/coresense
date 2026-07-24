import { describe, expect, it } from 'vitest';
import { buildSampleContext, getManifest, MACRO_VARIABLES } from '../../../src/shared/macros/manifest';

describe('macro manifest', () => {
  it('exposes core variables with availability', () => {
    const names = MACRO_VARIABLES.map((v) => v.name);
    expect(names).toEqual(expect.arrayContaining(['my_pos', 'peer_name', 'rssi', 'paths']));
    expect(MACRO_VARIABLES.find((v) => v.name === 'my_pos')?.available).toBe('always');
    expect(MACRO_VARIABLES.find((v) => v.name === 'rssi')?.available).toBe('reply');
  });

  it('lists the custom filters', () => {
    expect(getManifest().filters.map((f) => f.name)).toEqual(expect.arrayContaining(['distance', 'bearing', 'unit']));
  });

  it('documents the relay-only hops example with a direct fallback', () => {
    const paths = MACRO_VARIABLES.find((v) => v.name === 'paths');
    expect(paths?.example).toContain('short_id');
    expect(paths?.example).toContain('default: "direct"');
    expect(paths?.description).toContain('all_hops');
  });

  it('sample path carries relay hops, one resolved and one not', () => {
    const path = buildSampleContext().paths[0];
    expect(path.hops.length).toBe(2);
    expect(path.length).toBe(2);
    expect(path.hops.every((h) => h.kind === 'hop')).toBe(true);
    expect(path.hops.map((h) => h.name)).toEqual(['Tarrytown East Solar', null]);
    expect(path.hops.map((h) => h.pk)).toEqual(['a137f2aa', null]);
    expect(path.all_hops.map((h) => h.kind)).toEqual(['origin', 'hop', 'hop', 'sink']);
  });

  it('sample context populates every manifest variable (no nulls)', () => {
    const ctx = buildSampleContext() as unknown as Record<string, unknown>;
    for (const v of MACRO_VARIABLES) {
      expect(ctx[v.name], `${v.name} should be populated`).not.toBeNull();
      expect(ctx[v.name], `${v.name} should be defined`).not.toBeUndefined();
    }
  });
});
