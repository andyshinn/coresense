# Keyboard Shortcuts: Help Overlay + Shared Registry — Design

- **Date:** 2026-06-03
- **Status:** Approved (ready for implementation plan)
- **Area:** shortcuts (`src/shared`, `src/main/menu.ts`, `src/renderer/App.tsx`,
  `src/renderer/app/menuActions.ts`, `src/renderer/features/help-overlay`,
  `src/renderer/components/ui/kbd.tsx`)
- **Design source:** Claude Design handoff `design_handoff_keyboard_shortcuts`
  (the dense "Ledger" dialog direction the user picked in chat11), built on
  shadcn `Dialog` + `Kbd`.

## Summary

Add a `?`-triggered **Keyboard Shortcuts help overlay** (the design's dense
`ACTION · KEYS · DESCRIPTION` ledger dialog) **and** make a single shared spec
the source of truth for every shortcut in the app, so the overlay can never
drift from what actually works.

coresense **is** the MeshCore Desktop app the design targets. Its existing
warm-dark "Field Console" palette already matches the design tokens exactly
(`--cs-bg` = `#0c0a06`, `--cs-accent` = `#f59e0b`), shadcn `Dialog` is already
present, and `lucide-react` is the icon set — so no re-theming and no new
dependencies are required.

The work is two-pronged:

1. **Overlay** — a high-fidelity recreation of the ledger dialog using shadcn
   `Dialog` + a new shadcn `Kbd`/`KbdGroup`, themed to the `--cs-*` tokens.
2. **Shared registry** — one process-neutral spec (`src/shared/shortcuts.ts`)
   that drives the native menu accelerators, the renderer keydown handler, and
   the overlay's displayed list, plus the genuinely-new shortcuts the design
   asked for.

## Decisions (from brainstorming)

- **Wiring scope:** *Maximal.* Build the overlay AND wire new shortcuts,
  including the harder ones (Next/Prev unread, ⌘1–9 channel switch). Drop the
  design's Reply and Message info entries — no backing feature exists.
- **Source of truth:** *Single shared cross-process spec.* `src/shared/shortcuts.ts`
  is THE list. `menu.ts` builds its accelerators from it, the renderer keydown
  handler binds the renderer-surface ones from it, and the overlay renders from
  it. Truly zero drift.
- **Key display:** *Platform-adaptive.* One logical binding projects to ⌘/⌥/⌃
  glyphs on macOS and Ctrl/Alt/Win equivalents on Windows/Linux. The header
  kicker reflects the real OS.
- **⌘1–9 conflict:** The existing `⌘1–4` "Focus Section" shortcuts are
  *replaced* by the design's `⌘1–9` "Switch channel." The `focusSection`
  `MenuAction` variant is removed (nothing else uses it — confirmed by grep).
- **Inventory breadth:** The overlay documents the app's *real* shortcuts, so it
  includes a few the original design omitted (right rail `⌘.`, pinned cycle
  `⌘[`/`⌘]`, pin `⌘D`). This is the no-drift payoff; the user opted to keep them.
- **Reconnect / Repeat mode:** Implemented as new `MenuAction`s (menu-owned,
  like the existing `sendAdvert`) rather than renderer-only, so they appear in
  the native menu and are discoverable.
- **Mark read (`Esc`):** Stays *contextual* (owned by the Unreads panel). It is
  documented in the overlay but NOT bound globally, so it never clobbers
  dialog/popover/palette dismissal.

## Architecture — one spec, three consumers

```
            src/shared/shortcuts.ts        ← THE list (data only, process-neutral)
           /            |            \
      menu.ts       renderer          ShortcutsHelpDialog
      (main)        keydown           (overlay)
      builds        binds the         renders grouped table;
      accelerators  surface:'renderer' formats keys per platform
      from spec     entries from spec
```

A shortcut's *logical binding* projects three ways from one definition:

- **Electron accelerator** (`CmdOrCtrl+Shift+A`) — consumed by `menu.ts`.
- **`KeyboardEvent` matcher** — consumed by the renderer keydown handler.
- **Display caps** (`⌘ ⇧ A` on macOS, `Ctrl Shift A` on Windows) — consumed by
  the overlay. This is how "adapt to platform" is satisfied everywhere from a
  single source.

