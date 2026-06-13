import { describe, expect, it } from 'vitest';
import {
  type Chord,
  matchesEvent,
  type ShortcutKeyEvent,
  toAccelerator,
  toCaps,
} from '../../../src/shared/shortcuts-format';

// Build a keydown view, defaulting every modifier off.
function ev(over: Partial<ShortcutKeyEvent> = {}): ShortcutKeyEvent {
  return { key: 'k', metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, ...over };
}

describe('toAccelerator', () => {
  it('renders a mod chord', () => {
    expect(toAccelerator({ mods: ['mod'], key: 'k' })).toBe('CmdOrCtrl+K');
  });
  it('renders mod+shift and uppercases the letter', () => {
    expect(toAccelerator({ mods: ['mod', 'shift'], key: 'a' })).toBe('CmdOrCtrl+Shift+A');
  });
  it('renders punctuation keys literally', () => {
    expect(toAccelerator({ mods: ['mod'], key: ',' })).toBe('CmdOrCtrl+,');
    expect(toAccelerator({ mods: ['mod'], key: '\\' })).toBe('CmdOrCtrl+\\');
  });
  it('renders a chord with no modifiers', () => {
    expect(toAccelerator({ key: 'Escape' })).toBe('Escape');
  });
});

describe('toCaps', () => {
  it('uses Mac glyphs on mac', () => {
    expect(toCaps({ mods: ['mod', 'shift'], key: 'a' }, 'mac')).toEqual(['⌘', '⇧', 'A']);
  });
  it('uses word modifiers off mac', () => {
    expect(toCaps({ mods: ['mod', 'shift'], key: 'a' }, 'other')).toEqual(['Ctrl', 'Shift', 'A']);
  });
  it('maps named keys to glyphs', () => {
    expect(toCaps({ mods: ['shift'], key: 'Escape' }, 'mac')).toEqual(['⇧', '⎋']);
    expect(toCaps({ mods: ['alt'], key: 'ArrowDown' }, 'mac')).toEqual(['⌥', '↓']);
    expect(toCaps({ key: 'Enter' }, 'mac')).toEqual(['⏎']);
  });
  it('renders the 1-9 range token', () => {
    expect(toCaps({ mods: ['mod'], key: '1-9' }, 'mac')).toEqual(['⌘', '1…9']);
  });
});

describe('matchesEvent', () => {
  const cmdK: Chord = { mods: ['mod'], key: 'k' };
  it('matches Cmd+K and Ctrl+K', () => {
    expect(matchesEvent(ev({ metaKey: true }), cmdK)).toBe(true);
    expect(matchesEvent(ev({ ctrlKey: true }), cmdK)).toBe(true);
  });
  it('is case-insensitive on the letter', () => {
    expect(matchesEvent(ev({ metaKey: true, key: 'K' }), cmdK)).toBe(true);
  });
  it('rejects when an undeclared modifier is held', () => {
    expect(matchesEvent(ev({ metaKey: true, shiftKey: true }), cmdK)).toBe(false);
    expect(matchesEvent(ev({ metaKey: true, altKey: true }), cmdK)).toBe(false);
  });
  it('rejects when the required mod is absent', () => {
    expect(matchesEvent(ev({ key: 'k' }), cmdK)).toBe(false);
  });
  it('matches "?" regardless of the shift used to type it', () => {
    const help: Chord = { key: '?' };
    expect(matchesEvent(ev({ key: '?', shiftKey: true }), help)).toBe(true);
    expect(matchesEvent(ev({ key: '?', shiftKey: false }), help)).toBe(true);
  });
  it('matches Shift+Escape', () => {
    expect(matchesEvent(ev({ shiftKey: true, key: 'Escape' }), { mods: ['shift'], key: 'Escape' })).toBe(true);
    expect(matchesEvent(ev({ key: 'Escape' }), { mods: ['shift'], key: 'Escape' })).toBe(false);
  });
  it('matches Alt+ArrowUp', () => {
    expect(matchesEvent(ev({ altKey: true, key: 'ArrowUp' }), { mods: ['alt'], key: 'ArrowUp' })).toBe(true);
  });
});
