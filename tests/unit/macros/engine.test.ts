import { describe, expect, it } from 'vitest';
import { createMacroEngine } from '../../../src/shared/macros/engine';

describe('createMacroEngine', () => {
  it('renders a simple variable', () => {
    const engine = createMacroEngine({ defaultDistanceUnit: 'metric' });
    expect(engine.parseAndRenderSync('hi {{ name }}', { name: 'Bob' })).toBe('hi Bob');
  });
  it('throws on an undefined variable (strictVariables)', () => {
    const engine = createMacroEngine({ defaultDistanceUnit: 'metric' });
    expect(() => engine.parseAndRenderSync('{{ nope }}', {})).toThrow(/undefined variable/i);
  });
  it('registers the distance filter', () => {
    const engine = createMacroEngine({ defaultDistanceUnit: 'metric' });
    const out = engine.parseAndRenderSync('{{ a | distance: b }}', { a: { lat: 0, lon: 0 }, b: { lat: 0, lon: 1 } });
    expect(Number(out)).toBeCloseTo(111194.9, 0);
  });
  it('uses the default unit when none is given', () => {
    const engine = createMacroEngine({ defaultDistanceUnit: 'imperial' });
    const out = engine.parseAndRenderSync('{{ 1609.344 | unit }}', {});
    expect(out).toBe('1.0 mi');
  });
});
