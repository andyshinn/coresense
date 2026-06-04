import { type Chord, toAccelerator } from './shortcuts-format';
import type { MenuAction } from './types';

export type Surface = 'menu' | 'renderer' | 'contextual';
export type ShortcutCategory = 'General' | 'Navigation' | 'Messages' | 'Radio';

export interface Shortcut {
  id: string;
  category: ShortcutCategory;
  name: string; // ACTION column
  desc: string; // DESCRIPTION column
  chords: Chord[]; // alternates render as "A or B"; usually length 1
  surface: Surface;
  menuAction?: MenuAction; // required iff surface === 'menu'
  guardTyping?: boolean; // renderer-surface: ignore while a text field has focus
}

// The single source of truth. Order within a category is the overlay's row order.
export const SHORTCUTS: Shortcut[] = [
  // ── General ──────────────────────────────────────────────────────
  {
    id: 'commandPalette',
    category: 'General',
    name: 'Command palette',
    desc: 'Open the command palette to jump anywhere or run a command.',
    chords: [{ mods: ['mod'], key: 'k' }],
    surface: 'menu',
    menuAction: { kind: 'openPalette' },
  },
  {
    id: 'quickFind',
    category: 'General',
    name: 'Quick find',
    desc: 'Search across contacts, channels, and message history.',
    chords: [{ mods: ['mod'], key: 'f' }],
    surface: 'renderer',
  },
  {
    id: 'settings',
    category: 'General',
    name: 'Settings',
    desc: 'Open identity, radio preset, and application settings.',
    chords: [{ mods: ['mod'], key: ',' }],
    surface: 'menu',
    menuAction: { kind: 'openSettings' },
  },
  {
    id: 'toggleTheme',
    category: 'General',
    name: 'Toggle theme',
    desc: 'Cycle the console theme: auto → dark → light.',
    chords: [{ mods: ['mod', 'shift'], key: 'l' }],
    surface: 'menu',
    menuAction: { kind: 'cycleTheme' },
  },
  {
    id: 'help',
    category: 'General',
    name: 'Help',
    desc: 'Open this help dialog when used outside of a text box.',
    chords: [{ mods: ['shift'], key: '?' }, { key: '?' }],
    surface: 'renderer',
    guardTyping: true,
  },
  // ── Navigation ───────────────────────────────────────────────────
  {
    id: 'switchChannel',
    category: 'Navigation',
    name: 'Switch channel',
    desc: 'Jump straight to a channel by its position in the list.',
    chords: [{ mods: ['mod'], key: '1-9' }],
    surface: 'renderer',
  },
  {
    id: 'nextUnread',
    category: 'Navigation',
    name: 'Next unread',
    desc: 'Jump to the next conversation with unread messages.',
    chords: [{ mods: ['alt'], key: 'ArrowDown' }],
    surface: 'renderer',
    guardTyping: true,
  },
  {
    id: 'prevUnread',
    category: 'Navigation',
    name: 'Previous unread',
    desc: 'Jump to the previous conversation with unread messages.',
    chords: [{ mods: ['alt'], key: 'ArrowUp' }],
    surface: 'renderer',
    guardTyping: true,
  },
  {
    id: 'toggleSidebar',
    category: 'Navigation',
    name: 'Toggle sidebar',
    desc: 'Show or hide the channels & contacts sidebar.',
    chords: [{ mods: ['mod'], key: '\\' }],
    surface: 'menu',
    menuAction: { kind: 'toggleLeftNav' },
  },
  {
    id: 'toggleRightRail',
    category: 'Navigation',
    name: 'Toggle right rail',
    desc: 'Show or hide the right detail rail.',
    chords: [{ mods: ['mod'], key: '.' }],
    surface: 'menu',
    menuAction: { kind: 'toggleRightRail' },
  },
  {
    id: 'packetLog',
    category: 'Navigation',
    name: 'Packet log',
    desc: 'Open the raw RX / TX packet log feed.',
    chords: [{ mods: ['mod'], key: 'l' }],
    surface: 'menu',
    menuAction: { kind: 'openPacketLog' },
  },
  {
    id: 'prevPinned',
    category: 'Navigation',
    name: 'Previous pinned',
    desc: 'Cycle to the previous pinned conversation.',
    chords: [{ mods: ['mod'], key: '[' }],
    surface: 'menu',
    menuAction: { kind: 'cyclePinned', direction: 'prev' },
  },
  {
    id: 'nextPinned',
    category: 'Navigation',
    name: 'Next pinned',
    desc: 'Cycle to the next pinned conversation.',
    chords: [{ mods: ['mod'], key: ']' }],
    surface: 'menu',
    menuAction: { kind: 'cyclePinned', direction: 'next' },
  },
  {
    id: 'pinCurrent',
    category: 'Navigation',
    name: 'Pin / unpin current',
    desc: 'Pin or unpin the active conversation.',
    chords: [{ mods: ['mod'], key: 'd' }],
    surface: 'menu',
    menuAction: { kind: 'pinToggle' },
  },
  // ── Messages ─────────────────────────────────────────────────────
  {
    id: 'markRead',
    category: 'Messages',
    name: 'Mark read',
    desc: 'Mark the topmost channel or DM in the unreads pane as read.',
    chords: [{ key: 'Escape' }],
    surface: 'contextual',
  },
  {
    id: 'markAllRead',
    category: 'Messages',
    name: 'Mark all read',
    desc: 'Mark every channel and DM as read.',
    chords: [{ mods: ['shift'], key: 'Escape' }],
    surface: 'renderer',
  },
  {
    id: 'send',
    category: 'Messages',
    name: 'Send',
    desc: 'Send the message currently in the composer.',
    chords: [{ key: 'Enter' }],
    surface: 'contextual',
  },
  {
    id: 'insertLineBreak',
    category: 'Messages',
    name: 'Insert line break',
    desc: 'Add a new line without sending the message.',
    chords: [{ mods: ['shift'], key: 'Enter' }],
    surface: 'contextual',
  },
  // ── Radio ────────────────────────────────────────────────────────
  {
    id: 'reconnect',
    category: 'Radio',
    name: 'Reconnect radio',
    desc: 'Reconnect the attached radio over USB, BLE, or TCP.',
    chords: [{ mods: ['mod', 'shift'], key: 'r' }],
    surface: 'menu',
    menuAction: { kind: 'reconnect' },
  },
  {
    id: 'toggleRepeat',
    category: 'Radio',
    name: 'Toggle repeat mode',
    desc: 'Enable or disable repeat (relay) mode on this node.',
    chords: [{ mods: ['mod', 'shift'], key: 'm' }],
    surface: 'menu',
    menuAction: { kind: 'toggleRepeat' },
  },
  {
    id: 'sendAdvert',
    category: 'Radio',
    name: 'Send advert',
    desc: 'Broadcast your presence to nearby nodes.',
    chords: [{ mods: ['mod', 'shift'], key: 'a' }],
    surface: 'menu',
    menuAction: { kind: 'sendAdvert' },
  },
];

const BY_ID = new Map(SHORTCUTS.map((s) => [s.id, s]));

export function byId(id: string): Shortcut {
  const s = BY_ID.get(id);
  if (!s) throw new Error(`Unknown shortcut id: ${id}`);
  return s;
}

/** Electron accelerator string for a shortcut's primary chord. */
export function accelFor(id: string): string {
  return toAccelerator(byId(id).chords[0]);
}

/** The MenuAction for a menu-surface shortcut. Throws if the id is unknown or
 *  the shortcut has no menuAction (i.e. it is not surface 'menu'). Use instead
 *  of `byId(id).menuAction!`. */
export function menuActionFor(id: string): MenuAction {
  const s = byId(id);
  if (!s.menuAction) throw new Error(`Shortcut "${id}" has no menuAction`);
  return s.menuAction;
}
