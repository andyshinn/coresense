import { describe, expect, it } from 'vitest';
import { createMacroEngine } from '../../../src/shared/macros/engine';
import { buildSampleContext, getManifest, MACRO_VARIABLES } from '../../../src/shared/macros/manifest';
import { renderTemplate } from '../../../src/shared/macros/render';

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

  // Every documented example is copy-paste bait, so each one has to survive the
  // *worst* real context, not just the sample. `paths.first.hops` passed against
  // the sample and raised `undefined variable: paths.first` on every DM.
  describe('examples render against a context with no path observations', () => {
    const engine = createMacroEngine({ defaultDistanceUnit: 'metric' });
    const pathless = () => ({ ...buildSampleContext(), paths: [] }) as unknown as Record<string, unknown>;

    for (const v of MACRO_VARIABLES.filter((x) => x.example.includes('{{'))) {
      it(`${v.name}: ${v.example}`, () => {
        expect(renderTemplate(engine, v.example, pathless())).toMatchObject({ ok: true });
      });
    }

    it('the paths example falls back to "direct" rather than erroring', () => {
      const example = MACRO_VARIABLES.find((v) => v.name === 'paths')?.example as string;
      expect(renderTemplate(engine, example, pathless())).toEqual({ ok: true, text: 'direct' });
    });
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
    // Including the `populated: false` ones: this is the fixture the lint root
    // and validateTemplate's trial render are built from, and both need a
    // complete shape. The preview blanks them instead — see sampleContext.ts.
    const ctx = buildSampleContext() as unknown as Record<string, unknown>;
    for (const v of MACRO_VARIABLES) {
      expect(ctx[v.name], `${v.name} should be populated`).not.toBeNull();
      expect(ctx[v.name], `${v.name} should be defined`).not.toBeUndefined();
    }
  });

  // The caveat on `rssi` was added for #32, silently dropped by 569a175, and
  // restored by 68813db. Three attempts, no test. These variables only lie once
  // the warning goes missing, so pin both the flag and the wording: a change
  // that populates one for real has to delete its caveat here too, deliberately.
  describe('variables nothing populates are flagged and say so', () => {
    const DEAD = ['peer_rssi', 'peer_snr', 'rssi'];

    it.each(DEAD)('%s is marked populated: false', (name) => {
      expect(MACRO_VARIABLES.find((v) => v.name === name)?.populated).toBe(false);
    });

    it.each(DEAD)('%s warns in its description rather than reading as a live value', (name) => {
      expect(MACRO_VARIABLES.find((v) => v.name === name)?.description).toMatch(/not currently reported/i);
    });

    it('flags nothing else — every other variable resolves from a field something writes', () => {
      expect(MACRO_VARIABLES.filter((v) => v.populated === false).map((v) => v.name)).toEqual(DEAD);
    });
  });
});