## Components

### 1. The shared spec — `src/shared/shortcuts.ts` (new)

Pure, serializable data — **no handler functions** (handlers reference renderer
store/api state, so they stay renderer-side; the spec only names the
`MenuAction` for menu-surface entries).

```ts
type Mod = 'mod' | 'shift' | 'alt' | 'ctrl';   // 'mod' = ⌘ on mac / Ctrl elsewhere
type Chord = { mods?: Mod[]; key: string };     // one combo; key e.g. 'k' ',' '\\' '?' 'Escape' 'ArrowUp' '1-9'
type Surface = 'menu' | 'renderer' | 'contextual';
type ShortcutCategory = 'General' | 'Navigation' | 'Messages' | 'Radio';

type Shortcut = {
  id: string;                  // 'commandPalette', 'help', 'nextUnread', …
  category: ShortcutCategory;
  name: string;                // ACTION column
  desc: string;                // DESCRIPTION column
  chords: Chord[];             // alternates (Help = ⇧? or ?); usually length 1
  surface: Surface;            // who binds it (see Inventory)
  menuAction?: MenuAction;     // required when surface === 'menu'
  guardTyping?: boolean;       // renderer-surface: ignore when target is input/textarea/contenteditable
};

export const SHORTCUTS: Shortcut[] = [ /* … grouped by category, see Inventory … */ ];
export function byId(id: string): Shortcut; // lookup helper for menu.ts
```

Formatting/matching helpers (same module or sibling `shortcuts-format.ts`):

- `toAccelerator(chord: Chord): string` — `mod`→`CmdOrCtrl`, etc. → Electron string.
- `matchesEvent(e: KeyboardEvent, chord: Chord): boolean` — `mod`→`e.metaKey||e.ctrlKey`,
  `shift`→`e.shiftKey`, `alt`→`e.altKey`, plus key comparison (case-insensitive
  for letters; special-case the `1-9` digit token).
- `toCaps(chord: Chord, platform: 'mac' | 'other'): string[]` — `mod`→`⌘`/`Ctrl`,
  `shift`→`⇧`/`Shift`, `alt`→`⌥`/`Alt`, `ctrl`→`⌃`/`Ctrl`, `Escape`→`⎋`/`Esc`,
  `Enter`/`Return`→`⏎`, `ArrowUp`→`↑`, `ArrowDown`→`↓`, letters uppercased,
  `1-9`→`1…9`. Platform derived from `process.platform` (main) or
  `navigator.platform`/`userAgentData` (renderer).

### 2. Menu integration — `src/main/menu.ts` (modified)

Keep the menu's structure (roles, separators, submenu grouping); **source each
accelerator and click action from the spec by id** instead of hardcoding:

```ts
accelerator: toAccelerator(byId('toggleLeftNav').chords[0]),
click: send(byId('toggleLeftNav').menuAction!),
```

Concrete changes:

- **Remove** the four `⌘1–4` "Focus Channels/Contacts/Tools/Connection" items.
- **Remove** the `focusSection` variant from the `MenuAction` union in
  `src/shared/types.ts` (and its now-dead handling, if any — there is none in
  `menuActions.ts`).
- **Add** accelerator `⌘⇧L` to the existing "Cycle Theme" item.
- **Add** items: "Packet Log" (`⌘L`), "Reconnect Radio" (`⌘⇧R`), "Toggle Repeat
  Mode" (`⌘⇧M`), placed in sensible submenus (View / File).
- **Add** `MenuAction` variants: `openPacketLog`, `reconnect`, `toggleRepeat`.

### 3. Renderer dispatch — `src/renderer/App.tsx` + `menuActions.ts` (modified)

- Replace the hand-rolled `if/else` keydown block at `App.tsx:83–101` with a loop
  over `SHORTCUTS.filter(s => s.surface === 'renderer')`, using `matchesEvent`
  and honoring `guardTyping`. This folds in the existing ⌘F and ⇧Esc handlers
  and adds Help `?`, unread-nav, and ⌘1–9. The handler reads renderer state via
  `useStore.getState()` and pure selectors (no React hooks inside the listener).
