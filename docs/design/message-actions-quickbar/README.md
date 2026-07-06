# Handoff: Message Actions — Quick Bar toolbar

## Overview
Replaces the single **reply** button on each message in the MeshCore message pane with a
**Discord‑style hover action toolbar** ("Quick Bar"). Hovering a message reveals a bar at the
message's top‑right corner offering emoji reactions, a labelled Reply, inline quick‑reply macro
chips, copy, message info, and an overflow (`⋯`) menu for the long tail. It is designed to grow:
future actions slot into the `⋯` menu without redesigning the inline row.

A key product decision: **MeshCore has no "reaction" message type and airtime is scarce, so
reactions are not stored.** Clicking an emoji instead composes a normal **reply prefixed with the
sender's @mention** (e.g. `@RHO 👍`) into the composer. Macros work the same way — they insert
saved text into the reply. One familiar gesture, zero new protocol.

## About the Design Files
The files in this bundle are **design references created in HTML/React (via Babel in the browser)** —
prototypes that show the intended look and behaviour. **They are not production code to copy
verbatim.** The task is to **recreate this design in the target codebase's existing environment**
(its component library, state layer, icon set, and message model), following that codebase's
established patterns. If no front‑end environment exists yet, pick the most appropriate framework
and implement it there.

The prototype is built on **CoreSense**, the project's shadcn/ui + Radix + Tailwind‑v4 design
system. Where your codebase already has equivalents (Button, Popover, Tooltip, Command/menu,
Toast), use those.

## Fidelity
**High‑fidelity.** Final colors, typography, spacing, sizes, states, and interactions are all
specified below and are considered the intended design. Recreate it pixel‑accurately using your
codebase's components. Copy (labels/text) is final unless noted.

---

## Screens / Views

### View: Channel message pane (context)
- **Purpose:** Read a channel/DM thread and act on individual messages.
- **Layout:** Vertical stack — channel header (top), scrolling message list (middle), composer
  (bottom). The prototype constrains the pane to a rounded card (max‑width ~980px) for
  presentation; in the real app it fills the message column.
- **Channel header:** flex row, `padding: 10px 16px`, `border-bottom: 1px solid cs-border`.
  `#` glyph in `cs-accent` (mono) · channel name **13px/600** `cs-text` · meta
  `· hashtag · open · key 2fa78a5a` in **mono 10px** `cs-text-dim` · right‑aligned `⌘K` hint.

### Component: Message row
- **Layout:** `display:flex; gap:12px; padding:8px 16px; position:relative;`
  (`position:relative` is the anchor for the toolbar). Row background on hover: `cs-bg-2`.
- **Avatar:** `34×34px`, `border-radius:6px`, `1px` border. Background/text are derived from a hue:
  `background: hsl(H 45% 22%)`, `text: hsl(H 70% 72%)`, `border: hsl(H 45% 30%)`. Emoji glyph
  rendered at `~52%` of box; initials at `~36%`, weight 600. (In production, use your avatar
  component / identicon.)
- **Name line:** name **13px/600** — others `cs-text`, **own messages `cs-accent`**. Followed by a
  delivery **state tag** in mono 10px: `ack` → `cs-online`, `relay` → `cs-warn`, `tx…` → `cs-warn`.
- **Bubble:** `display:inline-block; border-radius:8px; padding:6px 12px;` text **13px**,
  `line-height:1.625`, color `cs-text`, background `cs-bg-3`. Own messages add a **2px left border
  in `cs-accent`**; others use a 2px transparent left border (keeps alignment).
- **Meta line:** mono **10.5px** `cs-text-dim`, `tabular-nums`, dot‑separated:
  `time · age · {hops}h · {±snr}dB`. Hops and SNR are shown for received messages only.

---

## The Quick Bar (primary component)

### Anchor & reveal
- **Anchor:** absolutely positioned against the message row — `top:-14px; right:12px;` (overlaps the
  top‑right corner of the message).
- **Reveal:** hidden by default (`opacity:0`, `translateY(3px)`, `pointer-events:none`). On row
  hover it animates to `opacity:1, translateY(0)` over **120ms ease**. It also stays visible while
  one of its popovers is open ("pinned"), even if the pointer leaves the row.
