import { Models } from '@andyshinn/meshcore-ts';
import { describe, expect, it } from 'vitest';
import {
  fromLibAutoAdd,
  kindFlagsForSave,
  modeFromManualAdd,
  toLibAutoAdd,
  withModeBit,
} from '../../../../src/main/protocol/autoAddMapping';
import { type AutoAddConfig, DEFAULT_AUTO_ADD_CONFIG } from '../../../../src/shared/types';

const SELECTED: AutoAddConfig = {
  ...DEFAULT_AUTO_ADD_CONFIG,
  mode: 'selected',
  chat: true,
  repeater: false,
  room: false,
  sensor: true,
  overwriteOldest: false,
  radioMaxHops: 3,
  manualAddContacts: 0b1010_0001,
  autoRefreshContacts: true,
  showPublicKeys: false,
};

describe('autoAddMapping', () => {
  it('reads mode from bit 0 only', () => {
    expect(modeFromManualAdd(0)).toBe('all');
    expect(modeFromManualAdd(1)).toBe('selected');
    expect(modeFromManualAdd(0b1111_1110)).toBe('all');
    expect(modeFromManualAdd(0b1111_1111)).toBe('selected');
  });

  it('rewrites bit 0 and keeps the bits the firmware does not use', () => {
    expect(withModeBit(0b1010_0000, 'selected')).toBe(0b1010_0001);
    expect(withModeBit(0b1010_0001, 'all')).toBe(0b1010_0000);
    expect(withModeBit(0b1010_0001, 'selected')).toBe(0b1010_0001);
  });

  it("forces every kind on for 'all' and keeps the selection for 'selected'", () => {
    expect(kindFlagsForSave({ ...SELECTED, mode: 'all' })).toEqual({ chat: true, repeater: true, room: true, sensor: true });
    expect(kindFlagsForSave(SELECTED)).toEqual({ chat: true, repeater: false, room: false, sensor: true });
  });

  it('round-trips the app config through the library mirror', () => {
    expect(fromLibAutoAdd(toLibAutoAdd(SELECTED), SELECTED)).toEqual(SELECTED);
  });

  it('seeds every radio field and leaves the library-only filter at its default', () => {
    const lib = toLibAutoAdd(SELECTED);
    expect(lib.maxHops).toBe(Models.DEFAULT_AUTO_ADD_CONFIG.maxHops);
    expect(lib.manualAddContacts).toBe(SELECTED.manualAddContacts);
    expect(lib.radioMaxHops).toBe(3);
  });

  it("derives mode from the radio's byte, never from the library's own mode", () => {
    const lib: Models.AutoAddConfig = { ...toLibAutoAdd(SELECTED), mode: 'all', manualAddContacts: 1 };
    expect(fromLibAutoAdd(lib, SELECTED).mode).toBe('selected');
  });

  it('keeps the app-only fields from the previous value', () => {
    const prev = { ...SELECTED, autoRefreshContacts: false, showPublicKeys: true };
    const next = fromLibAutoAdd(toLibAutoAdd(SELECTED), prev);
    expect(next.autoRefreshContacts).toBe(false);
    expect(next.showPublicKeys).toBe(true);
  });
});
