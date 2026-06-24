# Radix Themes Slice — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preview an all-Radix component design (Radix Themes + Colors + Icons + Primitives) on a representative slice — the app shell (left nav + right rail) and Settings — behind a live, dropdown-driven Theme Playground, without disturbing the un-converted panels.

**Architecture:** A single root `<Theme>` (Approach A) wraps the whole app; converted files use Radix Themes components and layout primitives; the existing shadcn/Tailwind panels keep rendering unchanged. Light/dark stays driven by the existing theme pref (bridged to `<Theme appearance>`); accent/gray/panel-background are driven live by a small persisted zustand store edited from Settings → Appearance.

**Tech Stack:** React 18 + TypeScript, Vite, Electron, zustand, Tailwind v4 (retained for un-converted code), `@radix-ui/themes`, `@radix-ui/react-icons`, `radix-ui` primitives (already present), Vitest, Biome.

**Spec:** `docs/superpowers/specs/2026-06-23-radix-themes-slice-design.md`

## Global Constraints

- **Package manager:** pnpm. Run commands from the worktree root `/Users/andy/GitHub/andyshinn/coresense/.claude/worktrees/feat+radix-themes-slice`.
- **Sandbox:** `git commit`/`git add` and `pnpm install`/`pnpm add` in this worktree require the sandbox disabled (known friction). `pnpm typecheck`, `pnpm test`, `pnpm lint` run fine sandboxed.
- **Default Theme props:** `accentColor="amber"`, `grayColor="sand"`, `panelBackground="translucent"`, `radius="medium"`, `scaling="100%"`. `appearance` is bridged from the theme pref — never hardcoded.
- **Playground scope:** accent + gray + panel-background only. **No** radius/scaling controls. Light/dark stays on the existing theme pref.
- **Pure Radix layout** in every converted file: replace Tailwind layout utilities (`flex`, `grid`, `gap-*`, `p-*`, `space-*`, etc.) with Radix layout primitives (`Flex`, `Grid`, `Box`, `Section`, `Text`, `Heading`, `ScrollArea`, `Card`) and their token props. Tailwind remains available repo-wide for un-converted code.
- **Preserve behavior + hooks** exactly: all `data-*` attributes (`data-section`, `data-testid`, `data-active`, `data-channel-key`), ARIA roles/labels, drag-to-reorder, IntersectionObserver scroll-spy, pointer-capture resize, keyboard handling, async API calls, notifications.
- **Keep** the `cs-*` palette and `applyTheme()` for the un-converted panels. Do not delete shadcn `ui/` components.
- **Per-task verification recipe** (the "VERIFY" block referenced by every task):
  1. `pnpm typecheck` → expect: no errors.
  2. `pnpm test <affected files>` (or `pnpm test` if unsure) → expect: pass.
  3. `pnpm lint src tests` → expect: no new errors (repo-wide lint flags pre-existing build artifacts; scope to `src tests`).
  4. Commit with the trailer `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>` (sandbox disabled).
- **Affected existing tests** (only these touch the slice): `tests/component/connection-footer-update.test.tsx`, `tests/component/owner-card-popover.test.tsx`, `tests/component/unreads-nav-item.test.tsx`. Update their selectors when the underlying markup changes; preserve their behavior assertions. `tests/unit/renderer/shell/leftnav/ownerFormat.test.ts` is a pure-util test and must stay green untouched.

---

## Conversion Conventions (referenced by every conversion task — read once)

These canonical patterns keep the per-file tasks DRY. Where a task says "apply the canonical X pattern," use the code here.

### C1. Radix imports

```tsx
import { Theme, Flex, Grid, Box, Text, Heading, Card, ScrollArea, Button, IconButton, TextField, Select, Switch, Checkbox, Badge, Separator, Dialog, AlertDialog, Popover, HoverCard, DropdownMenu, SegmentedControl, DataList, Progress } from '@radix-ui/themes';
```

Import only what each file uses. Radix Themes is tree-shakeable; per-file named imports are fine.

### C2. Select (replaces Field `Select` and native `<select>`)

```tsx
// value/options/onChange identical to the old Field Select signature
<Select.Root value={value} onValueChange={(v) => onChange(v as T)} disabled={disabled} size="1">
  <Select.Trigger variant="surface" />
  <Select.Content>
    {options.map((opt) => (
      <Select.Item key={opt.value} value={opt.value}>{opt.label}</Select.Item>
    ))}
  </Select.Content>
</Select.Root>
```

### C3. Switch (replaces Field `Toggle` checkbox)

```tsx
<Switch checked={checked} onCheckedChange={onChange} disabled={disabled} size="1" />
```

### C4. TextField (replaces Field `NumberInput` / `TextInput`)

```tsx
// number
<TextField.Root type="number" size="1" value={String(value)} min={min} max={max} step={step}
  disabled={disabled} style={{ width: 96 }}
  onChange={(e) => { const n = Number(e.target.value); if (!Number.isNaN(n)) onChange(n); }} />
// text
<TextField.Root size="1" value={value} placeholder={placeholder} disabled={disabled}
  onChange={(e) => onChange(e.target.value)} />
```

### C5. DataList (replaces `KeyValueRow` / `KeyValueGroup`)

