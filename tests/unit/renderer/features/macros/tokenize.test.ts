import { describe, expect, it } from 'vitest';
import { type MacroCatalog, type TokenizeResult, type TokenType, tokenize } from '@/features/macros/tokenize';
import type { MacroRenderMode } from '../../../../../src/shared/macros/types';

const catalog: MacroCatalog = {
  variableNames: new Set(['my_pos', 'peer_pos', 'sender_name', 'snr', 'paths', 'my_name']),
  replyOnlyNames: new Set(['sender_name', 'snr', 'paths']),
  customFilterNames: new Set(['distance', 'bearing', 'unit']),
};

/** The runs must always tile the entire source string exactly. */
function joined(src: string, mode: MacroRenderMode = 'reply') {
  return tokenize(src, mode, catalog)
    .runs.map((r) => r.text)
    .join('');
}

/** The text of every run painted as `type`. */
function painted(res: TokenizeResult, type: TokenType): string[] {
  return res.runs.filter((r) => r.type === type).map((r) => r.text);
}

describe('tokenize', () => {
  it('treats plain text as a single text run with no vars or errors', () => {
    const res = tokenize('hello world', 'reply', catalog);
    expect(res.runs).toEqual([{ text: 'hello world', type: 'text' }]);
    expect(res.varRoots).toEqual([]);
  });

  it('classifies a known variable and records its root', () => {
    const res = tokenize('{{ sender_name }}', 'reply', catalog);
    expect(res.runs.some((r) => r.type === 'variable' && r.text === 'sender_name')).toBe(true);
    expect(res.runs.some((r) => r.type === 'delim' && r.text.includes('{{'))).toBe(true);
    expect(res.varRoots).toEqual(['sender_name']);
    expect(painted(res, 'error')).toEqual([]);
  });

  it('flags an unknown variable as an error', () => {
    const res = tokenize('{{ nope }}', 'reply', catalog);
    expect(painted(res, 'error')).toEqual(['nope']);
    expect(res.varRoots).toEqual([]);
  });

  it('greys reply-only vars as unavailable in send mode (warn, not error)', () => {
    const send = tokenize('{{ snr }}', 'send', catalog);
    expect(painted(send, 'unavail')).toEqual(['snr']);
    expect(painted(send, 'error')).toEqual([]);

    const reply = tokenize('{{ snr }}', 'reply', catalog);
    expect(reply.runs.some((r) => r.type === 'variable' && r.text === 'snr')).toBe(true);
    expect(painted(reply, 'unavail')).toEqual([]);
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
    expect(painted(res, 'error')).toEqual([]);
  });

  it('treats unrecognised filters leniently (standard LiquidJS) with no error', () => {
    const res = tokenize('{{ my_name | upcase }}', 'reply', catalog);
    expect(res.runs.some((r) => r.type === 'filter' && r.text === 'upcase')).toBe(true);
    expect(painted(res, 'error')).toEqual([]);
  });

  it('colours string and chained standard-filter args without erroring', () => {
    const res = tokenize('{{ paths | sort: "final_snr" | last }}', 'reply', catalog);
    expect(res.runs.some((r) => r.type === 'filter' && r.text === 'sort')).toBe(true);
    expect(res.runs.some((r) => r.type === 'filter' && r.text === 'last')).toBe(true);
    expect(res.runs.some((r) => r.type === 'string' && r.text === '"final_snr"')).toBe(true);
    expect(res.varRoots).toEqual(['paths']);
    expect(painted(res, 'error')).toEqual([]);
  });

  it('paints an unclosed tag as an error through to the end', () => {
    const res = tokenize('hi {{ sender_name', 'reply', catalog);
    expect(painted(res, 'error')).toEqual(['{{ sender_name']);
  });

  it('paints a malformed tag as an error', () => {
    expect(painted(tokenize('{{ my_name | }}', 'reply', catalog), 'error')).toEqual(['|']);
    expect(painted(tokenize('{{ my_name snr }}', 'reply', catalog), 'error')).toEqual(['snr']);
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

  it('paints a tag keyword and records variable roots used inside a tag', () => {
    const res = tokenize('{% if paths %}hi{% endif %}', 'reply', catalog);
    expect(res.runs.some((r) => r.type === 'tag' && r.text === 'if')).toBe(true);
    expect(res.runs.some((r) => r.type === 'variable' && r.text === 'paths')).toBe(true);
    expect(res.varRoots).toEqual(['paths']);
    expect(painted(res, 'error')).toEqual([]);
  });

  it('treats a for-loop variable as a local, not an unknown variable', () => {
    const res = tokenize('{% for h in paths %}{{ h }}{% endfor %}', 'reply', catalog);
    expect(painted(res, 'error')).toEqual([]);
    expect(res.varRoots).toEqual(['paths']);
  });

  it('permits forloop inside a for body', () => {
    const res = tokenize('{% for h in paths %}{{ forloop.index }}{% endfor %}', 'reply', catalog);
    expect(painted(res, 'error')).toEqual([]);
    expect(res.varRoots).toEqual(['paths']);
  });

  it('treats an assigned name as a local usable later', () => {
    const res = tokenize('{% assign z = paths %}{{ z }}', 'reply', catalog);
    expect(painted(res, 'error')).toEqual([]);
    expect(res.varRoots).toEqual(['paths']);
  });

  it('treats a captured name as a local', () => {
    const res = tokenize('{% capture c %}x{% endcapture %}{{ c }}', 'reply', catalog);
    expect(painted(res, 'error')).toEqual([]);
  });

  it('still flags a genuinely unknown variable inside a tag', () => {
    const res = tokenize('{% if nope %}x{% endif %}', 'reply', catalog);
    expect(painted(res, 'error')).toEqual(['nope']);
  });

  it('derives reply mode from a variable used only inside a tag', () => {
    const res = tokenize('{% if snr %}x{% endif %}', 'reply', catalog);
    expect(res.varRoots).toEqual(['snr']);
  });

  it('greys a reply-only var used inside a tag when in send mode', () => {
    const res = tokenize('{% if snr %}x{% endif %}', 'send', catalog);
    expect(res.runs.some((r) => r.type === 'unavail' && r.text === 'snr')).toBe(true);
  });

  it('does not error on keywords and operators', () => {
    const res = tokenize('{% if snr > 5 and paths %}x{% endif %}', 'reply', catalog);
    expect(painted(res, 'error')).toEqual([]);
  });

  it('paints an unclosed tag block as an error', () => {
    const res = tokenize('{% if paths', 'reply', catalog);
    expect(painted(res, 'error')).toEqual(['{% if paths']);
  });

  it('tiles the source exactly for tag inputs too', () => {
    for (const src of [
      '{% if paths %}hi{% endif %}',
      '{% for h in paths %}{{ h.x }}{% endfor %}',
      '{% assign z = paths %}{{ z }}',
      '{% if paths',
      'a {% if x %} b {{ snr }} c {% endif %} d',
    ]) {
      expect(joined(src)).toBe(src);
    }
  });
});
