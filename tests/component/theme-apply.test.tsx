import { afterEach, describe, expect, it } from 'vitest';
import { applyTheme } from '../../src/renderer/lib/theme';

function cssVar(name: string): string {
  return document.documentElement.style.getPropertyValue(name).trim();
}

describe('applyTheme', () => {
  afterEach(() => {
    document.documentElement.removeAttribute('style');
    document.documentElement.classList.remove('dark');
  });

  // Regression test: kebab() used to leave digit-suffixed keys (bg2/bg3)
  // un-hyphenated, so applyTheme() wrote to --cs-bg2/--cs-bg3 — variables
  // nothing reads — instead of the --cs-bg-2/--cs-bg-3 that index.css and the
  // Tailwind @theme block actually define. Light mode ended up with a
  // light-mode --cs-text over dark-mode-default --cs-bg-2/--cs-bg-3 surfaces,
  // i.e. near-invisible text on cards, rails and message bubbles.
  it('writes hyphenated --cs-bg-2/--cs-bg-3 (not --cs-bg2/--cs-bg3) for light mode', () => {
    applyTheme('light');
    expect(cssVar('--cs-bg-2')).toBe('243 239 226');
    expect(cssVar('--cs-bg-3')).toBe('230 222 200');
    expect(cssVar('--cs-bg2')).toBe('');
    expect(cssVar('--cs-bg3')).toBe('');
  });

  it('writes the same hyphenated vars for dark mode', () => {
    applyTheme('dark');
    expect(cssVar('--cs-bg-2')).toBe('24 19 11');
    expect(cssVar('--cs-bg-3')).toBe('34 27 16');
  });
});
