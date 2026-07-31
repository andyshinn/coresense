import { describe, expect, it } from 'vitest';
import { accelFor, byId, menuActionFor, SHORTCUTS } from '../../../src/shared/shortcuts';
import type { Chord } from '../../../src/shared/shortcuts-format';

describe('SHORTCUTS registry', () => {
  it('has unique ids', () => {
    const ids = SHORTCUTS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
  it('gives every shortcut at least one chord', () => {
    for (const s of SHORTCUTS) expect(s.chords.length).toBeGreaterThan(0);
  });
  it('requires a menuAction for every menu-surface shortcut', () => {
    for (const s of SHORTCUTS.filter((x) => x.surface === 'menu')) {
      expect(s.menuAction, `${s.id} needs a menuAction`).toBeTruthy();
    }
  });
  it('forbids a menuAction on renderer/contextual shortcuts', () => {
    for (const s of SHORTCUTS.filter((x) => x.surface !== 'menu')) {
      expect(s.menuAction, `${s.id} must not have a menuAction`).toBeUndefined();
    }
  });
  it('looks up by id', () => {
    expect(byId('commandPalette').name).toBe('Command palette');
  });
  it('projects an accelerator for a menu shortcut', () => {
    expect(accelFor('toggleSidebar')).toBe('CmdOrCtrl+\\');
    expect(accelFor('sendAdvert')).toBe('CmdOrCtrl+Shift+A');
  });
  it('menuActionFor returns the action for a menu shortcut', () => {
    expect(menuActionFor('toggleSidebar')).toEqual({ kind: 'toggleLeftNav' });
  });
  it('menuActionFor throws for a non-menu shortcut', () => {
    expect(() => menuActionFor('help')).toThrow();
  });
});

function chordSig(chord: Chord, platform: 'mac' | 'other'): string {
  const mods = new Set(chord.mods ?? []);
  const parts: string[] = [];
  if (mods.has('ctrl') || (mods.has('mod') && platform === 'other')) parts.push('Ctrl');
  if (mods.has('mod') && platform === 'mac') parts.push('Meta');
  if (mods.has('alt')) parts.push('Alt');
  if (mods.has('shift')) parts.push('Shift');
  return `${parts.sort().join('+')}|${chord.key.toLowerCase()}`;
}

describe('SHORTCUTS chord collisions', () => {
  it('no two entries share a chord on either platform', () => {
    for (const platform of ['mac', 'other'] as const) {
      const seen = new Map<string, string>();
      for (const s of SHORTCUTS) {
        for (const chord of s.chords) {
          const sig = chordSig(chord, platform);
          const prior = seen.get(sig);
          expect(prior, `${platform}: ${s.id} collides with ${prior} on ${sig}`).toBeUndefined();
          seen.set(sig, s.id);
        }
      }
    }
  });
});