```tsx
<DataList.Root orientation="horizontal" size="1">
  <DataList.Item>
    <DataList.Label minWidth="0">{label}</DataList.Label>
    <DataList.Value>{value}</DataList.Value>
  </DataList.Item>
</DataList.Root>
```

For a mono value, wrap the value in `<Text size="1" style={{ fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums' }}>`.

### C6. Dialog / AlertDialog (replaces shadcn `Dialog`)

```tsx
<AlertDialog.Root open={open} onOpenChange={setOpen}>
  <AlertDialog.Content maxWidth="420px">
    <AlertDialog.Title>{title}</AlertDialog.Title>
    <AlertDialog.Description size="2">{description}</AlertDialog.Description>
    <Flex gap="3" mt="4" justify="end">
      <AlertDialog.Cancel><Button variant="soft" color="gray">Cancel</Button></AlertDialog.Cancel>
      <AlertDialog.Action><Button color="red" onClick={onConfirm}>{confirmLabel}</Button></AlertDialog.Action>
    </Flex>
  </AlertDialog.Content>
</AlertDialog.Root>
```

Use `Dialog.*` (non-alert) for non-destructive modals; `AlertDialog.*` for confirmations (block/remove/discard).

### C7. Popover (replaces shadcn `Popover`) and HoverCard (replaces shadcn `HoverCard`)

```tsx
<Popover.Root>
  <Popover.Trigger>{trigger}</Popover.Trigger>
  <Popover.Content size="1" side="right" align="start">{body}</Popover.Content>
</Popover.Root>

<HoverCard.Root openDelay={200} closeDelay={120}>
  <HoverCard.Trigger>{trigger}</HoverCard.Trigger>
  <HoverCard.Content side="right" align="start" maxWidth="320px">{body}</HoverCard.Content>
</HoverCard.Root>
```

### C8. Icon mapping (lucide → Radix Icons, else keep lucide)

Use `@radix-ui/react-icons` where a clean match exists; **keep the `lucide-react` import** for domain glyphs Radix doesn't cover. Apply this table consistently:

| lucide | Radix Icons | | lucide | Radix Icons |
|---|---|---|---|---|
| Search | `MagnifyingGlassIcon` | | Plus / Minus | `PlusIcon` / `MinusIcon` |
| X | `Cross2Icon` | | ChevronRight / ChevronLeft | `ChevronRightIcon` / `ChevronLeftIcon` |
| Copy | `CopyIcon` | | Check | `CheckIcon` |
| Star | `StarIcon` (filled: `StarFilledIcon`) | | MoreHorizontal | `DotsHorizontalIcon` |
| Cog / Settings | `GearIcon` | | Trash2 | `TrashIcon` |
| Sun | `SunIcon` | | SlidersHorizontal | `MixerHorizontalIcon` |
| Download / Upload | `DownloadIcon` / `UploadIcon` | | Share2 | `Share2Icon` |
| AlertTriangle | `ExclamationTriangleIcon` | | Zap | `LightningBoltIcon` |
| RotateCw / refresh | `ReloadIcon` | | MessageSquare | `ChatBubbleIcon` |
| PinIcon / PinOff | `DrawingPinFilledIcon` / `DrawingPinIcon` | | DoorOpen | `ExitIcon` |
| Megaphone | `SpeakerLoudIcon` | | ArrowUpCircle (update) | `UpdateIcon` |

**Keep lucide (no acceptable Radix match):** `Hash`, `Users`, `BellOff`, `Radio`, `Map`, `MapPin`, `Bluetooth`, `Inbox`, `Activity`, `ScrollText`, `TerminalSquare`, `ShieldCheck`, `ShieldOff`, `Ban`, `Wrench`, `FolderInput`, `PanelRightClose`, `Download`-adjacent domain glyphs not in the table. When unsure whether a Radix match reads correctly, keep lucide and note it.

Radix icons accept `width`/`height` props (default 15). Match the prior lucide sizes (e.g. `className="size-3.5"` → `width="14" height="14"`); apply color via a wrapping `<Text color=…>` or the icon's `color` via CSS `currentColor` (Radix icons inherit `currentColor`).

### C9. Pure-Radix layout mapping (Tailwind → Radix props)

| Tailwind | Radix |
|---|---|
| `flex`, `flex-col` | `<Flex direction="row\|column">` |
| `items-center`, `items-start`, `items-baseline` | `align="center\|start\|baseline"` |
| `justify-between`, `justify-end` | `justify="between\|end"` |
| `gap-2` (0.5rem) | `gap="2"` |
| `p-2`/`px-4`/`py-1` | `p="2"`/`px="4"`/`py="1"` |
| `flex-1` | `<Box flexGrow="1">` |
| `shrink-0` | `flexShrink="0"` |
| `overflow-y-auto` | `<ScrollArea>` or `<Box overflow="auto">` |
| `text-[11px] text-cs-text-muted` | `<Text size="1" color="gray">` |
| `font-semibold uppercase tracking-wider` | `<Text weight="medium" />` + `style={{ textTransform: 'uppercase', letterSpacing: '0.05em' }}` |

Radix space scale: `1`≈4px, `2`≈8px, `3`≈12px, `4`≈16px. Pick the nearest token; use `style={{…}}` for exact pixel values that have no token (this is acceptable and not a Tailwind utility).

---

