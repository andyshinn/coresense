import { describe, expect, it } from 'vitest';
import { parseCliLine, resolveCommand } from '@/panels/repeater-admin/cli/lib/parse';

describe('parseCliLine', () => {
  it('is command mode for an empty line', () => {
    expect(parseCliLine('', 0)).toEqual({ mode: 'command', token: '', start: 0 });
  });

  it('is command mode for a partial name', () => {
    expect(parseCliLine('set ra', 6)).toEqual({ mode: 'command', token: 'set ra', start: 0 });
  });

  it('keeps an exact command name in command mode with the whole prefix as the token', () => {
    // ⌃Space on a complete name must offer siblings, not arguments nobody started.
    const p = parseCliLine('set radio', 9);
    expect(p).toEqual({ mode: 'command', token: 'set radio', start: 0 });
  });

  it('enters arg mode only after a trailing space, with an empty token', () => {
    const p = parseCliLine('set radio ', 10);
    expect(p.mode).toBe('arg');
    if (p.mode === 'arg') {
      expect(p.cmd.name).toBe('set radio');
      expect(p.argIndex).toBe(0);
      expect(p.token).toBe('');
      expect(p.start).toBe(10);
    }
  });

  it('lets the longest command name win — `set radio` over `set`', () => {
    const p = parseCliLine('set radio 869', 13);
    expect(p.mode).toBe('arg');
    if (p.mode === 'arg') {
      expect(p.cmd.name).toBe('set radio');
      expect(p.argIndex).toBe(0);
      expect(p.token).toBe('869');
      expect(p.start).toBe(10);
    }
  });

  it('tracks the argument index across spaces', () => {
    const p = parseCliLine('setperm abc 3', 13);
    expect(p.mode).toBe('arg');
    if (p.mode === 'arg') {
      expect(p.cmd.name).toBe('setperm');
      expect(p.argIndex).toBe(1);
      expect(p.token).toBe('3');
    }
  });

  it('considers only text up to the caret', () => {
    // Caret sits right after `radio`, so the trailing ` 869` is invisible.
    const p = parseCliLine('set radio 869', 9);
    expect(p).toEqual({ mode: 'command', token: 'set radio', start: 0 });
  });

  it('handles multi-space input correctly (argIndex off-by-one fix)', () => {
    const p1 = parseCliLine('set radio  869', 15);
    expect(p1.mode).toBe('arg');
    if (p1.mode === 'arg') {
      expect(p1.argIndex).toBe(0);
      expect(p1.token).toBe('869');
    }

    const p2 = parseCliLine('set radio  ', 11);
    expect(p2.mode).toBe('arg');
    if (p2.mode === 'arg') {
      expect(p2.argIndex).toBe(0);
      expect(p2.token).toBe('');
    }
  });

  it('resolves longest-match collision correctly', () => {
    // Both 'set radio' and 'set radio.rxgain' exist; longest wins.
    const p = parseCliLine('set radio.rxgain 1', 18);
    expect(p.mode).toBe('arg');
    if (p.mode === 'arg') {
      expect(p.cmd.name).toBe('set radio.rxgain');
      expect(p.argIndex).toBe(0);
      expect(p.token).toBe('1');
    }
  });

  it('clamps caret to text bounds', () => {
    // Negative caret should clamp to 0, treating caret as at start.
    const p1 = parseCliLine('ver', -1);
    expect(p1).toEqual({ mode: 'command', token: '', start: 0 });

    // Caret beyond text length should clamp to text length.
    const p2 = parseCliLine('ver', 99);
    expect(p2).toEqual({ mode: 'command', token: 'ver', start: 0 });
  });
});

describe('resolveCommand', () => {
  it('resolves an exact name', () => {
    expect(resolveCommand('ver')?.name).toBe('ver');
  });

  it('resolves the longest matching name for a line with arguments', () => {
    expect(resolveCommand('set radio 869.525,250,11,5')?.name).toBe('set radio');
  });

  it('returns null for an unknown line', () => {
    expect(resolveCommand('frobnicate the widget')).toBeNull();
  });
});
