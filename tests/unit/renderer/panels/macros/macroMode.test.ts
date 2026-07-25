import { describe, expect, it } from 'vitest';
import { deriveMacroMode } from '@/panels/macros/lib/macroMode';
import type { MacroCatalog } from '@/panels/macros/lib/tokenize';

const catalog: MacroCatalog = {
  variableNames: new Set(['my_name', 'my_pos', 'peer_name', 'peer_pos', 'sender_name', 'snr']),
  replyOnlyNames: new Set(['sender_name', 'snr']),
  customFilterNames: new Set(['distance', 'unit']),
};

describe('deriveMacroMode', () => {
  it("is 'reply' when the template references a reply-only variable", () => {
    expect(deriveMacroMode('{{ sender_name }}: {{ snr }} snr', catalog)).toBe('reply');
  });

  it("is 'both' when the template only uses always-available variables", () => {
    expect(deriveMacroMode('{{ my_name }} near {{ peer_name }}', catalog)).toBe('both');
  });

  it("is 'both' for an empty or text-only template", () => {
    expect(deriveMacroMode('', catalog)).toBe('both');
    expect(deriveMacroMode('on my way', catalog)).toBe('both');
  });

  it('ignores reply-only names that appear only as filter arguments to known vars', () => {
    // peer_pos is always-available; distance is a known filter — stays 'both'.
    expect(deriveMacroMode('{{ my_pos | distance: peer_pos | unit }}', catalog)).toBe('both');
  });
});