- Extend `createMenuActionHandler` with three new cases, mirroring the existing
  `sendAdvert` case (which already uses `{ baseUrl, apiKey }` + `api`):
  - `openPacketLog` → `setActiveKey('tool:packetlog')`.
  - `reconnect` → load last device id, `api.connect(client, deviceId)` (guard on
    transport state idle/error), with `notify` on failure.
  - `toggleRepeat` → `api.putRadioSettings(client, { ...radioSettings,
    repeatMode: !radioSettings.repeatMode })`.

### 4. The `Kbd` component — `src/renderer/components/ui/kbd.tsx` (new)

Add shadcn's `Kbd` + `KbdGroup` (the README's explicit request). Theme the cap to
the ledger spec:

- Cap: `min-width 20px`, `height 20px`, `padding 0 6px`, `radius 4px`,
  `border 1px solid` `--cs-border-strong`, transparent background, mono 11px,
  `line-height 1`, color `--cs-text-muted`.
- `KbdGroup`: caps in a row, `gap 3px`. Alternate chords joined by a muted
  lowercase "or" (mono 10px, `--cs-text-dim`, `gap 6px`). Left-aligned in the
  132px KEYS column.

Replace the inline `<kbd>` in `src/renderer/features/command-palette/index.tsx`
with this shared component.

### 5. The overlay — `src/renderer/features/help-overlay/` (new)

`ShortcutsHelpDialog` built on shadcn `Dialog` / `DialogContent` /
`DialogHeader` / `DialogTitle`:

- **Panel:** 640px, `max-width 100%`, warm-dark (`--cs-bg-2`), radius 7px,
  border `--cs-border-strong`, the design's drop shadow.
- **Header:** `lucide-react` `Keyboard` glyph (amber), title "Keyboard
  Shortcuts", mono kicker `MeshCore Desktop · <OS>`, `X` close button.
- **Body (scrollable):** sticky column header `ACTION | KEYS | DESCRIPTION`;
  per category an amber uppercase mono subhead; data rows as a
  `grid-template-columns: 170px 132px 1fr` grid (gap 14px, padding `7px 18px`,
  hairline `--cs-bg-3` bottom border). Keys via `Kbd`/`KbdGroup` with
  platform-formatted caps.
- **Footer:** hint "Press `?` anytime to open this dialog."
- Rows are non-interactive. Esc / overlay-click / ✕ close come free from shadcn
  `Dialog` `onOpenChange`. shadcn's default subtle fade/zoom is acceptable.
- Mounted once in `src/renderer/shell/AppShell.tsx`.

### 6. State — `src/renderer/lib/store.ts` (modified)

Add `helpOpen: boolean` plus `openHelp()` / `closeHelp()`, mirroring the existing
`paletteOpen` / `openPalette` / `closePalette` pattern.

## The shortcut inventory (what the overlay shows)

Surface in *(italics)*.

**General**
- Command palette — `⌘K` *(menu)* — Open the command palette to jump anywhere or run a command.
- Quick find — `⌘F` *(renderer)* — Search across contacts, channels, and message history.
- Settings — `⌘,` *(menu)* — Open identity, radio preset, and application settings.
- Toggle theme — `⌘⇧L` *(menu)* — Cycle the console theme: auto → dark → light.
- Help — `?` / `⇧?` *(renderer, guarded)* — Open this help dialog when used outside a text box.