## Phase 0 — Foundation: dependencies + root Theme + appearance bridge

### Task 0.1: Add Radix Themes + Icons and mount the root `<Theme>`

**Files:**
- Modify: `package.json` (deps)
- Create: `src/renderer/components/theme/RadixThemeProvider.tsx`
- Modify: `src/renderer/main.tsx` (wrap `<App/>`, import styles)

**Interfaces:**
- Produces: `RadixThemeProvider` — `(props: { children: ReactNode }) => JSX.Element`. Reads `themePref` + `systemDark` from `useStore`, computes `appearance`, renders `<Theme>` with the Global-Constraints default props. Accent/gray/panel are **hardcoded to the warm defaults in this task**; Task 1.2 swaps them to read the playground store.

- [ ] **Step 1: Install dependencies** (sandbox disabled)

```bash
pnpm add @radix-ui/themes @radix-ui/react-icons
```
Expected: both added to `package.json` dependencies; lockfile updated.

- [ ] **Step 2: Create `RadixThemeProvider.tsx`**

```tsx
import type { ReactNode } from 'react';
import { Theme } from '@radix-ui/themes';
import { useStore } from '../../lib/store';
import { resolveTheme } from '../../lib/theme';

export function RadixThemeProvider({ children }: { children: ReactNode }) {
  const themePref = useStore((s) => s.ui.themePref);
  const systemDark = useStore((s) => s.systemDark);
  const appearance = resolveTheme(themePref, systemDark); // 'dark' | 'light'
  return (
    <Theme
      appearance={appearance}
      accentColor="amber"
      grayColor="sand"
      panelBackground="translucent"
      radius="medium"
      scaling="100%"
    >
      {children}
    </Theme>
  );
}
```

- [ ] **Step 3: Wrap `<App/>` and import the stylesheet in `main.tsx`**

Add at the top of `src/renderer/main.tsx`: `import '@radix-ui/themes/styles.css';` (after `./index.css` so Tailwind utilities can still override where both target an element — adjust in Task 0.2 if cascade is wrong). Wrap the rendered `<App/>` with `<RadixThemeProvider>…</RadixThemeProvider>`.

- [ ] **Step 4: VERIFY** — run the recipe. Then `pnpm start`, confirm the app boots, light/dark toggle still works (Settings → Appearance → Theme), and no console errors. Commit: `feat(radix): mount root Theme provider + add @radix-ui/themes and icons`.

### Task 0.2: Confirm coexistence with shadcn panels (reset-bleed check)

**Files:** possibly Modify `src/renderer/index.css` or `main.tsx` (import order only).

- [ ] **Step 1:** With the app running, open un-converted panels (Map, Search, Logs) and the command palette. Compare against `main` (screenshots or side-by-side). Look for: changed base font, altered spacing, broken inputs, z-index/portal regressions.
- [ ] **Step 2:** If bleed is material, adjust CSS import order (try `@radix-ui/themes/styles.css` **before** `./index.css`) and re-check. If still material, record it in the spec's Risks section and note the scoped-`<Theme>` (Approach B) fallback for a follow-up — do not implement B now.
- [ ] **Step 3:** VERIFY (typecheck/lint only; no logic changed) and commit any CSS-order tweak: `chore(radix): order stylesheets / note coexistence findings`. If no change needed, skip the commit and record findings in the task notes.

---

## Phase 1 — Theme Playground (live accent/gray/panel switching)

### Task 1.1: Create the persisted playground store (TDD)

**Files:**
- Create: `src/renderer/lib/radix-theme-store.ts`
- Test: `tests/unit/renderer/lib/radix-theme-store.test.ts`

**Interfaces:**
- Produces:
  - `RadixAccent` = union of the 26 Radix accents; `RadixGray` = `'auto'|'gray'|'mauve'|'slate'|'sage'|'olive'|'sand'`; `RadixPanelBg` = `'translucent'|'solid'`.
  - `useRadixTheme` zustand store: state `{ accentColor: RadixAccent; grayColor: RadixGray; panelBackground: RadixPanelBg }` + actions `setAccentColor`, `setGrayColor`, `setPanelBackground`. Defaults: `amber` / `sand` / `translucent`. Reads initial state from `localStorage['coresense.radixThemePlayground']`; every action persists back.
  - `ACCENT_OPTIONS: readonly RadixAccent[]`, `GRAY_OPTIONS: readonly RadixGray[]` for the dropdowns.

- [ ] **Step 1: Write failing test** `tests/unit/renderer/lib/radix-theme-store.test.ts`

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { useRadixTheme } from '../../../../src/renderer/lib/radix-theme-store';

describe('radix-theme-store', () => {
  beforeEach(() => { localStorage.clear(); useRadixTheme.setState({ accentColor: 'amber', grayColor: 'sand', panelBackground: 'translucent' }); });

  it('defaults to the warm preset', () => {
    const s = useRadixTheme.getState();
    expect(s.accentColor).toBe('amber');
    expect(s.grayColor).toBe('sand');
    expect(s.panelBackground).toBe('translucent');
  });

  it('updates and persists accent', () => {
    useRadixTheme.getState().setAccentColor('tomato');
    expect(useRadixTheme.getState().accentColor).toBe('tomato');
    expect(JSON.parse(localStorage.getItem('coresense.radixThemePlayground')!).accentColor).toBe('tomato');
  });

  it('updates panel background', () => {
    useRadixTheme.getState().setPanelBackground('solid');
    expect(useRadixTheme.getState().panelBackground).toBe('solid');
  });
});
```

- [ ] **Step 2: Run it, expect FAIL** — `pnpm test tests/unit/renderer/lib/radix-theme-store.test.ts` → FAIL (module not found).

- [ ] **Step 3: Implement `src/renderer/lib/radix-theme-store.ts`**

```ts
import { create } from 'zustand';

