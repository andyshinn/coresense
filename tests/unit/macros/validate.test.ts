import { describe, expect, it } from 'vitest';
import { validateTemplate } from '../../../src/shared/macros/validate';

describe('validateTemplate', () => {
  it('accepts a valid template', () => {
    expect(validateTemplate('hi {{ peer_name }} {{ my_pos | distance: peer_pos | unit }}')).toEqual({ ok: true });
  });
  it('flags a parse error', () => {
    const r = validateTemplate('{% if %}');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0].kind).toBe('parse');
  });
  it('flags an unknown filter distinctly', () => {
    const r = validateTemplate('{{ peer_name | nope }}');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0].kind).toBe('unknown-filter');
  });
  it('flags an unknown variable distinctly', () => {
    const r = validateTemplate('{{ definitely_not_a_var }}');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0].kind).toBe('unknown-variable');
  });
});