**Navigation**
- Switch channel — `⌘1…9` *(renderer)* — Jump straight to a channel by its position in the list.
- Next unread — `⌥↓` *(renderer, guarded)* — Jump to the next conversation with unread messages.
- Previous unread — `⌥↑` *(renderer, guarded)* — Jump to the previous conversation with unread messages.
- Toggle sidebar — `⌘\` *(menu)* — Show or hide the channels & contacts sidebar.
- Toggle right rail — `⌘.` *(menu)* — Show or hide the right detail rail.
- Packet log — `⌘L` *(menu)* — Open the raw RX / TX packet log feed.
- Previous / Next pinned — `⌘[` / `⌘]` *(menu)* — Cycle through pinned conversations.
- Pin / unpin current — `⌘D` *(menu)* — Pin or unpin the active conversation.

**Messages**
- Mark read — `Esc` *(contextual — Unreads panel)* — Mark the topmost channel or DM in the unreads pane as read.
- Mark all read — `⇧Esc` *(renderer)* — Mark every channel and DM as read.
- Send — `⏎` *(contextual — composer)* — Send the message currently in the composer.
- Insert line break — `⇧⏎` *(contextual — composer)* — Add a new line without sending.

**Radio**
- Reconnect radio — `⌘⇧R` *(menu)* — Reconnect the attached radio over USB, BLE, or TCP.
- Toggle repeat mode — `⌘⇧M` *(menu)* — Enable or disable repeat (relay) mode on this node.
- Send advert — `⌘⇧A` *(menu)* — Broadcast your presence to nearby nodes.

**Dropped:** Reply, Message info (no backing feature).

## New behavior detail

- **Switch channel `⌘1–9`:** build the ordered channel list via the existing
  `sortChannels` helper, `setActiveKey` the Nth (channels only — matches
  "channel"). No-op if fewer than N channels.
- **Next/Prev unread `⌥↑/↓`:** compute unread conversations from
  `computeUnreadByKey` against `useStore.getState()` (pure selector, no hooks),
  find the current index, wrap to the next/previous entry with unreads.
  `guardTyping` so it never hijacks Option+Arrow paragraph nav in the composer.
- **Help `?`:** renderer keydown; fires only when the event target is not an
  `<input>`, `<textarea>`, or `contenteditable`; calls `openHelp()` (matching
  the `⌘K` → `openPalette()` pattern). Close is via Esc / overlay / ✕.

## Conflict / collision check

- `⌘1–4` (focus section) → removed, freeing `⌘1–9` for channel switch.
- `⌘L` (packet log) → free (not currently a menu accelerator).
- `⌘⇧L` (theme) → free; added to the existing Cycle Theme item.
- `⌘⇧R` (reconnect) → free (note `⌘R` is `reload`; `⌘⇧R` is unused).
- `⌘⇧M` (repeat) → free (note `⌘M` is `minimize`; `⌘⇧M` is unused).
- `⌘⇧A` (advert), `⌘,` (settings), `⌘\` (sidebar), `⌘K` (palette) → already
  bound to these exact actions; the spec documents them and `menu.ts` keeps
  binding them.
- `?`, `⌥↑/↓` → renderer-surface with `guardTyping`, so no typing interference.

## Testing

- **Unit (Vitest):** spec projections — `toAccelerator`, `matchesEvent`,
  `toCaps` for both platforms; the `1-9` digit token; the unread-nav and
  Nth-channel selectors against a mock store; the typing guard predicate.
- **Component:** overlay renders all four categories; opens on `?`; ignores `?`
  while focus is in a text field; closes on Esc / overlay / ✕.
- **Gates:** `npm run typecheck` and `npm run lint` (scoped to `src tests` per
  repo convention — repo-wide lint trips on build/dist artifacts).

## Files

**New**
- `src/shared/shortcuts.ts` (+ optional `shortcuts-format.ts`)
- `src/renderer/components/ui/kbd.tsx`
- `src/renderer/features/help-overlay/index.tsx` (+ any sub-files)
- Tests under `tests/`

**Modified**
- `src/shared/types.ts` — `MenuAction`: −`focusSection`, +`openPacketLog`,
  +`reconnect`, +`toggleRepeat`
- `src/main/menu.ts` — source accelerators from spec; remove focus-section; add
  packet log / reconnect / repeat items; add ⌘⇧L to theme
- `src/renderer/App.tsx` — replace keydown block with spec-driven loop
- `src/renderer/app/menuActions.ts` — handle the three new MenuActions
- `src/renderer/lib/store.ts` — `helpOpen` + open/close actions
- `src/renderer/shell/AppShell.tsx` — mount `ShortcutsHelpDialog`
- `src/renderer/features/command-palette/index.tsx` — use shared `Kbd`

## Out of scope

- No new threading/reply or message-info features.
- No OS-level `globalShortcut` registration.
- Standard OS edit roles (cut/copy/paste/undo/redo) are not listed in the
  overlay.
