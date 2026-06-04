// Process-neutral shortcut value type + the three projections from one logical
// binding: an Electron accelerator string (main process menu), a KeyboardEvent
// matcher (renderer keydown), and platform-formatted display caps (overlay).
// No DOM / Node / renderer imports — safe to load in both processes.

export type Mod = 'mod' | 'shift' | 'alt' | 'ctrl'; // 'mod' = ⌘ on mac / Ctrl elsewhere
export type Chord = { mods?: Mod[]; key: string };
export type Platform = 'mac' | 'other';

// Minimal keydown view — the real KeyboardEvent satisfies this structurally, and
// tests pass plain objects (same pattern as composerKeys.ts).
export interface ShortcutKeyEvent {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

// ── Accelerator (Electron) ──────────────────────────────────────────
const ACCEL_MOD: Record<Mod, string> = {
  mod: 'CmdOrCtrl',
  shift: 'Shift',
  alt: 'Alt',
  ctrl: 'Ctrl',
};

/** Stable modifier order for accelerator/caps output: mod → ctrl → alt → shift.
 *  Electron accepts any order; a fixed rank just keeps output deterministic. */
function modOrder(mods: Mod[]): Mod[] {
  const rank: Record<Mod, number> = { mod: 0, ctrl: 1, alt: 2, shift: 3 };
  return [...mods].sort((a, b) => rank[a] - rank[b]);
}

function acceleratorKey(key: string): string {
  // Single letters are uppercased; punctuation passes through verbatim.
  return key.length === 1 && /[a-z]/i.test(key) ? key.toUpperCase() : key;
}

export function toAccelerator(chord: Chord): string {
  const mods = modOrder(chord.mods ?? []).map((m) => ACCEL_MOD[m]);
  return [...mods, acceleratorKey(chord.key)].join('+');
}

// ── Display caps (overlay) ──────────────────────────────────────────
const MAC_MOD: Record<Mod, string> = { mod: '⌘', shift: '⇧', alt: '⌥', ctrl: '⌃' };
const OTHER_MOD: Record<Mod, string> = { mod: 'Ctrl', shift: 'Shift', alt: 'Alt', ctrl: 'Ctrl' }; // off-mac, 'mod' is also Ctrl — overlap is intentional

const NAMED_KEY_CAP: Record<string, string> = {
  Escape: '⎋',
  Enter: '⏎',
  Return: '⏎',
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
  Backspace: '⌫',
  Tab: '⇥',
  '1-9': '1…9', // display-only range token (never matched against a real key)
};

function capForKey(key: string): string {
  if (NAMED_KEY_CAP[key]) return NAMED_KEY_CAP[key];
  return key.length === 1 && /[a-z]/i.test(key) ? key.toUpperCase() : key;
}

export function toCaps(chord: Chord, platform: Platform): string[] {
  const modMap = platform === 'mac' ? MAC_MOD : OTHER_MOD;
  const mods = modOrder(chord.mods ?? []).map((m) => modMap[m]);
  return [...mods, capForKey(chord.key)];
}

// ── Event matcher (renderer) ────────────────────────────────────────
function isPunctuation(key: string): boolean {
  return key.length === 1 && !/[a-z0-9]/i.test(key);
}

export function matchesEvent(ev: ShortcutKeyEvent, chord: Chord): boolean {
  const mods = new Set(chord.mods ?? []);

  // mod (⌘ or Ctrl)
  const wantMod = mods.has('mod');
  if ((ev.metaKey || ev.ctrlKey) !== wantMod) return false;

  // alt
  if (ev.altKey !== mods.has('alt')) return false;

  // shift: enforce only when declared, or — for non-punctuation keys — enforce
  // its ABSENCE. Punctuation (e.g. '?') is produced via Shift, so ignore shift
  // there: '?' should fire whether or not the event reports shiftKey.
  if (mods.has('shift')) {
    if (!ev.shiftKey) return false;
  } else if (!isPunctuation(chord.key)) {
    if (ev.shiftKey) return false;
  }

  // key
  return ev.key.toLowerCase() === chord.key.toLowerCase();
}