export type RadixAccent =
  | 'gray' | 'gold' | 'bronze' | 'brown' | 'yellow' | 'amber' | 'orange' | 'tomato'
  | 'red' | 'ruby' | 'crimson' | 'pink' | 'plum' | 'purple' | 'violet' | 'iris'
  | 'indigo' | 'blue' | 'cyan' | 'teal' | 'jade' | 'green' | 'grass' | 'lime' | 'mint' | 'sky';
export type RadixGray = 'auto' | 'gray' | 'mauve' | 'slate' | 'sage' | 'olive' | 'sand';
export type RadixPanelBg = 'translucent' | 'solid';

export const ACCENT_OPTIONS: readonly RadixAccent[] = [
  'gray','gold','bronze','brown','yellow','amber','orange','tomato','red','ruby','crimson','pink',
  'plum','purple','violet','iris','indigo','blue','cyan','teal','jade','green','grass','lime','mint','sky',
];
export const GRAY_OPTIONS: readonly RadixGray[] = ['auto','gray','mauve','slate','sage','olive','sand'];

const KEY = 'coresense.radixThemePlayground';
interface PlaygroundState { accentColor: RadixAccent; grayColor: RadixGray; panelBackground: RadixPanelBg; }
const DEFAULTS: PlaygroundState = { accentColor: 'amber', grayColor: 'sand', panelBackground: 'translucent' };

function load(): PlaygroundState {
  try { const raw = localStorage.getItem(KEY); return raw ? { ...DEFAULTS, ...JSON.parse(raw) } : DEFAULTS; }
  catch { return DEFAULTS; }
}
function persist(s: PlaygroundState) { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* ignore */ } }

interface RadixThemeStore extends PlaygroundState {
  setAccentColor: (c: RadixAccent) => void;
  setGrayColor: (c: RadixGray) => void;
  setPanelBackground: (b: RadixPanelBg) => void;
}

export const useRadixTheme = create<RadixThemeStore>((set, get) => ({
  ...load(),
  setAccentColor: (accentColor) => { set({ accentColor }); persist({ ...get(), accentColor }); },
  setGrayColor: (grayColor) => { set({ grayColor }); persist({ ...get(), grayColor }); },
  setPanelBackground: (panelBackground) => { set({ panelBackground }); persist({ ...get(), panelBackground }); },
}));
```

- [ ] **Step 4: Run test, expect PASS.** **Step 5: Commit** `feat(radix): add persisted Theme Playground store`.

### Task 1.2: Wire the provider to the playground store

**Files:** Modify `src/renderer/components/theme/RadixThemeProvider.tsx`.

- [ ] **Step 1:** Replace the hardcoded `accentColor`/`grayColor`/`panelBackground` with values from `useRadixTheme`:

```tsx
const { accentColor, grayColor, panelBackground } = useRadixTheme();
// …
<Theme appearance={appearance} accentColor={accentColor} grayColor={grayColor} panelBackground={panelBackground} radius="medium" scaling="100%">
```

- [ ] **Step 2: VERIFY**, then commit `feat(radix): drive Theme from playground store`.

### Task 1.3: Add the Theme Playground UI in Settings → Appearance

**Files:** Modify `src/renderer/panels/settings/app/Appearance.tsx`.

**Interfaces:** Consumes `useRadixTheme`, `ACCENT_OPTIONS`, `GRAY_OPTIONS` from Task 1.1.

- [ ] **Step 1:** Add a new block at the top of the Appearance section body — a "Radix Theme (preview)" group with three Radix `Select`s (Accent, Gray) and a `SegmentedControl` (Panel background: translucent/solid), each bound to the store. Use Radix layout (this block is born pure-Radix even though the rest of Appearance converts in Task 3.6):

```tsx
import { Flex, Text, Select, SegmentedControl } from '@radix-ui/themes';
import { useRadixTheme, ACCENT_OPTIONS, GRAY_OPTIONS } from '../../../lib/radix-theme-store';
// inside the section, above the existing theme Rows:
const rt = useRadixTheme();
<Flex direction="column" gap="2" mb="3">
  <Text size="1" weight="medium" color="gray">Radix Theme (preview)</Text>
  <Flex align="center" justify="between" gap="3">
    <Text size="1">Accent</Text>
    <Select.Root value={rt.accentColor} onValueChange={(v) => rt.setAccentColor(v as typeof rt.accentColor)} size="1">
      <Select.Trigger />
      <Select.Content>{ACCENT_OPTIONS.map((c) => <Select.Item key={c} value={c}>{c}</Select.Item>)}</Select.Content>
    </Select.Root>
  </Flex>
  <Flex align="center" justify="between" gap="3">
    <Text size="1">Gray</Text>
    <Select.Root value={rt.grayColor} onValueChange={(v) => rt.setGrayColor(v as typeof rt.grayColor)} size="1">
      <Select.Trigger />
      <Select.Content>{GRAY_OPTIONS.map((c) => <Select.Item key={c} value={c}>{c}</Select.Item>)}</Select.Content>
    </Select.Root>
  </Flex>
  <Flex align="center" justify="between" gap="3">
    <Text size="1">Panel background</Text>
    <SegmentedControl.Root value={rt.panelBackground} onValueChange={(v) => rt.setPanelBackground(v as typeof rt.panelBackground)} size="1">
      <SegmentedControl.Item value="translucent">Translucent</SegmentedControl.Item>
      <SegmentedControl.Item value="solid">Solid</SegmentedControl.Item>
    </SegmentedControl.Root>
  </Flex>
