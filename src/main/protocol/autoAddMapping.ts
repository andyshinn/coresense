import { Models } from '@andyshinn/meshcore-ts';
import type { AutoAddConfig, AutoAddMode } from '../../shared/types';

/** The fields coresense writes into the library's AutoAddConfig mirror after a
 *  push. `manualAddContacts` is the library's to maintain (see
 *  SessionAdapter.mirrorAutoAddConfig) and `maxHops` is the library's app-side
 *  advert filter, which coresense does not use. */
export type LibAutoAddFlags = Omit<Models.AutoAddConfig, 'manualAddContacts' | 'maxHops'>;

/** The app's `mode` as the radio states it: bit 0 of manual_add_contacts.
 *  Derived, never copied: the library's own `mode` is app-side state it never
 *  writes, so reading it back pins us to its default ('all') and silently
 *  discards the user's choice. */
export function modeFromManualAdd(manualAddContacts: number): AutoAddMode {
  return (manualAddContacts & 1) !== 0 ? 'selected' : 'all';
}

/** `byte` with bit 0 set for 'selected' and cleared for 'all'. Only that bit is
 *  rewritten: the rest of the byte is unused by the firmware today, and
 *  clobbering bits we don't understand is exactly the class of bug the
 *  round-tripping exists to prevent. */
export function withModeBit(manualAddContacts: number, mode: AutoAddMode): number {
  return mode === 'selected' ? manualAddContacts | 1 : manualAddContacts & ~1;
}

/** The kind flags a save pushes to the radio. 'all' forces every kind on, so
 *  the radio's own flags agree with what bit 0 clear already means. */
export function kindFlagsForSave(cfg: AutoAddConfig): Pick<AutoAddConfig, 'chat' | 'repeater' | 'room' | 'sensor'> {
  const all = cfg.mode === 'all';
  return {
    chat: all || cfg.chat,
    repeater: all || cfg.repeater,
    room: all || cfg.room,
    sensor: all || cfg.sensor,
  };
}

/** The app config as a seed for the library's mirror. Every field the radio has
 *  not reported yet then round-trips our own value instead of a library
 *  default (see SessionAdapter.seedAutoAddConfig). */
export function toLibAutoAdd(app: AutoAddConfig): Models.AutoAddConfig {
  return {
    ...Models.DEFAULT_AUTO_ADD_CONFIG,
    mode: app.mode,
    chat: app.chat,
    repeater: app.repeater,
    room: app.room,
    sensor: app.sensor,
    overwriteOldest: app.overwriteOldest,
    radioMaxHops: app.radioMaxHops,
    manualAddContacts: app.manualAddContacts,
  };
}

/** The library's whole mirror as the app config. The library owns the
 *  radio-driven fields; the two app-only UI fields (autoRefreshContacts,
 *  showPublicKeys) are not in its type, so they carry over from `prev`. */
export function fromLibAutoAdd(lib: Models.AutoAddConfig, prev: AutoAddConfig): AutoAddConfig {
  return {
    mode: modeFromManualAdd(lib.manualAddContacts),
    chat: lib.chat,
    repeater: lib.repeater,
    room: lib.room,
    sensor: lib.sensor,
    overwriteOldest: lib.overwriteOldest,
    radioMaxHops: lib.radioMaxHops,
    manualAddContacts: lib.manualAddContacts,
    autoRefreshContacts: prev.autoRefreshContacts,
    showPublicKeys: prev.showPublicKeys,
  };
}
