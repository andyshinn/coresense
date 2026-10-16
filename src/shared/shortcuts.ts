import { type Chord, toAccelerator } from './shortcuts-format';
import type { MenuAction } from './types';

export type Surface = 'menu' | 'renderer' | 'contextual';
export type ShortcutCategory = 'General' | 'Navigation' | 'Messages' | 'Radio';

interface ShortcutBase<I extends string> {
  id: I;
  category: ShortcutCategory;
  name: string; // ACTION column
  desc: string; // DESCRIPTION column
  chords: readonly Chord[]; // alternates render as "A or B"; usually length 1
  guardTyping?: boolean; // renderer-surface: ignore while a text field has focus
}

/** A menu-surface shortcut carries the MenuAction its native menu item sends;
 *  no other surface may. */
type ShortcutDef<I extends string = string> =
  | (ShortcutBase<I> & { surface: 'menu'; menuAction: MenuAction })
  | (ShortcutBase<I> & { surface: 'renderer' | 'contextual'; menuAction?: never });

// The single source of truth. Order within a category is the overlay's row order.
const SHORTCUT_DEFS = [
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
  {
    id: 'reload',
    category: 'General',
    name: 'Reload window',
    desc: 'Reload the app window (developer / recovery).',
    chords: [{ mods: ['mod', 'shift'], key: 'e' }],
    surface: 'contextual',
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
    chords: [{ mods: ['mod', 'shift'], key: 'p' }],
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
  {
    id: 'cliReverseSearch',
    category: 'Radio',
    name: 'CLI reverse search',
    desc: 'Reverse-i-search the repeater CLI history from the console prompt.',
    chords: [{ mods: ['ctrl'], key: 'r' }],
    surface: 'contextual',
  },
  {
    id: 'cliClear',
    category: 'Radio',
    name: 'CLI clear',
    desc: 'Clear the repeater CLI transcript from the console prompt.',
    chords: [{ mods: ['ctrl'], key: 'l' }],
    surface: 'contextual',
  },
] as const satisfies readonly ShortcutDef[];

type ShortcutEntry = (typeof SHORTCUT_DEFS)[number];
export type ShortcutId = ShortcutEntry['id'];
export type Shortcut = ShortcutDef<ShortcutId>;
/** Ids of the shortcuts the native menu owns (and so have a menuAction). */
export type MenuShortcutId = Extract<ShortcutEntry, { surface: 'menu' }>['id'];
/** A shortcut the renderer's global keydown listener handles. */
export type RendererShortcut = Shortcut & { surface: 'renderer'; id: Extract<ShortcutEntry, { surface: 'renderer' }>['id'] };

/** The registry, widened so every entry exposes the optional fields. */
export const SHORTCUTS: readonly Shortcut[] = SHORTCUT_DEFS;

const BY_ID = new Map<ShortcutId, ShortcutEntry>(SHORTCUT_DEFS.map((s) => [s.id, s]));

export function byId<I extends ShortcutId>(id: I): Extract<ShortcutEntry, { id: I }> {
  // Every ShortcutId is in the map by construction.
  return BY_ID.get(id) as Extract<ShortcutEntry, { id: I }>;
}

/** Electron accelerator string for a shortcut's primary chord. */
export function accelFor(id: ShortcutId): string {
  return toAccelerator(byId(id).chords[0]);
}

/** The MenuAction a menu-surface shortcut's native menu item sends. */
export function menuActionFor(id: MenuShortcutId): MenuAction {
  return byId(id).menuAction;
}
