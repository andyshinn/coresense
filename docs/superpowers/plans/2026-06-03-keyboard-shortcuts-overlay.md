# Keyboard Shortcuts Help Overlay Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `?`-triggered Keyboard Shortcuts help overlay (the design's dense "Ledger" dialog) backed by a single cross-process shortcut registry that drives the native menu, the renderer keydown handler, and the overlay's displayed list.

**Architecture:** One process-neutral spec (`src/shared/shortcuts.ts` + `src/shared/shortcuts-format.ts`) holds every shortcut as data plus pure projection helpers (Electron accelerator string, `KeyboardEvent` matcher, platform-formatted display caps). `src/main/menu.ts` sources its accelerators from the spec; a renderer dispatcher binds the renderer-surface shortcuts from the spec; the overlay renders from the spec. New shortcuts (`?`, `⌘1–9`, `⌥↑/↓`, `⌘L`, `⌘⇧L`, `⌘⇧R`, `⌘⇧M`) are wired; the `⌘1–4` focus-section shortcuts are replaced by `⌘1–9` channel switching.

**Tech Stack:** Electron + React 19 + TypeScript, Zustand store, shadcn/ui (Dialog + a new Kbd), Tailwind v4 with `--cs-*` Field Console tokens, lucide-react, Vitest (node-env unit project), Playwright (e2e).

**Reference spec:** `docs/superpowers/specs/2026-06-03-keyboard-shortcuts-overlay-design.md`

---

## File Structure

**New files**
- `src/shared/shortcuts-format.ts` — pure types + projections (`toAccelerator`, `toCaps`, `matchesEvent`). No deps on `types.ts`. Process-neutral.
- `src/shared/shortcuts.ts` — the `SHORTCUTS` registry data + `byId` + `accelFor`. Imports `MenuAction` (type) and the format helpers.
- `src/renderer/lib/shortcut-selectors.ts` — renderer-only pure helpers: `isTypingTarget`, `nthChannelKey`, `adjacentUnreadKey`, `rendererPlatform`, `osLabel`.
- `src/renderer/lib/shortcut-resolve.ts` — pure `resolveShortcut`. Imports only `src/shared/*` (node-safe), so it is unit-testable in the node env. **Must not import the store** (the store touches `window.matchMedia` at module load and would crash a node-env test).
- `src/renderer/lib/shortcut-dispatch.ts` — side-effecting `dispatchShortcut` (imports `resolveShortcut` + the store + `useUnreads` + selectors). Imported only by `App.tsx`; covered by e2e, not unit tests.
- `src/renderer/components/ui/kbd.tsx` — themed shadcn `Kbd` + `KbdGroup`.
- `src/renderer/features/help-overlay/index.tsx` — `ShortcutsHelpDialog`.
- Tests under `tests/unit/...` and `tests/e2e/keyboard-shortcuts.spec.ts`.

**Modified files**
- `src/shared/types.ts` — `MenuAction`: remove `focusSection`, add `openPacketLog` / `reconnect` / `toggleRepeat`.
- `src/main/menu.ts` — source accelerators from spec; remove focus-section items; add Packet Log / Reconnect / Repeat items; add `⌘⇧L` to Cycle Theme.
- `src/renderer/app/menuActions.ts` — handle the three new `MenuAction`s.
- `src/renderer/hooks/useUnreads.ts` — extract pure `computeUnreadConversations` (used by the hook and the unread-nav selector).
- `src/renderer/lib/store.ts` — add `helpOpen` + `openHelp` / `closeHelp`.
- `src/renderer/App.tsx` — replace the hand-rolled keydown block with `dispatchShortcut`; mount `ShortcutsHelpDialog`.
- `src/renderer/features/command-palette/index.tsx` — use the shared `Kbd`.

**Conventions**
- Unit tests live in `tests/unit/...`, run in **node env** (no DOM), via `npm run test:unit`. Model on `tests/unit/renderer/lib/composerKeys.test.ts` — pure functions take a minimal event-shaped object.
- Lint/format is Biome, **scoped to `src tests`** (repo-wide trips on build artifacts): `npx biome check src tests`.
- Typecheck: `npm run typecheck`.
- Commit messages: `feat(shortcuts): …` / `test(shortcuts): …` / `refactor(shortcuts): …`.

---

## Task 1: Shortcut formatting & matching helpers (pure)

**Files:**
- Create: `src/shared/shortcuts-format.ts`
- Test: `tests/unit/shared/shortcuts-format.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/shared/shortcuts-format.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  type Chord,
  type ShortcutKeyEvent,
  matchesEvent,
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/shared/shortcuts-format.test.ts`
Expected: FAIL — cannot find module `../../../src/shared/shortcuts-format`.

- [ ] **Step 3: Write the implementation**

Create `src/shared/shortcuts-format.ts`:

```ts
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

/** Electron accelerator order mirrors Electron's own (Cmd, Ctrl, Alt, Shift is
 *  also accepted; we emit mod→shift→alt→ctrl which Electron parses fine). */
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
const OTHER_MOD: Record<Mod, string> = { mod: 'Ctrl', shift: 'Shift', alt: 'Alt', ctrl: 'Ctrl' };

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
  '1-9': '1…9',
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/shared/shortcuts-format.test.ts`
Expected: PASS (all cases green).

- [ ] **Step 5: Typecheck, then commit**

Run: `npm run typecheck` → Expected: no errors.
Run: `npx biome check src/shared/shortcuts-format.ts tests/unit/shared/shortcuts-format.test.ts` → Expected: no errors.