- **Container ("pill"):** `display:flex; align-items:center; gap:4px; padding:4px 6px;`
  `border-radius:8px; border:1px solid cs-border-strong; background:cs-bg-3;`
  `box-shadow:0 10px 26px rgba(0,0,0,0.5);`.

### Contents — messages from OTHERS (left → right)
1. **Quick reactions:** 5 emoji buttons `[👍 ✅ 📡 🔋 😂]`, each a **ghost, 24×24px** (`icon-xs`)
   button, emoji at 16px, gap 2px. Tooltip "Reply with {emoji}". → composes a mention reply.
2. **More emoji (`＋`):** ghost 24×24px, plus icon 14px. Opens the **Emoji Picker** popover.
3. **Divider:** vertical rule, `height:24px`, `cs-border`, `margin:0 4px`.
4. **Reply:** **secondary** button, `height:28px`, `gap:6px`, `padding:0 10px`, text **12px**,
   reply icon 14px + label "Reply". → composes `@{mention} ` and focuses composer.
5. **Macro chips:** the first 2 saved macros as chips `[ACK] [Copy that]`, then **All macros (`⋯`)**
   (ghost 24×24, more icon 14px) opening the **Macro** popover.
   - **Chip:** `inline-flex; gap:4px; border-radius:6px; border:1px solid cs-border;
     background:cs-bg-2; padding:4px 8px;` text **11px/500** `cs-text-muted`; leading bolt icon 11px
     `cs-accent`. Hover: border `cs-accent/40`, text `cs-text`.
6. **Divider** (as above).
7. **Copy text:** ghost **32×32px** (`icon-sm`), copy icon 16px. Tooltip "Copy text". → clipboard + toast.
8. **More (`⋯`):** ghost 32×32px, more icon 16px. Opens the **Overflow** menu popover.

### Contents — YOUR OWN messages
Reply/react/macros are removed. The pill shows:
1. **Copy:** secondary button (28px, copy icon + "Copy"). → clipboard + toast.
2. **Info:** ghost 32×32px, info icon. Opens the **Message Info** popover.
3. **Delete:** ghost 32×32px, trash icon in `cs-danger`; hover background `cs-danger/10`. → toast.

> **Overflow philosophy:** the inline row holds the primary set; everything else lives under `⋯`.
> New actions should be added to the `⋯` menu (and macro chips dropped first on narrow widths) —
> not appended to the inline row.

---

## Popovers (surfaces)
All popovers use the design system's Popover: rendered `side="top"`, `align="end"`,
`sideOffset=8px`, `padding:0`, `border:1px solid cs-border-strong`, `background:cs-bg-2`,
`border-radius ~8px`, elevated shadow. Only one popover per row is open at a time.

