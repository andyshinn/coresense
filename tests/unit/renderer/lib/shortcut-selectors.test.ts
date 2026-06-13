import { describe, expect, it } from 'vitest';
import { adjacentUnreadKey, isTypingTarget, nthChannelKey } from '../../../../src/renderer/lib/shortcut-selectors';
import type { Channel } from '../../../../src/shared/types';

function ch(key: string, name: string, order: number): Channel {
  return { key, name, kind: 'public', idx: order, secretHex: '00' };
}

describe('nthChannelKey', () => {
  const channels = [ch('ch:A', 'A', 0), ch('ch:B', 'B', 1), ch('ch:C', 'C', 2)];
  it('returns the Nth channel (1-based) in sorted order', () => {
    expect(nthChannelKey(channels, new Set(), [], 1)).toBe('ch:A');
    expect(nthChannelKey(channels, new Set(), [], 3)).toBe('ch:C');
  });
  it('respects pinned ordering', () => {
    expect(nthChannelKey(channels, new Set(['ch:C']), ['ch:C'], 1)).toBe('ch:C');
  });
  it('returns null when N exceeds the list', () => {
    expect(nthChannelKey(channels, new Set(), [], 9)).toBeNull();
  });
});

describe('adjacentUnreadKey', () => {
  const ordered = ['ch:A', 'ch:B', 'ch:C'];
  it('returns null when there are no unreads', () => {
    expect(adjacentUnreadKey([], 'ch:A', 'next')).toBeNull();
  });
  it('advances and wraps forward', () => {
    expect(adjacentUnreadKey(ordered, 'ch:A', 'next')).toBe('ch:B');
    expect(adjacentUnreadKey(ordered, 'ch:C', 'next')).toBe('ch:A');
  });
  it('advances and wraps backward', () => {
    expect(adjacentUnreadKey(ordered, 'ch:B', 'prev')).toBe('ch:A');
    expect(adjacentUnreadKey(ordered, 'ch:A', 'prev')).toBe('ch:C');
  });
  it('jumps to the first unread when current is not itself unread', () => {
    expect(adjacentUnreadKey(ordered, 'ch:Z', 'next')).toBe('ch:A');
    expect(adjacentUnreadKey(ordered, 'ch:Z', 'prev')).toBe('ch:C');
  });
});

describe('isTypingTarget', () => {
  it('is true for input / textarea / contenteditable', () => {
    const input = { tagName: 'INPUT', isContentEditable: false } as unknown as EventTarget;
    const ta = { tagName: 'TEXTAREA', isContentEditable: false } as unknown as EventTarget;
    const ce = { tagName: 'DIV', isContentEditable: true } as unknown as EventTarget;
    expect(isTypingTarget(input)).toBe(true);
    expect(isTypingTarget(ta)).toBe(true);
    expect(isTypingTarget(ce)).toBe(true);
  });
  it('is true for a focused select', () => {
    const sel = { tagName: 'SELECT', isContentEditable: false } as unknown as EventTarget;
    expect(isTypingTarget(sel)).toBe(true);
  });
  it('is false for non-editable elements and null', () => {
    const div = { tagName: 'DIV', isContentEditable: false } as unknown as EventTarget;
    expect(isTypingTarget(div)).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
  });
});
