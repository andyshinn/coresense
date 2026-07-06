import { describe, expect, it } from 'vitest';
import { type MacroCatalog, tokenize } from '@/panels/macros/lib/tokenize';

const catalog: MacroCatalog = {
  variableNames: new Set(['my_pos', 'peer_pos', 'sender_name', 'snr', 'paths', 'my_name']),
  replyOnlyNames: new Set(['sender_name', 'snr', 'paths']),
  customFilterNames: new Set(['distance', 'bearing', 'unit']),
};

/** The runs must always tile the entire source string exactly. */
function joined(src: string, mode: 'reply' | 'send' = 'reply') {
  return tokenize(src, mode, catalog)
    .runs.map((r) => r.text)
    .join('');
}

describe('tokenize', () => {
  it('treats plain text as a single text run with no vars or errors', () => {
    const res = tokenize('hello world', 'reply', catalog);
    expect(res.runs).toEqual([{ text: 'hello world', type: 'text' }]);
    expect(res.errors).toEqual([]);
    expect(res.varRoots).toEqual([]);
  });

  it('classifies a known variable and records its root', () => {
    const res = tokenize('{{ sender_name }}', 'reply', catalog);
    expect(res.runs.some((r) => r.type === 'variable' && r.text === 'sender_name')).toBe(true);
    expect(res.runs.some((r) => r.type === 'delim' && r.text.includes('{{'))).toBe(true);
    expect(res.varRoots).toEqual(['sender_name']);
    expect(res.errors).toEqual([]);
  });

  it('flags an unknown variable as an error', () => {
    const res = tokenize('{{ nope }}', 'reply', catalog);
    expect(res.runs.some((r) => r.type === 'error')).toBe(true);
    expect(res.errors[0]).toMatchObject({ severity: 'error', kind: 'unknown-var', name: 'nope' });
  });

  it('greys reply-only vars as unavailable in send mode (warn, not error)', () => {
    const send = tokenize('{{ snr }}', 'send', catalog);
    expect(send.runs.some((r) => r.type === 'unavail' && r.text === 'snr')).toBe(true);
    expect(send.errors[0]).toMatchObject({ severity: 'warn', kind: 'unavailable', name: 'snr' });

    const reply = tokenize('{{ snr }}', 'reply', catalog);
    expect(reply.runs.some((r) => r.type === 'variable' && r.text === 'snr')).toBe(true);
    expect(reply.errors).toEqual([]);
  });

  it('recognises a dot-path variable by its root', () => {
    const res = tokenize('{{ my_pos.lat }}', 'reply', catalog);
    expect(res.runs.some((r) => r.type === 'variable' && r.text === 'my_pos.lat')).toBe(true);
    expect(res.varRoots).toEqual(['my_pos']);
  });

  it('marks custom filters distinctly from standard filters and reads variable args', () => {
    const res = tokenize('{{ my_pos | distance: peer_pos }}', 'reply', catalog);
    expect(res.runs.some((r) => r.type === 'custom' && r.text === 'distance')).toBe(true);
    expect(res.runs.some((r) => r.type === 'variable' && r.text === 'peer_pos')).toBe(true);
    expect(res.varRoots).toEqual(['my_pos', 'peer_pos']);
    expect(res.errors).toEqual([]);
  });

  it('treats unrecognised filters leniently (standard LiquidJS) with no error', () => {
    const res = tokenize('{{ my_name | upcase }}', 'reply', catalog);
    expect(res.runs.some((r) => r.type === 'filter' && r.text === 'upcase')).toBe(true);
    expect(res.errors).toEqual([]);
  });

  it('colours string and chained standard-filter args without erroring', () => {
    const res = tokenize('{{ paths | sort: "final_snr" | last }}', 'reply', catalog);
    expect(res.runs.some((r) => r.type === 'filter' && r.text === 'sort')).toBe(true);
    expect(res.runs.some((r) => r.type === 'filter' && r.text === 'last')).toBe(true);
    expect(res.runs.some((r) => r.type === 'string' && r.text === '"final_snr"')).toBe(true);
    expect(res.varRoots).toEqual(['paths']);
    expect(res.errors).toEqual([]);
  });

  it('reports an unclosed tag as a syntax error', () => {
    const res = tokenize('hi {{ sender_name', 'reply', catalog);
    expect(res.runs.some((r) => r.type === 'error')).toBe(true);
    expect(res.errors.some((e) => e.kind === 'syntax')).toBe(true);
  });

  it('always tiles the entire source across runs', () => {
    expect(joined('hi {{ sender_name }} @ {{ snr }}snr')).toBe('hi {{ sender_name }} @ {{ snr }}snr');
    expect(joined('{{ paths | sort: "final_snr" | last }}')).toBe('{{ paths | sort: "final_snr" | last }}');
    expect(joined('{{ unclosed')).toBe('{{ unclosed');
  });

  it('lists each distinct variable root once', () => {
    const res = tokenize('{{ sender_name }} {{ sender_name }} {{ my_pos.lat }}', 'reply', catalog);
    expect(res.varRoots).toEqual(['sender_name', 'my_pos']);
  });
});
