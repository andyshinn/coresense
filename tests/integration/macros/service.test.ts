import { beforeEach, describe, expect, it } from 'vitest';
import { renderMacro } from '../../../src/main/macros/service';
import { macrosStore, resetMacrosCacheForTests } from '../../../src/main/macros/store';
import { buildSampleContext } from '../../../src/shared/macros';

const ctx = () => buildSampleContext();

describe('renderMacro', () => {
  beforeEach(() => resetMacrosCacheForTests());
  it('renders a raw template string', () => {
    const r = renderMacro('hi {{ peer_name }}', ctx());
    expect(r).toEqual({ ok: true, text: 'hi Alice' });
  });
  it('renders a stored macro by id', () => {
    const m = macrosStore.add({ name: 'sig', template: 'rssi {{ rssi }}', scope: 'global' });
    expect(renderMacro(m.id, ctx())).toEqual({ ok: true, text: 'rssi -95' });
  });
  it('returns an error result instead of throwing', () => {
    const r = renderMacro('{{ nope }}', ctx());
    expect(r.ok).toBe(false);
  });
});