</Flex>
```

- [ ] **Step 2: VERIFY**, then `pnpm start` and confirm changing Accent → `tomato` and Panel → `solid` updates the whole app live and survives reload. Commit `feat(radix): Theme Playground controls in Settings → Appearance`.

> **Phase 1 deliverable:** live, persisted accent/gray/panel switching — the core "see what it looks like" capability — even before the bulk conversions.

---

## Phase 2 — Settings shared control layer (`Field.tsx`)

### Task 2.1: Convert `components/settings/Field.tsx` to Radix Themes

**Files:** Modify `src/renderer/components/settings/Field.tsx`. **Test:** none directly; consumers are typechecked.

Convert each export, preserving its exact prop signature (so no consumer changes in this task):
- [ ] **Step 1:** `Toggle` → canonical **C3** (Switch). Keep `(checked, onChange, disabled)` signature.
- [ ] **Step 2:** `Select` → canonical **C2**. Keep the generic `<T extends string>` signature and `options` shape.
- [ ] **Step 3:** `NumberInput` + `TextInput` → canonical **C4** (TextField). Preserve `min/max/step/suffix/width/placeholder`; render `suffix` as a trailing `<Text size="1" color="gray">`.
- [ ] **Step 4:** `Row` → canonical **C9** layout: `<Flex align="start" gap="3" px="2" py="1">` with the label/description/warning column as `<Box flexGrow="1">` and the control as `<Box flexShrink="0">`. Preserve the `changed` accent dot (`<Box>` with `style={{ background: 'var(--accent-9)' }}`) and the left-border accent via `style` (Radix has no border-left token — use `style={{ borderLeft: '2px solid var(--accent-9)' }}` when `changed`, transparent otherwise).
- [ ] **Step 5:** `Section` → `<Box>` with a `<Heading size="1">`-style label (`<Text size="1" weight="medium" color="gray" />` + uppercase style) header and a `<Flex direction="column" gap="1">` body; keep the `border-b` as `<Separator size="4" />` or `style` bottom border.
- [ ] **Step 6:** `PanelShell` → `<Flex direction="column" height="100%">` with a header `<Flex>` (title `<Heading size="2">`, description `<Text size="1" color="gray">`, actions on the right) and a `<ScrollArea>` body.
- [ ] **Step 7: VERIFY.** Because Settings has no component tests, verification is typecheck + `pnpm start` → open Settings, exercise a Toggle, a Select, a NumberInput; confirm behavior parity. Commit `refactor(radix): convert settings Field primitives to Radix Themes`.

> **Phase 2 deliverable:** every Settings section now renders Radix-styled controls.

---

## Phase 3 — Settings chrome + showcase sections (pure Radix layout)

Each task below: convert the file's layout per **C9**, swap icons per **C8**, keep all `data-*`/ARIA/observer logic, then VERIFY + commit. Showcase sections (3.6–3.9) must be **fully** pure-Radix; chrome (3.1–3.5) likewise.

### Task 3.1: `components/settings/SettingsSection.tsx`
**Files:** Modify the file.
- [ ] Convert the section wrapper to `<Box>` (keep `data-section={id}`, `scroll-mt`). Header → `<Flex align="start" gap="3">` with the icon (mapped per C8) + `<Heading size="2">`. The "Unsaved" pill → `<Badge color="amber" variant="soft">Unsaved</Badge>`. The Save button → `<Button size="1" disabled={!dirty || !canSave || saving}>{saving ? 'Saving…' : 'Save'}</Button>`. Footnote → `<Text size="1" color="gray">`.
- [ ] VERIFY + commit `refactor(radix): SettingsSection wrapper to Radix`.

### Task 3.2: `panels/settings/PillTabs.tsx`
- [ ] Replace the custom pill buttons with `SegmentedControl.Root`/`Item` (canonical SegmentedControl). Preserve per-tab dirty indicator: render a small `<Box>` dot (`style={{ background: 'var(--amber-9)' }}`) next to the label when that tab is dirty. Keep the same `value`/`onValueChange` wiring to the active tab. VERIFY + commit `refactor(radix): PillTabs → SegmentedControl`.

### Task 3.3: `panels/settings/StatusPill.tsx`
- [ ] Replace with `<Badge variant="soft" color={connected ? 'green' : 'gray'}>{label}</Badge>` plus the leading dot via the Badge content. VERIFY + commit `refactor(radix): StatusPill → Badge`.

### Task 3.4: `panels/settings/UnsavedChangesDialog.tsx`
- [ ] Convert the shadcn Dialog to canonical **C6** `AlertDialog`. Three actions: "Save all" (`<AlertDialog.Action>`), "Discard" (`color="red"` action), "Cancel" (`<AlertDialog.Cancel>`). Preserve the dirty-section list and the disabled-during-save state. VERIFY + commit `refactor(radix): UnsavedChangesDialog → AlertDialog`.

### Task 3.5: `panels/settings/SettingsPanel.tsx`
- [ ] Convert the panel chrome layout to Radix (`Flex` column, header `Flex`, `ScrollArea` body). **Preserve exactly:** the `IntersectionObserver` scroll-spy (`rootMargin: '0px 0px -70% 0px'`), `data-section` anchors, smooth-scroll jump-rail, per-tab dirty aggregation. Header composes the converted `StatusPill` + `PillTabs`. VERIFY + commit `refactor(radix): SettingsPanel chrome to Radix layout`.

### Task 3.6: `panels/settings/app/Appearance.tsx`
- [ ] Convert the existing theme `Row`/`Select` controls to pure Radix layout (the Field `Row`/`Select` are already Radix from Phase 2; here convert any remaining Tailwind wrappers in the file itself). Keep the Task 1.3 Playground block. Keep `useSettingsSection` draft/dirty/save wiring and the `changed` flags. VERIFY + commit `refactor(radix): Appearance section pure-Radix layout`.

### Task 3.7: `panels/settings/app/Behavior.tsx`
- [ ] Convert layout to pure Radix; controls already Radix via Field. Preserve `NumberInput` min/max/step + disabled-when-toggle-off logic and nested-object updates (`leftNavCollapseLists`, `unreadsPreview`, `commandPalette`, `search`). Icon `SlidersHorizontal` → `MixerHorizontalIcon`. VERIFY + commit `refactor(radix): Behavior section pure-Radix layout`.

### Task 3.8: `panels/settings/radio/Telemetry.tsx`
- [ ] Convert layout to pure Radix. Preserve the string↔number Select conversion (`{ value: '0'|'1'|'2' }`, `Number()` on save) and `api.putTelemetryPolicy()`. Icon `SlidersHorizontal` → `MixerHorizontalIcon`. VERIFY + commit `refactor(radix): Telemetry section pure-Radix layout`.

### Task 3.9: `panels/settings/ExtraSections.tsx`
- [ ] Convert the three sections' layout to pure Radix; action buttons → `<Button>`. Icons `AlertTriangle`→`ExclamationTriangleIcon`, `FolderInput`→keep lucide, `Wrench`→keep lucide. Keep all disabled states. VERIFY + commit `refactor(radix): ExtraSections pure-Radix layout`.

> **Phase 3 deliverable:** the entire Settings panel is all-Radix. Strong mid-point preview.

---

## Phase 4 — Right rail: shared layer + chrome + dialogs

### Task 4.1: `components/ui/KeyValueRow.tsx` → DataList
**Files:** Modify the file (keep the export names `KeyValueRow`, `KeyValueGroup`).
- [ ] Convert `KeyValueRow` to canonical **C5** (one `DataList.Item` with `Label`/`Value`; honor `mono` and `title`). Convert `KeyValueGroup` to `<Box>` + `<Text size="1" color="gray">` title + a `<DataList.Root>` wrapping children. **Note:** since `KeyValueRow` now renders a `DataList.Item`, it must sit inside a `DataList.Root` — make `KeyValueGroup` provide the `Root`, and for the few standalone `KeyValueRow` usages wrap them in a `DataList.Root` at the call site (ChannelInfo, MessageInfo, VersionSection — handled in Task 4.5). VERIFY (typecheck + `pnpm start` → open a contact/channel rail) + commit `refactor(radix): KeyValueRow/Group → Radix DataList`.

### Task 4.2: `shell/rightrail/index.tsx` + `ResizeHandle.tsx` + `atoms.tsx`
- [ ] Convert the collapsible rail panel chrome to Radix layout. **Keep** the `Collapsible` primitive, the `ResizeHandle` pointer-capture/Esc logic (only restyle its visual handle), the IntersectionObserver scroll-spy and smooth-scroll, the rail jump list, and `data-section` anchors. Icon `PanelRightClose` → keep lucide (or `DoubleArrowRightIcon`). VERIFY + commit `refactor(radix): right-rail chrome to Radix layout`.

### Task 4.3: `shell/rightrail/sections/ContactDetail.tsx`
- [ ] Convert the Block/Remove modals to canonical **C6** (`AlertDialog`). Convert layout to pure Radix; action buttons → `<Button>`/`<IconButton>` with `color` for danger/accent. Icons per C8 (`MessageSquare`→`ChatBubbleIcon`, `Share2`→`Share2Icon`, `Star`→`StarIcon`/`StarFilledIcon`, `Plus`/`Minus`; keep `Ban`, `Radio`, `MapPin`, `ShieldCheck`, `TerminalSquare`). Keep GPS-validity/distance logic, copy-to-clipboard, and the embedded path editor. VERIFY + commit `refactor(radix): ContactDetail rail to Radix`.

### Task 4.4: `shell/rightrail/sections/ContactManagerRail.tsx`
- [ ] Convert the Clear/Block dialogs to canonical **C6**; convert the three layout modes (bulk / focused / list-wide) to pure Radix; `DiscoverySettings` uses DataList (via 4.1). Icons per C8 (`Download`/`Upload`/`Trash2`/`Plus`/`Minus`/`Star`/`ChevronLeft`/`Settings`; keep `Ban`). Keep bulk async ops + prune thresholds. VERIFY + commit `refactor(radix): ContactManagerRail to Radix`.

### Task 4.5: Remaining rail sections (small files, one commit)
**Files:** `ChannelInfo.tsx`, `MessageInfo.tsx`, `VersionSection.tsx`, `MentionedContact.tsx`, `HeardVia.tsx`, `NeighboursRail.tsx`, `ContactCard.tsx`, `LogsFilters.tsx`, plus `sectionsFor.tsx`/`helpers.ts` layout only.
- [ ] Wrap standalone `KeyValueRow` usages in `<DataList.Root>` (ChannelInfo, MessageInfo, VersionSection). Convert each file's layout to pure Radix. `LogsFilters`: Field `Select` already Radix; convert its custom checkboxes to Radix `Checkbox` and inputs to `TextField`; icons `Check`/`Copy` per C8. VERIFY + commit `refactor(radix): remaining right-rail sections to Radix`.

> **Phase 4 deliverable:** the right rail is all-Radix.

---

## Phase 5 — Left nav (the keystone: replace `ui/sidebar`)

Radix Themes has no sidebar primitive, so Task 5.1 builds a small local nav-shell that mirrors the `ui/sidebar` API surface the leftnav consumes, so downstream files swap imports rather than rewrite structure.

### Task 5.1: Build the Radix nav-shell components
**Files:** Create `src/renderer/shell/leftnav/nav/` with `NavRoot.tsx`, `NavGroup.tsx`, `NavItem.tsx`, `NavButton.tsx`, `NavSub.tsx`, `index.ts`. **Test:** none (covered by downstream component tests + visual).

**Interfaces — Produces** (mirror the shadcn names the leftnav uses, so consumers map 1:1):
- `NavRoot` (`collapsible?: 'icon'`) ↔ `Sidebar` — `<Flex direction="column">` shell honoring a `data-collapsible="icon"` attribute + a context exposing `state: 'expanded'|'collapsed'` and `setOpen`.
- `useNav()` ↔ `useSidebar` — returns `{ state, setOpen }`.
- `NavGroup` / `NavGroupLabel` ↔ `SidebarGroup`/`SidebarGroupLabel`.
- `NavContent` (scroll area) ↔ `SidebarContent`; `NavHeader`/`NavFooter` ↔ `SidebarHeader`/`SidebarFooter`; `NavRail` ↔ `SidebarRail`.
- `NavMenu`/`NavItem` ↔ `SidebarMenu`/`SidebarMenuItem`.
- `NavButton` ↔ `SidebarMenuButton` — props `{ isActive?, onClick?, onContextMenu?, tooltip?, disabled?, asChild?, className?, children }`; renders a ghost `<Button variant="ghost">` (or `asChild`), sets `data-active`, applies tooltip via Radix `Tooltip`.
- `NavAction` ↔ `SidebarMenuAction` (`asChild` trailing slot).
- `NavSub`/`NavSubItem`/`NavSubButton` ↔ `SidebarMenuSub`/`SidebarMenuSubItem`/`SidebarMenuSubButton`.

- [ ] **Step 1:** Implement the components above with Radix `Flex`/`Box`/`ScrollArea`/`Button`/`Tooltip`, replicating the icon-collapsed behavior with a `data-collapsible="icon"` attribute + CSS (a small co-located `nav.css` or `style` blocks) so existing `group-data-[collapsible=icon]` semantics are reproduced. Width from `--sidebar-width` (already defined in `index.css`).
- [ ] **Step 2:** VERIFY (typecheck) + commit `feat(radix): local Radix nav-shell to replace ui/sidebar`.

### Task 5.2: `leftnav/index.tsx` → nav-shell
- [ ] Swap `ui/sidebar` imports for `nav/`; convert the add-channel `Popover` to canonical **C7**; icons `Hash`(keep)/`Plus`→`PlusIcon`/`Search`→`MagnifyingGlassIcon`/`Users`(keep)/`X`→`Cross2Icon`. Keep search UX, drag-reorder wiring, unread aggregation, collapse persistence, and the two portal context menus. VERIFY + commit `refactor(radix): leftnav index on Radix nav-shell`.

### Task 5.3: `ParentBranch.tsx` + `KindBranch.tsx`
- [ ] Swap to `nav/` (`NavButton`, `useNav`); keep the `Collapsible` primitive + chevron rotation via `data-state`. Icon `ChevronRight`→`ChevronRightIcon`. Preserve icon-collapse smart-expand (`useNav().setOpen`). VERIFY + commit `refactor(radix): branch components on Radix nav-shell`.

### Task 5.4: `ChannelSubList.tsx` + `ContactSubItem.tsx` + `atoms.tsx`
- [ ] Swap to `NavSub*`; **preserve drag-to-reorder** handlers and drop-target border, presence dimming, unread chips (`UnreadChip`), and `Star`(→`StarFilledIcon`)/`BellOff`(keep) indicators. Keep `data-testid`/`data-channel-key`. VERIFY + commit `refactor(radix): channel/contact sub-lists on Radix nav-shell`.

### Task 5.5: `OwnerCard.tsx` + `OwnerCardPopover.tsx`
**Test:** `tests/component/owner-card-popover.test.tsx` (update selectors).
- [ ] Convert `OwnerCard` `HoverCard` to canonical **C7**; convert `OwnerCardPopover` layout to Radix (keep the SVG rings as-is — they're raw SVG, not Tailwind). Icons `Radio`(keep)/`Copy`→`CopyIcon`/`MapPin`(keep). Update the test's queries to match Radix markup; keep its behavior assertions. VERIFY (incl. that test) + commit `refactor(radix): OwnerCard + popover to Radix`.

### Task 5.6: `ConnectionFooter.tsx` + `UnreadsNavItem.tsx`
**Tests:** `tests/component/connection-footer-update.test.tsx`, `tests/component/unreads-nav-item.test.tsx` (update selectors).
- [ ] `ConnectionFooter`: `Popover`→C7, `Progress`→Radix `<Progress value={pct} />` (replace the `*:data-[slot=progress-indicator]` Tailwind hack with Radix `color`), icons `ArrowUpCircle`→`UpdateIcon`/`Bluetooth`(keep)/`RotateCw`→`ReloadIcon`. Keep transport-state mapping, just-finished fade timer, reconnect conditions. `UnreadsNavItem`: `NavButton`, icon `Inbox`(keep), keep pulse dot + chip tone. Update both tests' selectors. VERIFY (incl. those tests) + commit `refactor(radix): ConnectionFooter + UnreadsNavItem to Radix`.

### Task 5.7: Context menus (`ContactContextMenu.tsx`, `ChannelContextMenu.tsx`, `contextMenu.tsx`)
- [ ] These are custom x/y-positioned portal menus. **Decision (preserve behavior):** keep the custom portal `ContextMenu` component and its positioning, but restyle its surface with Radix tokens (`Card`-like surface via `style={{ background: 'var(--color-panel-solid)', border: '1px solid var(--gray-a5)' }}`) and swap entry icons per C8 (`Copy`→`CopyIcon`, `Trash2`→`TrashIcon`, `PinIcon`/`PinOff`→`DrawingPin*Icon`, `Plus`/`Minus`; keep `BellOff`, `Megaphone`→`SpeakerLoudIcon`). Do **not** migrate to Radix `DropdownMenu` (would lose the x/y virtual-trigger model) — note this as a deliberate slice boundary. VERIFY + commit `refactor(radix): restyle context menus with Radix tokens`.

> **Phase 5 deliverable:** the left nav renders all-Radix; the shell slice is complete.

---

## Phase 6 — Final verification & wrap-up

### Task 6.1: Full-suite verification + visual sweep
- [ ] Run `pnpm typecheck` (no errors), `pnpm test` (all pass — expect the same 280+ count, the 3 updated component tests green, plus the new store test), `pnpm lint src tests` (no new errors).
- [ ] `pnpm start` — sweep: left nav (channels/contacts/tools, drag-reorder, context menus, owner hover, footer/reconnect, unreads), right rail (contact detail, manager, dialogs, metadata), Settings (all tabs, save/dirty, unsaved dialog), Theme Playground (cycle a few accents incl. `tomato`, both grays, translucent/solid, light/dark). Confirm un-converted panels (Map/Search/Logs) still look correct.
- [ ] Update the spec's Risks section with the observed reset-bleed result and any retained-lucide icon list.
- [ ] Commit `chore(radix): final verification + notes`.

### Task 6.2: Branch finishing
- [ ] Invoke `superpowers:finishing-a-development-branch` to choose merge/PR/keep. (The work lives on `worktree-feat+radix-themes-slice`.)

---

## Self-Review (completed by plan author)

**Spec coverage:** deps + root Theme (0.1) ✓; coexistence check (0.2, Risk #1) ✓; Theme Playground store/provider/UI with amber+sand default and tomato+solid reachable (1.1–1.3) ✓; appearance bridge (0.1/1.2) ✓; Field shared layer (2.1) ✓; settings chrome + showcase pure-Radix (3.1–3.9) ✓; KeyValueRow→DataList shared rail layer (4.1) ✓; rail chrome + dialogs + sections (4.2–4.5) ✓; left-nav sidebar rebuild + branches + sublists + owner + footer + context menus (5.1–5.7) ✓; icons per C8 with documented lucide fallbacks ✓; pure-Radix layout per C9 ✓; verification + known-seam notes (6.1) ✓. Radix Slider intentionally absent (spec correction) ✓.

**Placeholder scan:** no TBD/TODO; every conversion task names exact files, the canonical pattern (C1–C9), the behaviors to preserve, and the verify recipe. Bulk per-file tasks reference canonical patterns rather than repeating code (DRY, per skill guidance) — the patterns themselves are complete.

**Type consistency:** `useRadixTheme` state/actions and `RadixAccent`/`RadixGray`/`RadixPanelBg` are defined in 1.1 and consumed identically in 1.2/1.3; the nav-shell interface names in 5.1 are used verbatim in 5.2–5.6; Field export signatures are explicitly preserved in 2.1 so consumers are unaffected.