### Emoji Picker — width 258px
- **Search input** (design‑system Command input), height 32px, placeholder "Search emoji…".
- Label **"FREQUENTLY USED"** — 10px uppercase, `letter-spacing` wide, `cs-text-dim`.
- **Grid:** 7 columns, gap 2px; each cell 32px tall, `border-radius:6px`, emoji 18px; hovered/active
  cell background `cs-accent-soft`. ~35 emoji, each searchable by keywords (e.g. `📡` → "signal
  antenna repeater").
- **Footer note** (border‑top `cs-border`, `padding:8px 12px`, 10.5px `cs-text-dim`):
  "Adds @mention + emoji to your reply — no separate reaction packet."
- Selecting an emoji → composes `@{mention} {emoji} ` and closes.

### Macro popover — width 244px
- Header **"REPLY MACROS"** (10px uppercase `cs-text-dim`) + an outline **"soon"** badge (macros are roadmap).
- Rows: full‑width buttons, `gap:10px; border-radius:6px; padding:6px 8px;` hover `cs-bg-3`.
  Leading bolt icon 14px `cs-accent`; **label 12px/500 `cs-text`**; **description mono 11px
  `cs-text-dim`, truncated**.
- Seed macros (`label` → inserted `text`): `ACK` → "ack ✓ heard you, thanks" · `Copy that` →
  "copy that" · `SNR?` → "what SNR are you seeing on your end?" · `Relaying` → "relaying now" ·
  `QSY 910.5` → "QSY 910.5 MHz" · `ETA` → "ETA ~10 min".
- Selecting a macro → composes `@{mention} {text} ` and closes.

### Overflow ("More") menu — width 216px
- Rows: `gap:10px; border-radius:6px; padding:6px 8px;` text 12.5px; hover `cs-bg-3`.
  Destructive rows use `cs-danger` (+ hover background `cs-danger/10`). "soon" rows are
  `opacity:0.45`, non‑interactive, with an outline "soon" badge.
- Items (others): **Copy public key** → clipboard + toast · *(divider)* · **Forward** (soon) ·
  **Pin message** (soon) · *(divider)* · **Dismiss locally** (destructive) → toast.

### Message Info popover — width 288px
- Header **"MESSAGE INFO"** (10px uppercase `cs-text-dim`).
- Message body preview box: `border:1px solid cs-border; background:cs-bg-3; border-radius:6px;
  padding:8px 10px;` 12px.
- Detail rows use the design system's **KeyValueRow** (label left, value right): **From**,
  **Public key** (mono), **Hops** (mono), **RSSI / SNR** (mono, received only), **State** (mono).
- **PATH** section: label + one row per hop, mono 11px, numbered `1..n`.

### Composer (receives reactions/replies)
- `border-top:1px solid cs-border; padding:12px 16px;`
- **Reply context chip** (shown while replying): pill `background:cs-accent-soft; color:cs-accent;`
  11px, "↩ Replying to **@{mention}**", with a `✕` clear control that also empties the input.
- **Input row:** `display:flex; gap:10px; border:1px solid cs-border; background:cs-bg-2;
  border-radius:6px; padding:8px 12px;` leading `›` mono `cs-accent`; input mono **12.5px**
  `cs-text` (placeholder `cs-text-dim`); trailing counter mono 10px `cs-text-dim`
  "{len}/200 · ETA 1.4s".

---

## Interactions & Behavior
- **Hover** a message → toolbar fades in (120ms). Pointer leaving hides it **unless** a popover from
  that row is open.
- **Quick emoji / picker emoji** (others) → set composer to `@{mention} {emoji} `, focus composer,
  show reply chip.
- **Reply** (others) → set composer to `@{mention} ` (no‑op if it already starts with that mention),
  focus.
- **Macro chip / macro row** → set composer to `@{mention} {macro.text} `, focus.
- **Copy text / Copy public key** → write to clipboard, `toast.success(...)`.
- **Dismiss locally** (destructive) → `toast("Message dismissed locally", { description: "Removed from this device only." })`.
- **Own message** → Copy / Info / Delete only.
- **Popovers** open on trigger click; one open at a time per row; open state "pins" the toolbar
  visible. Close on outside click / Escape (design‑system default).
- **Tooltips** on icon‑only buttons (design‑system Tooltip, ~150ms delay).

## State Management
- **Pane‑level state:** `value` (composer text), `replyingTo` (message being replied to, or null),
  `hoverId` (hovered message id), `pinId` (message id whose popover is open).
- **Toolbar‑level state:** `open` = which popover key is open (`'emoji' | 'macro' | 'more' | 'info' | null`);
  reports up so the row can stay visible while pinned.
- **Handlers (ctx):** `reply`, `react`, `macro`, `copyText`, `copyKey`, `del`.
- **Data:** the prototype uses static sample data. In production:
  - reactions/replies/macros → send a normal **outbound message** on the mesh (text = the composed
    string); there is no separate reaction API.
  - Copy → clipboard API. Message Info → read fields already on the message
    (`hops`, `rssi`, `snr`, `path`, `state`, sender `pk`). Delete → **local‑only** dismiss.

## Responsive behavior
The bar can get wide. Keep the primary set inline (reactions · Reply · ~2 macro chips · copy) and
route everything else through `⋯`. On narrow message columns, drop macro chips first, then collapse
to the compact set. Anchor stays top‑right of the row.

---

## Design Tokens

**Colors** (CoreSense `--cs-*`, shown as hex):
| Token | Hex | RGB | Use |
|---|---|---|---|
| `cs-bg` | `#0C0A06` | 12 10 6 | app / pane background |
| `cs-bg-2` | `#18130B` | 24 19 11 | header, composer, row hover, popover bg |
| `cs-bg-3` | `#221B10` | 34 27 16 | bubble, toolbar pill, hover rows |
| `cs-text` | `#F5F1E6` | 245 241 230 | primary text |
| `cs-text-muted` | `#C1B291` | 193 178 145 | secondary text, chip label |
| `cs-text-dim` | `#807560` | 128 117 96 | meta, labels, placeholders |
| `cs-border` | `#2A2419` | 42 36 25 | dividers, borders |
| `cs-border-strong` | `#3A3322` | 58 51 34 | toolbar/popover border |
| `cs-accent` | `#F59E0B` | 245 158 11 | brand amber — names(self), icons, accents |
| `cs-accent-soft` | `#92400E` | 146 64 14 | reply chip bg, emoji hover, selection |
| `cs-online` | `#84CC16` | 132 204 22 | `ack` state, status dot |
| `cs-warn` | `#F59E0B` | 245 158 11 | `relay` / `tx…` states |
| `cs-danger` | `#DC2626` | 220 38 38 | delete / destructive |

**Radius:** xs 2px · sm 4px · **md 6px** (chips, rows, inputs) · **lg 8px** (bubble, toolbar pill,
popover) · xl 12px (pane card).

**Spacing** (Tailwind scale, 4px base): common values used — 2, 4, 6, 8, 10, 12, 16px.

**Typography:** **Inter** (400/500/600/700). Monospace stack (`ui-monospace, "JetBrains Mono", "SF
Mono", Menlo`) for hex keys, node ids, and telemetry (hops, SNR, counters). Sizes used: 10, 10.5,
11, 11.5, 12, 12.5, 13, 14, 30px. Labels are typically 10px uppercase with wide letter‑spacing.

**Button sizes (design system):** `icon-xs` = 24×24 (svg 12px) · `icon-sm` = 32×32 (svg 16px) ·
`sm` = h32 px12 · Reply/Copy use `sm` overridden to **h28**. Variants used: `ghost`, `secondary`,
`destructive`.

## Assets
- **Icons:** inline **SVG**, 20×20 viewBox, `stroke: currentColor`, ~1.6 stroke — `reply, smiley,
  bolt (macros), copy, key, info, trash, more (⋯), forward, pin, plus, search, chevron, at, back`.
  No icon‑font/image dependency; swap for your icon library (e.g. lucide) in production.
- **Emoji:** system Unicode emoji (no asset files).
- **Avatars:** generated from initials/emoji on a hue‑derived background (no image assets).
- **Fonts:** Inter — bundled by the design system; the standalone HTML loads it from Google Fonts.
- **Design system:** CoreSense (shadcn/ui + Radix + Tailwind v4). Components used: **Button, Badge,
  Separator, Popover, Tooltip, Command, KeyValueRow, Toaster/toast**.

## Implementation notes / gotchas
- In this specific CoreSense build the `Button` is a **plain function component (no `forwardRef`)**,
  so it can't be a Radix `asChild` trigger. The prototype uses a native `<button>` with the design
  system's `buttonVariants({variant,size})` classes for any Tooltip/Popover trigger. Your codebase's
  Button is likely `forwardRef` and won't need this.
- Popover content is portaled to `document.body` (standard Radix) — keep that in mind for stacking
  contexts.

## Files (in this bundle)
- **`Message Actions - Quick Bar.html`** — runnable, self‑contained reference. Open in any browser
  to interact with the exact design (hover messages, open popovers, click emoji/macros).
- **Source (authoring) React/JSX — reference only; depend on the CoreSense bundle, not runnable standalone:**
  - `qb-app.jsx` — page shell that mounts the pane.
  - `qb-concepts.jsx` — the **Quick Bar** toolbar + message‑pane demo (the core of this handoff).
  - `ma-shared.jsx` — shared parts: message row, avatar, composer, emoji picker, macro panel,
    message‑info panel, overflow list, tooltip/popover button helpers.
  - `ma-icons.jsx` — the SVG icon set.
  - `ma-data.js` — sample thread, emoji set (+keywords), and seed macros.

> Context (not included, lives in the project root): `Message Actions.html` is the original study
> comparing three directions (Corner Rail / **Quick Bar** / Command Menu) — useful for rationale.