```bash
git add src/shared/shortcuts-format.ts tests/unit/shared/shortcuts-format.test.ts
git commit -m "feat(shortcuts): add process-neutral shortcut format/match helpers"
```

---

## Task 2: Renderer shortcut selectors (pure) + unread-conversation extraction

**Files:**
- Modify: `src/renderer/hooks/useUnreads.ts` (extract a pure function; no behavior change)
- Create: `src/renderer/lib/shortcut-selectors.ts`
- Test: `tests/unit/renderer/lib/shortcut-selectors.test.ts`

- [ ] **Step 1: Extract `computeUnreadConversations` from the hook**

In `src/renderer/hooks/useUnreads.ts`, add an exported pure function that contains the body currently inside `useUnreadConversations`'s `useMemo`, and have the hook call it. Replace the existing `useUnreadConversations` (lines 74–124) with:

```ts
// Pure core of useUnreadConversations — shared with non-React callers (e.g. the
// keyboard unread-nav selector). Joins unread keys against the channel/contact
// lists; keys with no matching conversation are dropped. Sorted newest-first.
export function computeUnreadConversations(
  messagesByKey: Record<string, Message[]>,
  lastReadByKey: Record<string, number>,
  channels: Channel[],
  contacts: Contact[],
): UnreadConversation[] {
  const channelByKey = new Map<string, Channel>();
  for (const ch of channels) channelByKey.set(ch.key, ch);
  const contactByKey = new Map<string, Contact>();
  for (const c of contacts) contactByKey.set(c.key, c);

  const out: UnreadConversation[] = [];
  for (const [key, list] of Object.entries(messagesByKey)) {
    const lastRead = lastReadByKey[key] ?? 0;
    const unread = list.filter((m) => isUnread(m, lastRead)).sort((a, b) => a.ts - b.ts);
    if (unread.length === 0) continue;
    const lastTs = unread[unread.length - 1].ts;

    const channel = channelByKey.get(key);
    if (channel) {
      if (channel.muted) continue;
      out.push({
        key,
        name: channel.name,
        kind: 'channel',
        channelKind: channel.kind,
        count: unread.length,
        messages: unread,
        lastTs,
      });
      continue;
    }
    const contact = contactByKey.get(key);
    if (contact) {
      if (contact.muted) continue;
      out.push({
        key,
        name: contact.name,
        kind: 'contact',
        contactKind: contact.kind,
        count: unread.length,
        messages: unread,
        lastTs,
      });
    }
  }
  out.sort((a, b) => b.lastTs - a.lastTs);
  return out;
}

// Rich aggregate hook — what the Unreads panel needs.
export function useUnreadConversations(): UnreadConversation[] {
  const messagesByKey = useStore((s) => s.messagesByKey);
  const lastReadByKey = useStore((s) => s.ui.lastReadByKey);
  const channels = useStore((s) => s.channels);
  const contacts = useStore((s) => s.contacts);

  return useMemo(
    () => computeUnreadConversations(messagesByKey, lastReadByKey, channels, contacts),
    [messagesByKey, lastReadByKey, channels, contacts],
  );
}
```

- [ ] **Step 2: Verify the existing unread tests still pass (no behavior change)**

Run: `npx vitest run tests/unit` (the unread/leftnav logic has existing coverage; nothing should change)
Expected: PASS. If no direct test exists, run `npm run typecheck` → Expected: no errors.

- [ ] **Step 3: Write the failing selectors test**

Create `tests/unit/renderer/lib/shortcut-selectors.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { Channel } from '../../../../src/shared/types';
import {
  adjacentUnreadKey,
  isTypingTarget,
  nthChannelKey,
} from '../../../../src/renderer/lib/shortcut-selectors';

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
  it('is false for non-editable elements and null', () => {
    const div = { tagName: 'DIV', isContentEditable: false } as unknown as EventTarget;
    expect(isTypingTarget(div)).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `npx vitest run tests/unit/renderer/lib/shortcut-selectors.test.ts`
Expected: FAIL — cannot find module `shortcut-selectors`.

- [ ] **Step 5: Write the implementation**

Create `src/renderer/lib/shortcut-selectors.ts`:

```ts
import type { Channel } from '../../shared/types';
import type { Platform } from '../../shared/shortcuts-format';
import { sortChannels } from '../shell/leftnav/sorting';

/** True when a keydown originated in an editable field — used to suppress
 *  bare-key shortcuts (?, ⌥↑/↓) while the user is typing. */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!target) return false;
  const el = target as { tagName?: string; isContentEditable?: boolean };
  if (el.isContentEditable) return true;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA';
}

/** Key of the Nth channel (1-based) in left-nav sort order, or null. Unread
 *  ordering is intentionally ignored so ⌘1–9 stays positionally stable. */
export function nthChannelKey(
  channels: Channel[],
  pinSet: Set<string>,
  pinnedOrder: string[],
  n: number,
): string | null {
  const sorted = sortChannels(channels, pinSet, pinnedOrder, null);
  return sorted[n - 1]?.key ?? null;
}

/** Given conversation keys in display order, return the next/previous one
 *  relative to `currentKey`, wrapping around. When `currentKey` is not in the
 *  list, returns the first (next) or last (prev) entry. Null if empty. */
export function adjacentUnreadKey(
  orderedKeys: string[],
  currentKey: string,
  dir: 'next' | 'prev',
): string | null {
  if (orderedKeys.length === 0) return null;
  const i = orderedKeys.indexOf(currentKey);
  if (i === -1) return dir === 'next' ? orderedKeys[0] : orderedKeys[orderedKeys.length - 1];
  const len = orderedKeys.length;
  const j = dir === 'next' ? (i + 1) % len : (i - 1 + len) % len;
  return orderedKeys[j];
}

/** Coarse platform for display formatting (caps glyphs). */
export function rendererPlatform(): Platform {
  const p =
    (navigator as { userAgentData?: { platform?: string } }).userAgentData?.platform ??
    navigator.platform ??
    '';
  return /mac/i.test(p) ? 'mac' : 'other';
}

/** Human OS label for the dialog kicker. */
export function osLabel(): string {
  const p =
    (navigator as { userAgentData?: { platform?: string } }).userAgentData?.platform ??
    navigator.platform ??
    '';
  if (/mac/i.test(p)) return 'macOS';
  if (/win/i.test(p)) return 'Windows';
  return 'Linux';
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run tests/unit/renderer/lib/shortcut-selectors.test.ts`
Expected: PASS.

- [ ] **Step 7: Typecheck, lint, commit**

Run: `npm run typecheck` → Expected: no errors.
Run: `npx biome check src/renderer/hooks/useUnreads.ts src/renderer/lib/shortcut-selectors.ts tests/unit/renderer/lib/shortcut-selectors.test.ts` → Expected: no errors.

```bash
git add src/renderer/hooks/useUnreads.ts src/renderer/lib/shortcut-selectors.ts tests/unit/renderer/lib/shortcut-selectors.test.ts
git commit -m "feat(shortcuts): add renderer shortcut selectors; extract computeUnreadConversations"
```

---

## Task 3: MenuAction union + shortcut registry + menu wiring

This task lands the cross-process spec data and its two main-process consumers together, because the `MenuAction` type change breaks `menu.ts` until all three are updated. It ends with a green typecheck.

**Files:**
- Modify: `src/shared/types.ts:778-791` (MenuAction union)
- Create: `src/shared/shortcuts.ts`
- Modify: `src/main/menu.ts`
- Modify: `src/renderer/app/menuActions.ts`
- Test: `tests/unit/shared/shortcuts.test.ts`

- [ ] **Step 1: Update the `MenuAction` union**

In `src/shared/types.ts`, edit the `MenuAction` union (starts at line 778). Remove the `focusSection` line and add three new kinds. Replace:

```ts
  | { kind: 'focusSection'; section: 'channels' | 'contacts' | 'tools' | 'connection' }
```

with:

```ts
  | { kind: 'openPacketLog' }
  | { kind: 'reconnect' }
  | { kind: 'toggleRepeat' }
```

- [ ] **Step 2: Write the failing registry test**

Create `tests/unit/shared/shortcuts.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { SHORTCUTS, accelFor, byId } from '../../../src/shared/shortcuts';

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
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/unit/shared/shortcuts.test.ts`
Expected: FAIL — cannot find module `../../../src/shared/shortcuts`.

- [ ] **Step 4: Write the registry**

Create `src/shared/shortcuts.ts`:

```ts
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
```

- [ ] **Step 5: Run the registry test to verify it passes**

Run: `npx vitest run tests/unit/shared/shortcuts.test.ts`
Expected: PASS.

- [ ] **Step 6: Refactor `menu.ts` to source accelerators from the spec**

In `src/main/menu.ts`:

Add the import at the top (after the existing imports):

```ts
import { accelFor, byId } from '../shared/shortcuts';
```

Replace the **macOS app-menu Settings** item (lines ~22-26) so its accelerator comes from the spec:

```ts
        {
          label: 'Settings…',
          accelerator: accelFor('settings'),
          click: send(byId('settings').menuAction!),
        },
```

Replace the **File menu** submenu array (the `submenu` of the `'File'` template, lines ~41-74) with:

```ts
    submenu: [
      {
        label: 'New Channel',
        accelerator: `${mod}+N`,
        click: send({ kind: 'newChannel' }),
      },
      {
        label: 'Add Contact',
        accelerator: `${mod}+Shift+N`,
        click: send({ kind: 'addContact' }),
      },
      { type: 'separator' },
      {
        label: 'Send Advert',
        accelerator: accelFor('sendAdvert'),
        click: send(byId('sendAdvert').menuAction!),
      },
      {
        label: 'Reconnect Radio',
        accelerator: accelFor('reconnect'),
        click: send(byId('reconnect').menuAction!),
      },
      {
        label: 'Toggle Repeat Mode',
        accelerator: accelFor('toggleRepeat'),
        click: send(byId('toggleRepeat').menuAction!),
      },
      {
        label: 'Disconnect Radio',
        click: send({ kind: 'disconnect' }),
      },
      ...(isMac
        ? []
        : ([
            { type: 'separator' },
            {
              label: 'Settings…',
              accelerator: accelFor('settings'),
              click: send(byId('settings').menuAction!),
            },
            { type: 'separator' },
            { role: 'quit' },
          ] satisfies MenuItemConstructorOptions[])),
    ],
```

Replace the **View menu** submenu array (lines ~92-143) with (note: the four Focus items are removed; Packet Log is added; Cycle Theme gains an accelerator):

```ts
    submenu: [
      {
        label: 'Command Palette…',
        accelerator: accelFor('commandPalette'),
        click: send(byId('commandPalette').menuAction!),
      },
      { type: 'separator' },
      {
        label: 'Toggle Left Nav',
        accelerator: accelFor('toggleSidebar'),
        click: send(byId('toggleSidebar').menuAction!),
      },
      {
        label: 'Toggle Right Rail',
        accelerator: accelFor('toggleRightRail'),
        click: send(byId('toggleRightRail').menuAction!),
      },
      {
        label: 'Packet Log',
        accelerator: accelFor('packetLog'),
        click: send(byId('packetLog').menuAction!),
      },
      { type: 'separator' },
      {
        label: 'Cycle Theme',
        accelerator: accelFor('toggleTheme'),
        click: send(byId('toggleTheme').menuAction!),
      },
      { type: 'separator' },
      { role: 'reload' },
      { role: 'toggleDevTools' },
      { role: 'resetZoom' },
      { role: 'zoomIn' },
      { role: 'zoomOut' },
      { type: 'separator' },
      { role: 'togglefullscreen' },
    ],
```

In the **Navigate menu**, replace the Previous Pinned / Next Pinned / Pin items (lines ~160-175) with:

```ts
      {
        label: 'Previous Pinned',
        accelerator: accelFor('prevPinned'),
        click: send(byId('prevPinned').menuAction!),
      },
      {
        label: 'Next Pinned',
        accelerator: accelFor('nextPinned'),
        click: send(byId('nextPinned').menuAction!),
      },
      { type: 'separator' },
      {
        label: 'Pin / Unpin Current',
        accelerator: accelFor('pinCurrent'),
        click: send(byId('pinCurrent').menuAction!),
      },
```

> Note: `Back` / `Forward` (`Cmd+Left` / `Alt+Left`) stay hand-authored — they are platform-divergent and not shown in the overlay, so they are intentionally out of the spec. The local `const mod` is still used by New Channel / Add Contact / Back / Forward, so leave it in place.

- [ ] **Step 7: Add the three new handlers in `menuActions.ts`**

In `src/renderer/app/menuActions.ts`, add the import for `loadLastDevice` at the top:

```ts
import { loadLastDevice } from '../lib/lastDevice';
```

Then add these three `case` blocks inside the `switch (action.kind)` (e.g. right after the existing `sendAdvert` case):

```ts
      case 'openPacketLog':
        setActiveKey('tool:packetlog');
        break;
      case 'reconnect': {
        if (!baseUrl || !apiKey) break;
        const last = loadLastDevice();
        if (!last) {
          notify.error('No previous device to reconnect to');
          break;
        }
        const ts = useStore.getState().transportState;
        if (ts !== 'idle' && ts !== 'error') break; // already connected/connecting
        void api.connect({ baseUrl, apiKey }, last.id).catch((err) => {
          notify.error(`Reconnect failed: ${(err as Error).message}`, err);
        });
        break;
      }
      case 'toggleRepeat': {
        if (!baseUrl || !apiKey) break;
        const rs = useStore.getState().radioSettings;
        void api.putRadioSettings({ baseUrl, apiKey }, { ...rs, repeatMode: !rs.repeatMode }).then(
          () => notify.success(`Repeat mode ${rs.repeatMode ? 'disabled' : 'enabled'}`),
          (err) => notify.error(`Repeat toggle failed: ${(err as Error).message}`, err),
        );
        break;
      }
```

- [ ] **Step 8: Typecheck (catches the removed `focusSection` and verifies wiring)**

Run: `npm run typecheck`
Expected: no errors. (If `focusSection` is referenced anywhere else it surfaces here — there are no other references; the four menu items were removed in Step 6.)

- [ ] **Step 9: Run the registry test + lint**

Run: `npx vitest run tests/unit/shared/shortcuts.test.ts` → Expected: PASS.
Run: `npx biome check src/shared/types.ts src/shared/shortcuts.ts src/main/menu.ts src/renderer/app/menuActions.ts tests/unit/shared/shortcuts.test.ts` → Expected: no errors.

- [ ] **Step 10: Commit**

```bash
git add src/shared/types.ts src/shared/shortcuts.ts src/main/menu.ts src/renderer/app/menuActions.ts tests/unit/shared/shortcuts.test.ts
git commit -m "feat(shortcuts): shared registry drives menu accelerators; add packet-log/reconnect/repeat actions; ⌘1-9 replaces focus-section"
```

---

## Task 4: Renderer dispatcher + store `helpOpen` + App wiring

**Files:**
- Modify: `src/renderer/lib/store.ts` (add `helpOpen`, `openHelp`, `closeHelp`)
- Create: `src/renderer/lib/shortcut-resolve.ts` (pure; unit-tested)
- Create: `src/renderer/lib/shortcut-dispatch.ts` (side-effecting; e2e-covered)
- Modify: `src/renderer/App.tsx:83-101` (replace keydown block)
- Test: `tests/unit/renderer/lib/shortcut-resolve.test.ts`

> **Why two files:** the unit test must import only node-safe modules. `resolveShortcut` lives in `shortcut-resolve.ts` and imports nothing from the renderer store. `dispatchShortcut` (which calls store actions) lives in `shortcut-dispatch.ts` and is exercised by the e2e test, not the unit suite.

- [ ] **Step 1: Add `helpOpen` state to the store**

In `src/renderer/lib/store.ts`:

Add to the state interface, right after `paletteOpen: boolean;` (line 299):

```ts
  // Keyboard-shortcuts help overlay open state. Not persisted across reloads.
  helpOpen: boolean;
```

Add to the actions interface, right after `closePalette: () => void;` (line 404):

```ts
  openHelp: () => void;
  closeHelp: () => void;
```

Add to the initial state, right after `paletteOpen: false,` (line 534):

```ts
  helpOpen: false,
```

Add to the action implementations, right after the `closePalette` implementation (line 862):

```ts
  openHelp: () => set(() => ({ helpOpen: true })),
  closeHelp: () => set(() => ({ helpOpen: false })),
```

- [ ] **Step 2: Write the failing resolver test**

Create `tests/unit/renderer/lib/shortcut-resolve.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { ShortcutKeyEvent } from '../../../../src/shared/shortcuts-format';
import { resolveShortcut } from '../../../../src/renderer/lib/shortcut-resolve';

function ev(over: Partial<ShortcutKeyEvent> = {}): ShortcutKeyEvent {
  return { key: 'k', metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, ...over };
}

describe('resolveShortcut', () => {
  it('matches a renderer-surface shortcut and returns its id', () => {
    expect(resolveShortcut(ev({ metaKey: true, key: 'f' }), false)?.id).toBe('quickFind');
    expect(resolveShortcut(ev({ shiftKey: true, key: 'Escape' }), false)?.id).toBe('markAllRead');
    expect(resolveShortcut(ev({ key: '?', shiftKey: true }), false)?.id).toBe('help');
    expect(resolveShortcut(ev({ altKey: true, key: 'ArrowDown' }), false)?.id).toBe('nextUnread');
  });

  it('matches ⌘ + digit as switchChannel', () => {
    expect(resolveShortcut(ev({ metaKey: true, key: '3' }), false)?.id).toBe('switchChannel');
    expect(resolveShortcut(ev({ metaKey: true, key: '0' }), false)).toBeNull(); // 0 is out of 1-9
  });

  it('suppresses guarded shortcuts while typing', () => {
    expect(resolveShortcut(ev({ key: '?', shiftKey: true }), true)).toBeNull(); // help guarded
    expect(resolveShortcut(ev({ altKey: true, key: 'ArrowDown' }), true)).toBeNull(); // unread-nav guarded
  });

  it('keeps unguarded shortcuts working while typing', () => {
    expect(resolveShortcut(ev({ metaKey: true, key: 'f' }), true)?.id).toBe('quickFind');
    expect(resolveShortcut(ev({ shiftKey: true, key: 'Escape' }), true)?.id).toBe('markAllRead');
  });

  it('never resolves menu- or contextual-surface shortcuts', () => {
    // ⌘\ is a menu shortcut (toggleSidebar) — handled by Electron, not here.
    expect(resolveShortcut(ev({ metaKey: true, key: '\\' }), false)).toBeNull();
    // bare Enter is contextual (composer) — not a global shortcut.
    expect(resolveShortcut(ev({ key: 'Enter' }), false)).toBeNull();
  });

  it('returns null for unmapped keys', () => {
    expect(resolveShortcut(ev({ key: 'q' }), false)).toBeNull();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/unit/renderer/lib/shortcut-resolve.test.ts`
Expected: FAIL — cannot find module `shortcut-resolve`.

- [ ] **Step 4: Write the pure resolver**

Create `src/renderer/lib/shortcut-resolve.ts` (imports only `src/shared/*` — node-safe, no store):

```ts
import { type Shortcut, SHORTCUTS } from '../../shared/shortcuts';
import { type ShortcutKeyEvent, matchesEvent } from '../../shared/shortcuts-format';

const RENDERER_SHORTCUTS = SHORTCUTS.filter((s) => s.surface === 'renderer');

function isDigit1to9(key: string): boolean {
  return key.length === 1 && key >= '1' && key <= '9';
}

/** Pure resolution: which renderer-surface shortcut (if any) this event triggers.
 *  `isTyping` suppresses shortcuts flagged `guardTyping`. */
export function resolveShortcut(ev: ShortcutKeyEvent, isTyping: boolean): Shortcut | null {
  for (const s of RENDERER_SHORTCUTS) {
    if (s.guardTyping && isTyping) continue;
    for (const chord of s.chords) {
      // switchChannel's chord key is the literal range token '1-9'; match any
      // 1–9 digit with the mod held (and no shift/alt).
      if (chord.key === '1-9') {
        const wantMod = chord.mods?.includes('mod') ?? false;
        if ((ev.metaKey || ev.ctrlKey) === wantMod && !ev.shiftKey && !ev.altKey && isDigit1to9(ev.key)) {
          return s;
        }
        continue;
      }
      if (matchesEvent(ev, chord)) return s;
    }
  }
  return null;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/unit/renderer/lib/shortcut-resolve.test.ts`
Expected: PASS.

- [ ] **Step 6: Write the side-effecting dispatcher**

Create `src/renderer/lib/shortcut-dispatch.ts` (this one imports the store; it is NOT unit-tested — the e2e test in Task 7 covers it):

```ts
import type { ShortcutKeyEvent } from '../../shared/shortcuts-format';
import { computeUnreadConversations } from '../hooks/useUnreads';
import { resolveShortcut } from './shortcut-resolve';
import { adjacentUnreadKey, nthChannelKey } from './shortcut-selectors';
import { useStore } from './store';

/** Run the side effect for a resolved shortcut id. */
function run(id: string, ev: ShortcutKeyEvent): void {
  const s = useStore.getState();
  switch (id) {
    case 'help':
      s.openHelp();
      break;
    case 'quickFind':
      s.setActiveKey('tool:search');
      s.requestSearchFocus();
      break;
    case 'markAllRead':
      s.markAllReadGlobal();
      break;
    case 'nextUnread':
    case 'prevUnread': {
      const ordered = computeUnreadConversations(
        s.messagesByKey,
        s.ui.lastReadByKey,
        s.channels,
        s.contacts,
      ).map((u) => u.key);
      const target = adjacentUnreadKey(ordered, s.ui.activeKey, id === 'nextUnread' ? 'next' : 'prev');
      if (target) s.setActiveKey(target);
      break;
    }
    case 'switchChannel': {
      const n = Number(ev.key);
      const key = nthChannelKey(s.channels, new Set(s.ui.pinned), s.ui.pinned, n);
      if (key) s.setActiveKey(key);
      break;
    }
    default:
      break;
  }
}

function isTypingTargetFromEvent(e: KeyboardEvent): boolean {
  const t = e.target as { tagName?: string; isContentEditable?: boolean } | null;
  if (!t) return false;
  if (t.isContentEditable) return true;
  return t.tagName === 'INPUT' || t.tagName === 'TEXTAREA';
}

/** Match a global keydown against renderer-surface shortcuts and execute it.
 *  Returns true when handled (caller should preventDefault). */
export function dispatchShortcut(e: KeyboardEvent): boolean {
  const sc = resolveShortcut(e, isTypingTargetFromEvent(e));
  if (!sc) return false;
  run(sc.id, e);
  return true;
}
```

- [ ] **Step 7: Wire the dispatcher into `App.tsx`**

In `src/renderer/App.tsx`, add the import near the other lib imports:

```ts
import { dispatchShortcut } from './lib/shortcut-dispatch';
```

Replace the entire keydown `useEffect` block (lines 83-101, the one with the `Cmd/Ctrl+K` comment above it) with:

```ts
  // Global keyboard shortcuts. The native menu accelerators handle the
  // menu-surface bindings even when an input is focused; this listener owns the
  // renderer-surface ones (Quick find, Help, unread-nav, ⌘1-9, Mark all read).
  // See src/shared/shortcuts.ts for the single source of truth.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (dispatchShortcut(e)) e.preventDefault();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
```

- [ ] **Step 8: Typecheck, lint, commit**

Run: `npm run typecheck` → Expected: no errors.
Run: `npx biome check src/renderer/lib/store.ts src/renderer/lib/shortcut-resolve.ts src/renderer/lib/shortcut-dispatch.ts src/renderer/App.tsx tests/unit/renderer/lib/shortcut-resolve.test.ts` → Expected: no errors.

```bash
git add src/renderer/lib/store.ts src/renderer/lib/shortcut-resolve.ts src/renderer/lib/shortcut-dispatch.ts src/renderer/App.tsx tests/unit/renderer/lib/shortcut-resolve.test.ts
git commit -m "feat(shortcuts): renderer resolver + dispatcher + helpOpen state; wire global keydown to the registry"
```

---

## Task 5: shadcn `Kbd` component

**Files:**
- Create: `src/renderer/components/ui/kbd.tsx`
- Modify: `src/renderer/features/command-palette/index.tsx` (use the shared `Kbd`)

- [ ] **Step 1: Create the `Kbd` component**

Create `src/renderer/components/ui/kbd.tsx`:

```tsx
import type * as React from 'react';
import { cn } from '@/lib/utils';

// shadcn-style Kbd, themed to the MeshCore "ledger" spec: outline (hairline)
// caps — 20px tall, 20px min-width, 4px radius, transparent fill, mono 11px.
function Kbd({ className, ...props }: React.ComponentProps<'kbd'>) {
  return (
    <kbd
      data-slot="kbd"
      className={cn(
        'inline-flex h-5 min-w-5 items-center justify-center rounded border border-cs-border-strong bg-transparent px-1.5 font-mono text-[11px] leading-none text-cs-text-muted',
        className,
      )}
      {...props}
    />
  );
}

// A row of caps forming one chord (e.g. ⌘ K), 3px gaps.
function KbdGroup({ className, ...props }: React.ComponentProps<'span'>) {
  return (
    <span data-slot="kbd-group" className={cn('inline-flex items-center gap-[3px]', className)} {...props} />
  );
}

export { Kbd, KbdGroup };
```

- [ ] **Step 2: Use the shared `Kbd` in the command palette**

In `src/renderer/features/command-palette/index.tsx`:

Add the import (with the other `../../components/ui/*` imports near the top):

```tsx
import { Kbd } from '../../components/ui/kbd';
```

Delete the local `Kbd` function (lines 191-197):

```tsx
function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="rounded border border-cs-border bg-cs-bg-3 px-1 py-px font-mono text-[10px] text-cs-text-muted">
      {children}
    </kbd>
  );
}
```

Update the three footer usages (lines 183-185) to preserve the palette's smaller, filled look via className overrides:

```tsx
        <Kbd className="h-auto min-w-0 border-cs-border bg-cs-bg-3 px-1 py-px text-[10px]">↑↓</Kbd> navigate
        <Kbd className="h-auto min-w-0 border-cs-border bg-cs-bg-3 px-1 py-px text-[10px]">↵</Kbd> run
        <Kbd className="h-auto min-w-0 border-cs-border bg-cs-bg-3 px-1 py-px text-[10px]">esc</Kbd> close
```

- [ ] **Step 3: Typecheck, lint, commit**

Run: `npm run typecheck` → Expected: no errors.
Run: `npx biome check src/renderer/components/ui/kbd.tsx src/renderer/features/command-palette/index.tsx` → Expected: no errors.

```bash
git add src/renderer/components/ui/kbd.tsx src/renderer/features/command-palette/index.tsx
git commit -m "feat(shortcuts): add themed shadcn Kbd/KbdGroup; reuse in command palette"
```

---

## Task 6: The help overlay dialog

**Files:**
- Create: `src/renderer/features/help-overlay/index.tsx`
- Modify: `src/renderer/App.tsx` (mount `<ShortcutsHelpDialog />`)

- [ ] **Step 1: Create the overlay component**

Create `src/renderer/features/help-overlay/index.tsx`:

```tsx
import { Keyboard, X } from 'lucide-react';
import { Fragment, useMemo } from 'react';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '../../components/ui/dialog';
import { Kbd, KbdGroup } from '../../components/ui/kbd';
import { type ShortcutCategory, SHORTCUTS } from '../../shared/shortcuts';
import { toCaps } from '../../shared/shortcuts-format';
import { osLabel, rendererPlatform } from '../../lib/shortcut-selectors';
import { useStore } from '../../lib/store';

const CATEGORY_ORDER: ShortcutCategory[] = ['General', 'Navigation', 'Messages', 'Radio'];

export function ShortcutsHelpDialog() {
  const open = useStore((s) => s.helpOpen);
  const closeHelp = useStore((s) => s.closeHelp);
  const platform = rendererPlatform();

  // Group the registry by category, preserving registry order within each.
  const grouped = useMemo(() => {
    return CATEGORY_ORDER.map((category) => ({
      category,
      items: SHORTCUTS.filter((s) => s.category === category),
    })).filter((g) => g.items.length > 0);
  }, []);

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) closeHelp();
      }}
    >
      <DialogContent
        showCloseButton={false}
        data-testid="help-overlay"
        className="flex max-h-[calc(100%-2rem)] w-[640px] max-w-[calc(100%-2rem)] flex-col gap-0 overflow-hidden rounded-[7px] border border-cs-border-strong bg-cs-bg-2 p-0 text-cs-text shadow-[0_28px_70px_rgba(0,0,0,0.6),0_2px_8px_rgba(0,0,0,0.4)]"
      >
        {/* Header */}
        <div className="flex shrink-0 items-start gap-3 border-b border-cs-border px-[18px] pt-[15px] pb-[13px]">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-[9px]">
              <Keyboard size={14} className="text-cs-accent" />
              <DialogTitle className="text-[14px] font-semibold tracking-[0.1px] text-cs-text">
                Keyboard Shortcuts
              </DialogTitle>
            </div>
            <div className="mt-1 font-mono text-[10px] tracking-[0.3px] text-cs-text-dim">
              MeshCore Desktop · {osLabel()}
            </div>
            <DialogDescription className="sr-only">
              A reference list of every keyboard shortcut, grouped by category.
            </DialogDescription>
          </div>
          <DialogClose
            className="-mt-px flex size-6 shrink-0 items-center justify-center rounded border border-cs-border bg-cs-bg-3 text-cs-text-muted hover:text-cs-text"
            aria-label="Close"
          >
            <X size={11} />
          </DialogClose>
        </div>

        {/* Body */}
        <div className="min-h-0 flex-1 overflow-y-auto pb-2.5">
          {/* Sticky column header */}
          <div className="sticky top-0 z-10 grid grid-cols-[170px_132px_1fr] gap-[14px] border-b border-cs-border bg-cs-bg-2 px-[18px] py-[9px] font-mono text-[9px] tracking-[0.6px] text-cs-text-dim">
            <span>ACTION</span>
            <span>KEYS</span>
            <span>DESCRIPTION</span>
          </div>
          {grouped.map((group) => (
            <div key={group.category}>
              <div className="bg-cs-bg px-[18px] pt-2 pb-[5px] font-mono text-[9.5px] tracking-[0.8px] text-cs-accent-soft uppercase">
                {group.category}
              </div>
              {group.items.map((s) => (
                <div
                  key={s.id}
                  className="grid grid-cols-[170px_132px_1fr] items-center gap-[14px] border-b border-cs-bg-3 px-[18px] py-[7px]"
                >
                  <span className="text-[12px] font-medium text-cs-text">{s.name}</span>
                  <span className="flex flex-wrap items-center gap-1.5">
                    {s.chords.map((chord, ci) => (
                      <Fragment key={ci}>
                        {ci > 0 && <span className="font-mono text-[10px] text-cs-text-dim">or</span>}
                        <KbdGroup>
                          {toCaps(chord, platform).map((cap, ki) => (
                            <Kbd key={ki}>{cap}</Kbd>
                          ))}
                        </KbdGroup>
                      </Fragment>
                    ))}
                  </span>
                  <span className="text-[11px] leading-[1.4] text-cs-text-muted">{s.desc}</span>
                </div>
              ))}
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="flex shrink-0 items-center gap-[7px] border-t border-cs-border bg-cs-bg px-[18px] py-2.5 text-[11.5px] text-cs-text-dim">
          <span>Press</span>
          <Kbd>?</Kbd>
          <span>anytime to open this dialog.</span>
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Mount the overlay in `App.tsx`**

In `src/renderer/App.tsx`, add the import:

```tsx
import { ShortcutsHelpDialog } from './features/help-overlay';
```

In the main (connected) return — the `<AppShell client={client}>` branch — render it right next to `<CommandPalette …/>` (line 298):

```tsx
      <CommandPalette client={client} cycleThemePref={cycleThemePref} />
      <ShortcutsHelpDialog />
```

- [ ] **Step 3: Manual sanity (build + launch)**

Run: `npm run start`
Expected: app launches. Press `?` (with focus outside any text field) → the ledger dialog appears over a dimmed backdrop. Press `Esc` / click the dim overlay / click ✕ → it closes. Press `?` while focused in the composer or search input → nothing happens. Spot-check that the keys render with the right glyphs for your OS.

(If you cannot launch interactively, skip to Step 4 — the e2e test in Task 7 covers open/close behavior.)

- [ ] **Step 4: Typecheck, lint, commit**

Run: `npm run typecheck` → Expected: no errors.
Run: `npx biome check src/renderer/features/help-overlay/index.tsx src/renderer/App.tsx` → Expected: no errors.

```bash
git add src/renderer/features/help-overlay/index.tsx src/renderer/App.tsx
git commit -m "feat(shortcuts): add keyboard-shortcuts help overlay dialog"
```

---

## Task 7: e2e coverage for the overlay trigger

**Files:**
- Create: `tests/e2e/keyboard-shortcuts.spec.ts`

- [ ] **Step 1: Write the e2e test**

Create `tests/e2e/keyboard-shortcuts.spec.ts` (modeled on `tests/e2e/navigation.spec.ts`):

```ts
import { expect, test } from '@playwright/test';
import type { Channel } from '../../src/shared/types';
import { launchApp } from './support/launch';

const CHANNELS: Channel[] = [
  { key: 'ch:Public', name: 'Public', kind: 'public', idx: 0, secretHex: '00112233445566778899aabbccddeeff' },
];

test('opens and closes the keyboard shortcuts overlay with ?', async () => {
  const { page, close } = await launchApp({ channels: CHANNELS });
  try {
    const overlay = page.getByTestId('help-overlay');

    // Not present until summoned.
    await expect(overlay).toHaveCount(0);

    // "?" opens it (focus is on the document body, not a text field).
    await page.locator('body').click();
    await page.keyboard.press('Shift+/'); // "?" on a US layout
    await expect(overlay).toBeVisible();
    await expect(overlay.getByText('Keyboard Shortcuts')).toBeVisible();
    await expect(overlay.getByText('Command palette')).toBeVisible();

    // Esc closes it.
    await page.keyboard.press('Escape');
    await expect(overlay).toHaveCount(0);
  } finally {
    await close();
  }
});
```

- [ ] **Step 2: Run the e2e test**

Run: `npx playwright test tests/e2e/keyboard-shortcuts.spec.ts`
Expected: PASS. (If Playwright browsers are not installed in this environment, run `npx playwright install` first, or defer this test to CI and note it.)

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/keyboard-shortcuts.spec.ts
git commit -m "test(shortcuts): e2e for help overlay open/close"
```

---

## Task 8: Full verification sweep

**Files:** none (verification + any fixups)

- [ ] **Step 1: Run the whole unit suite**

Run: `npm run test:unit`
Expected: PASS, including the four new test files.

- [ ] **Step 2: Typecheck the whole project**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Lint + format check (scoped)**

Run: `npx biome check src tests`
Expected: no errors. If formatting differences exist, run `npx biome check --write src tests`, review the diff, and re-run.

- [ ] **Step 4: Final commit (only if Step 3 changed files)**

```bash
git add -A
git commit -m "chore(shortcuts): formatting + lint pass"
```

---

## Self-Review

**Spec coverage (each spec section → task):**
- Architecture / one spec, three consumers → Tasks 1, 3, 4, 6.
- Shared spec `shortcuts.ts` (types + helpers) → Tasks 1 (format/match) + 3 (data).
- Menu integration (accelerators from spec; remove focus-section; add packet-log/reconnect/repeat; ⌘⇧L on theme) → Task 3.
- Renderer dispatch + new MenuAction handlers → Tasks 3 (handlers) + 4 (dispatcher + App wiring).
- `Kbd` component (shadcn + ledger theming; reuse in palette) → Task 5.
- Overlay (Dialog, header/body/footer, sticky header, grid rows, store state, mount, platform kicker) → Tasks 4 (store `helpOpen`) + 6.
- Inventory (General/Navigation/Messages/Radio with the exact surfaces) → Task 3 `SHORTCUTS`.
- New behaviors (⌘1–9, ⌥↑/↓, Help guard) → Tasks 2 (selectors) + 4 (dispatcher).
- Conflict/collision check (⌘1–4 removed; ⌘L/⌘⇧L/⌘⇧R/⌘⇧M free) → Task 3.
- Testing (unit projections + selectors + resolve; e2e open/close) → Tasks 1, 2, 4, 7, 8.

**Placeholder scan:** none — every step ships concrete code or an exact command + expected output.

**Type consistency:** `Chord`/`Mod`/`Platform`/`ShortcutKeyEvent` defined in Task 1 and reused verbatim in Tasks 3/4/6. `Shortcut`/`Surface`/`ShortcutCategory` defined in Task 3 and reused in Tasks 4/6. `MenuAction` kinds (`openPacketLog`/`reconnect`/`toggleRepeat`) defined in Task 3 Step 1 and consumed in Task 3 Step 7. `computeUnreadConversations` defined in Task 2 and consumed in Task 4. `nthChannelKey`/`adjacentUnreadKey`/`isTypingTarget`/`rendererPlatform`/`osLabel` defined in Task 2 and consumed in Tasks 4/6. `helpOpen`/`openHelp`/`closeHelp` defined in Task 4 Step 1 and consumed in Tasks 4/6. `Kbd`/`KbdGroup` defined in Task 5 and consumed in Task 6.

**Known judgment calls (intentional):**
- Next/Prev unread cycles in the Unreads-panel order (newest-first by last activity), not nav order — simpler and matches the surface users associate with "unreads."
- ⌘1–9 ignores unread-to-top ordering so positions stay stable.
- `Esc` (Mark read) and `Enter`/`Shift+Enter` stay contextual (owned by their components); the overlay documents them but the dispatcher never binds them.
- Back/Forward stay hand-authored in `menu.ts` (platform-divergent, not shown in the overlay).
