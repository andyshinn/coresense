# Contact Management — Phase 2 (Main-Pane Manager UI) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`).
>
> **Verification model:** `main` has no test runner. Per project decision, every task verifies with **`pnpm typecheck && pnpm lint`** (gate the commit on the real exit codes — do NOT pipe typecheck through `| tail`, it masks failures) and commits. Device verification at the phase boundary. Do NOT add a test runner. **pnpm only.**

**Goal:** Build the main-pane Contact Manager — a dense, filterable table of the discovered-contacts pool with status pills, multi-select, a capacity meter, and a contextual right-rail of bulk + list actions — wired to the Phase 1 backend.

**Architecture:** A new `ContactManager` panel replaces the `tool:contacts` placeholder in `MainPane`. Because the panel and the `RightRail` are sibling components, the Manager's view state (filters, sort, multi-select, focused row) lives in a new **Zustand store slice** so both read/write it. A pure derivation module turns `discovered` + filter state into the filtered/sorted rows + counts. The rail gains a `tool:contacts` branch that shows **Bulk actions** when rows are selected and **List actions** otherwise.

**Tech Stack:** React + Vite, Tailwind v4 (Field Console `--cs-*` tokens), shadcn/ui primitives (`Button`, `Input`, `Checkbox`, `Select`, `Popover`, `Progress`, `KeyValueRow`), lucide icons, the repo's `notify` (sonner) + `ContextMenu` + `BlockSenderDialog`. `client: ApiClient | null` is threaded as a prop.

**Design source:** `docs/superpowers/specs/2026-05-29-contact-management-design.md` (§ main-pane Manager) and the design bundle `cm-panel.jsx`/`cm-icons.jsx`. Match the compact-table-with-keys default.

**Key facts (from codebase reconnaissance):**
- Panels mount in `src/renderer/shell/MainPane.tsx` via a `lazy(() => import(...))` + an `activeKey === 'tool:contacts'` branch; panels take `{ client }`.
- Right rail content comes from `sectionsFor(activeKey, data, { clearMentionedContact, client })` in `src/renderer/shell/rightrail/sectionsFor.tsx`, rendered as `Collapsible` sections; titles from `railTitle()` in `rightrail/helpers.ts`. No `tool:contacts` branch exists yet.
- Store: `discovered: DiscoveredContact[]`, `contacts: Contact[]` (the on-radio set → its `.length` is the on-radio count), `blockRules`, `deviceInfo.maxContacts`. Subscribe via `useStore((s) => …)`.
- No `dropdown-menu.tsx`/`table.tsx` primitives. Use `Select`/`Popover` + hand-rolled `<table>` (template: `src/renderer/panels/settings/blocked/BlockedSection.tsx`).
- Templates to mirror: `src/renderer/panels/Unreads.tsx` (header + filter tabs + scroll body), `BlockedSection.tsx` (table + row actions).
- api (renderer): `api.addToRadio(c,key)`, `api.removeFromRadio(c,key)`, `api.setFavourite(c,key,bool)`, `api.clearDiscovered(c)`, `api.deleteContact(c,key)`, `api.addBlockRules(c,rules)`. Toasts via `notify.{success,error,info}`.
- Tokens: `cs-bg`/`cs-bg-2`/`cs-bg-3`, `cs-text`/`cs-text-muted`/`cs-text-dim`, `cs-border`/`cs-border-strong`, `cs-accent`/`cs-accent-soft`, `cs-online`, `cs-warn`, `cs-danger`. Opacity modifiers (`bg-cs-accent/40`) work. Fonts: `font-mono` for keys/meta.

---

## File Structure

**Create:**
- `src/renderer/lib/contactManagerView.ts` — pure derivation: filter/sort `DiscoveredContact[]` + compute counts. No React.
- `src/renderer/panels/contacts/ContactManager.tsx` — the panel (header + capacity + toolbar + table/list + empty state).
- `src/renderer/panels/contacts/Toolbar.tsx` — search + state segments + type/heard/fav/sort/view controls.
- `src/renderer/panels/contacts/ContactRows.tsx` — `TableView` + `ListRow` + shared `StatusPill`, `HopChip`, `RowActions`, `TypeGlyph`.
- `src/renderer/panels/contacts/CapacityMeter.tsx` — on-radio/max meter.
- `src/renderer/shell/rightrail/sections/ContactManagerRail.tsx` — `BulkActions` + `ListActions` rail section components.

**Modify:**
- `src/renderer/lib/store.ts` — add a `contactManager` view-state slice (filters, sort, view, selected[], focusKey) + actions.
- `src/renderer/shell/MainPane.tsx` — lazy-import + mount `ContactManager` at `tool:contacts`.
- `src/renderer/shell/rightrail/sectionsFor.tsx` — add the `tool:contacts` branch.
- `src/renderer/shell/rightrail/helpers.ts` — `railTitle` case for `tool:contacts` → `"Contacts"`.

---

## Shared shapes (normative — reuse exact names)

Filter/sort/view state (store slice `contactManager`):
```ts
export type CmStateTab = 'all' | 'on-radio' | 'discovered' | 'blocked';
export type CmHeard = 'any' | 'hour' | 'day' | 'week';
export type CmSortField = 'lastHeard' | 'firstHeard' | 'name' | 'type' | 'hops' | 'key';
export type CmSortDir = 'asc' | 'desc';
export type CmLayout = 'table' | 'list';

export interface ContactManagerState {
  search: string;
  stateTab: CmStateTab;
  types: ContactKind[];        // empty = all kinds
  heard: CmHeard;
  favOnly: boolean;
  sortField: CmSortField;
  sortDir: CmSortDir;
  layout: CmLayout;
  compact: boolean;
  showKeys: boolean;
  selected: string[];          // publicKeyHex of checked rows
  focusKey: string | null;     // publicKeyHex of the row driving the rail/detail
}
```

Derivation output (`contactManagerView.ts`):
```ts
export interface CmCounts { all: number; onRadio: number; discovered: number; blocked: number; }
export interface CmView { rows: DiscoveredContact[]; counts: CmCounts; }
```

---

## Task 1: Store slice for the Manager view state

**Files:** Modify `src/renderer/lib/store.ts`

- [ ] **Step 1: Add the slice types + state + actions**

In `src/renderer/lib/store.ts`, add the type exports near the top type block (after the existing `import type`s):
```ts
import type { ContactKind } from '../../shared/types';

export type CmStateTab = 'all' | 'on-radio' | 'discovered' | 'blocked';
export type CmHeard = 'any' | 'hour' | 'day' | 'week';
export type CmSortField = 'lastHeard' | 'firstHeard' | 'name' | 'type' | 'hops' | 'key';
export type CmSortDir = 'asc' | 'desc';
export type CmLayout = 'table' | 'list';

export interface ContactManagerState {
  search: string;
  stateTab: CmStateTab;
  types: ContactKind[];
  heard: CmHeard;
  favOnly: boolean;
  sortField: CmSortField;
  sortDir: CmSortDir;
  layout: CmLayout;
  compact: boolean;
  showKeys: boolean;
  selected: string[];
  focusKey: string | null;
}

const CM_DEFAULTS: ContactManagerState = {
  search: '',
  stateTab: 'all',
  types: [],
  heard: 'any',
  favOnly: false,
  sortField: 'lastHeard',
  sortDir: 'asc',
  layout: 'table',
  compact: true,
  showKeys: true,
  selected: [],
  focusKey: null,
};
```

Add to the `CoreState` interface (near `discovered: DiscoveredContact[]`):
```ts
  contactManager: ContactManagerState;
  setCmFilter: (patch: Partial<ContactManagerState>) => void;
  toggleCmSelected: (key: string) => void;
  setCmSelected: (keys: string[]) => void;
  clearCmSelected: () => void;
  setCmFocus: (key: string | null) => void;
  setCmSort: (field: CmSortField) => void;
```

Add to the initial state (near `discovered: []`):
```ts
  contactManager: CM_DEFAULTS,
```

Add the action implementations (alongside `applyDiscovered`), matching the store's `set` style:
```ts
  setCmFilter: (patch) =>
    set((s) => ({ contactManager: { ...s.contactManager, ...patch } })),
  toggleCmSelected: (key) =>
    set((s) => {
      const has = s.contactManager.selected.includes(key);
      const selected = has
        ? s.contactManager.selected.filter((k) => k !== key)
        : [...s.contactManager.selected, key];
      return { contactManager: { ...s.contactManager, selected } };
    }),
  setCmSelected: (keys) =>
    set((s) => ({ contactManager: { ...s.contactManager, selected: keys } })),
  clearCmSelected: () =>
    set((s) => ({ contactManager: { ...s.contactManager, selected: [] } })),
  setCmFocus: (key) =>
    set((s) => ({ contactManager: { ...s.contactManager, focusKey: key } })),
  setCmSort: (field) =>
    set((s) => {
      const { sortField, sortDir } = s.contactManager;
      const dir: CmSortDir = sortField === field ? (sortDir === 'asc' ? 'desc' : 'asc') : 'asc';
      return { contactManager: { ...s.contactManager, sortField: field, sortDir: dir } };
    }),
```

- [ ] **Step 2: Verify and commit**

Run: `pnpm typecheck && pnpm lint` (both clean).
```bash
git add src/renderer/lib/store.ts
git commit -m "feat(renderer): contactManager view-state store slice"
```

---

## Task 2: Pure derivation (filter + sort + counts)

**Files:** Create `src/renderer/lib/contactManagerView.ts`

- [ ] **Step 1: Write the derivation module**

```ts
import type { DiscoveredContact } from '../../shared/contacts/discovered';
import type { CmHeard, CmSortDir, CmSortField, CmStateTab, ContactManagerState } from './store';

export interface CmCounts {
  all: number;
  onRadio: number;
  discovered: number;
  blocked: number;
}
export interface CmView {
  rows: DiscoveredContact[];
  counts: CmCounts;
}

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
const WEEK_MS = 604_800_000;

function heardWithin(c: DiscoveredContact, heard: CmHeard, nowMs: number): boolean {
  if (heard === 'any') return true;
  if (c.lastAdvertMs == null) return false;
  const age = nowMs - c.lastAdvertMs;
  if (heard === 'hour') return age <= HOUR_MS;
  if (heard === 'day') return age <= DAY_MS;
  return age <= WEEK_MS; // 'week'
}

function matchesTab(c: DiscoveredContact, tab: CmStateTab): boolean {
  switch (tab) {
    case 'on-radio':
      return c.onRadio && !c.blocked;
    case 'discovered':
      return !c.onRadio && !c.blocked;
    case 'blocked':
      return c.blocked;
    default:
      return !c.blocked; // 'all' excludes blocked
  }
}

function compare(a: DiscoveredContact, b: DiscoveredContact, field: CmSortField): number {
  switch (field) {
    case 'firstHeard':
      return b.firstHeardMs - a.firstHeardMs;
    case 'name':
      return a.name.localeCompare(b.name);
    case 'type':
      return a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name);
    case 'hops':
      return (a.hops ?? 99) - (b.hops ?? 99);
    case 'key':
      return a.publicKeyHex.localeCompare(b.publicKeyHex);
    default: // 'lastHeard'
      return (b.lastAdvertMs ?? 0) - (a.lastAdvertMs ?? 0);
  }
}

/** Counts are computed over the search+type+heard+fav filtered set (NOT the
 *  state-tab), so each tab shows how many rows it would contain. */
export function deriveContactView(
  discovered: DiscoveredContact[],
  cm: ContactManagerState,
  nowMs: number,
): CmView {
  const q = cm.search.trim().toLowerCase();
  const base = discovered.filter((c) => {
    if (q && !c.name.toLowerCase().includes(q) && !c.publicKeyHex.includes(q)) return false;
    if (cm.types.length > 0 && !cm.types.includes(c.kind)) return false;
    if (!heardWithin(c, cm.heard, nowMs)) return false;
    if (cm.favOnly && !c.favourite) return false;
    return true;
  });

  const counts: CmCounts = {
    all: base.filter((c) => !c.blocked).length,
    onRadio: base.filter((c) => c.onRadio && !c.blocked).length,
    discovered: base.filter((c) => !c.onRadio && !c.blocked).length,
    blocked: base.filter((c) => c.blocked).length,
  };

  const dir: number = cm.sortDir === 'asc' ? 1 : -1;
  const rows = base
    .filter((c) => matchesTab(c, cm.stateTab))
    .sort((a, b) => compare(a, b, cm.sortField) * dir);

  return { rows, counts };
}
```

- [ ] **Step 2: Verify and commit**

Run: `pnpm typecheck && pnpm lint`.
```bash
git add src/renderer/lib/contactManagerView.ts
git commit -m "feat(renderer): pure filter/sort/counts derivation for contact manager"
```

---

## Task 3: Capacity meter + shared row sub-components

**Files:** Create `src/renderer/panels/contacts/CapacityMeter.tsx`, `src/renderer/panels/contacts/ContactRows.tsx`

- [ ] **Step 1: CapacityMeter**

On-radio count = the on-radio `contacts` length (the sidebar set); max = `deviceInfo.maxContacts`.
```tsx
import { useStore } from '../../lib/store';

export function CapacityMeter() {
  const onRadio = useStore((s) => s.contacts.length);
  const max = useStore((s) => s.deviceInfo.maxContacts);
  const pct = max > 0 ? Math.min(100, Math.round((onRadio / max) * 100)) : 0;
  const warn = pct >= 90;
  return (
    <div className="flex items-center gap-2" title="Contacts committed to the radio's store">
      <div className="text-right">
        <div className="font-mono text-[11px] tabular-nums">
          <span className={warn ? 'text-cs-warn' : 'text-cs-accent'}>{onRadio}</span>
          <span className="text-cs-text-dim"> / {max || '—'}</span>
        </div>
        <div className="font-mono text-[9px] text-cs-text-dim">on radio</div>
      </div>
      <div className="h-1.5 w-14 overflow-hidden rounded-full border border-cs-border bg-cs-bg-3">
        <div className={`h-full ${warn ? 'bg-cs-warn' : 'bg-cs-accent'}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: ContactRows (TypeGlyph, StatusPill, HopChip, RowActions, TableView, ListRow)**

Build these in `ContactRows.tsx`. Use lucide icons: `User` (chat), `RadioTower` (repeater), `MessagesSquare`/`DoorOpen` (room), `Thermometer` (sensor), `Star`, `Plus`, `Minus`, `Ban`, `ChevronDown`. Reference the design spec for exact column widths/order. Concrete spec:

- `TypeGlyph({ kind, className })` → maps `ContactKind` to a lucide icon, `className="size-3.5 text-cs-text-muted"`.
- `StatusPill({ c }: { c: DiscoveredContact })` →
  - blocked: `<span className="inline-flex items-center gap-1 rounded-full border border-cs-danger/40 bg-cs-danger/10 px-2 py-px font-mono text-[9.5px] text-cs-danger">Blocked</span>`
  - onRadio: same shape, `border-cs-online/40 bg-cs-online/10 text-cs-online`, label `On Radio`.
  - else: `border-cs-border text-cs-text-dim`, label `Discovered`.
- `HopChip({ hops }: { hops?: number })` → `font-mono text-[10.5px] text-cs-text-muted`, shows `{hops} hop{hops===1?'':'s'}` or `—` when undefined.
- `RowActions({ c, client })` — hover-revealed buttons (the row wraps them in a `group`, actions use `opacity-0 group-hover:opacity-100`): if blocked → Unblock; else add↔remove from radio (`api.addToRadio`/`api.removeFromRadio`) + a Block button. Each calls the api with `client`, `stopPropagation`, toasts via `notify`, and a `disabled={!client}`. (Block uses `<BlockSenderDialog>` opened via local state, or `api.addBlockRules(client, [{ type:'pubkey', pattern:c.publicKeyHex, tsFrom: 0, enabled:true }])` for a one-click block — use the dialog for discoverability.)
- `TableView({ rows, client })` — a hand-rolled `<table className="w-full border-collapse">` mirroring `BlockedSection.tsx`. Sticky `<thead>` (`sticky top-0 bg-cs-bg`), header cells `font-mono text-[9.5px] uppercase tracking-wide text-cs-text-dim`. Columns in order: checkbox (40px), type glyph (34px), **Name** (flex: name `text-[12.5px] font-medium` + `Star` if `favourite` + pk beneath in `font-mono text-[10px] text-cs-text-dim` when `showKeys`; `line-through opacity-60` when blocked), **Type** (120px), **Hops** (84px), **First heard** (108px), **Last heard** (108px), **Status** (116px), row-actions (78px). Sortable headers (Name/Type/Hops/First/Last) call `setCmSort(field)` and show a rotating `ChevronDown` when active. Row vertical padding from `compact` (py-1.5) vs comfortable (py-2.5). Row `onClick` → `setCmFocus(c.publicKeyHex)`; row background `bg-cs-bg-3` when `focusKey===pk`, `bg-cs-accent-soft/15` when selected. The checkbox cell uses `<Checkbox checked={selected.includes(pk)} onCheckedChange={() => toggleCmSelected(pk)} />` with `onClick` stopPropagation.
- `ListRow({ c, client })` — the avatar + stacked-meta variant per the design spec (avatar tile `size-8 rounded-lg bg-cs-bg-3 border border-cs-border` with `TypeGlyph`, name row + meta row `font-mono text-[10.5px] text-cs-text-dim` = `type · lastHeard · hops` and pk when `showKeys`).

Use `useStore` inside these for `contactManager` (selected/focusKey/showKeys/compact), and import time formatters (`fmtRelative`, `fmtDateTime`) the same way `ContactCard.tsx` does. Read the design spec file for any visual detail not fixed here, and the `BlockedSection.tsx` table for the exact `<thead>/<tbody>` class idiom.

- [ ] **Step 3: Verify and commit**

Run: `pnpm typecheck && pnpm lint`.
```bash
git add src/renderer/panels/contacts/CapacityMeter.tsx src/renderer/panels/contacts/ContactRows.tsx
git commit -m "feat(contacts): capacity meter + table/list rows, status pills, row actions"
```

---

## Task 4: Toolbar (search + segments + filters + sort + view)

**Files:** Create `src/renderer/panels/contacts/Toolbar.tsx`

- [ ] **Step 1: Build the toolbar**

Two rows in a `<div className="flex flex-col gap-2.5 border-b border-cs-border px-4 py-2.5">`:

Row 1: a search `Input` (leading `Search` lucide icon, placeholder `Search {counts.all} contacts by name or key…`, value `cm.search`, `onChange` → `setCmFilter({ search })`) + a **segmented control** for `stateTab` (All / On Radio / Discovered / Blocked with counts from the derivation). Mirror the `FilterTab` underline pattern from `Unreads.tsx` OR a pill-segment; each segment `onClick` → `setCmFilter({ stateTab })` and shows its count.

Row 2: **Type** filter (a `Popover` with a `Checkbox` per `ContactKind` toggling membership in `cm.types`; trigger button shows "Type" + a count badge when `types.length>0`), **Heard** filter (`Select` with options Any time/Last hour/Last 24h/Last 7 days → `setCmFilter({ heard })`), **Favourites** toggle (`Button` `variant="ghost" size="icon-sm"` with `Star` filled `text-cs-warn` when `favOnly`), a spacer (`flex-1`), and a **Sort** `Select` (Last heard/First heard/Name/Type/Hops/Public key → `setCmSort(field)` showing current dir), plus a small **view** control (table↔list via two `Button`s, and a compact toggle). All read/write `useStore((s) => s.contactManager)` + the setters.

`Toolbar` takes `{ counts }: { counts: CmCounts }` (passed from the panel which runs the derivation once).

- [ ] **Step 2: Verify and commit**

Run: `pnpm typecheck && pnpm lint`.
```bash
git add src/renderer/panels/contacts/Toolbar.tsx
git commit -m "feat(contacts): manager toolbar (search, segments, filters, sort, view)"
```

---

## Task 5: ContactManager panel + mount at tool:contacts

**Files:** Create `src/renderer/panels/contacts/ContactManager.tsx`; Modify `src/renderer/shell/MainPane.tsx`

- [ ] **Step 1: The panel**

```tsx
import { useMemo } from 'react';
import type { ApiClient } from '../../lib/api';
import { deriveContactView } from '../../lib/contactManagerView';
import { useStore } from '../../lib/store';
import { CapacityMeter } from './CapacityMeter';
import { Toolbar } from './Toolbar';
import { SelectAllBar, TableView, ListRow } from './ContactRows';

export function ContactManager({ client }: { client: ApiClient | null }) {
  const discovered = useStore((s) => s.discovered);
  const cm = useStore((s) => s.contactManager);
  // nowMs from a stable source; the design data has no live clock requirement.
  const view = useMemo(() => deriveContactView(discovered, cm, Date.now()), [discovered, cm]);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="flex shrink-0 items-center gap-3 border-b border-cs-border bg-cs-bg-2 px-4 py-3">
        <div>
          <h1 className="text-sm font-semibold text-cs-text">Contacts</h1>
          <p className="font-mono text-[10px] text-cs-text-dim">discovered node adverts</p>
        </div>
        <div className="ml-auto">
          <CapacityMeter />
        </div>
      </header>
      <Toolbar counts={view.counts} />
      <SelectAllBar rows={view.rows} />
      <div className="flex-1 overflow-y-auto">
        {view.rows.length === 0 ? (
          <div className="px-5 py-12 text-center text-[13px] text-cs-text-dim">
            No contacts match these filters.
          </div>
        ) : cm.layout === 'table' ? (
          <TableView rows={view.rows} client={client} />
        ) : (
          <div>
            {view.rows.map((c) => (
              <ListRow key={c.publicKeyHex} c={c} client={client} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
```
Add `SelectAllBar({ rows })` to `ContactRows.tsx`: a `border-b border-cs-border px-4 py-1.5` bar with a `Checkbox` (checked when all `rows` selected, indeterminate when partial) that selects/clears all filtered keys via `setCmSelected(rows.map(r => r.publicKeyHex))` / `clearCmSelected()`, plus text "N selected" (with a Clear link) or "Select all N filtered".

- [ ] **Step 2: Mount it in MainPane**

In `src/renderer/shell/MainPane.tsx`, add to the lazy-import block:
```tsx
const ContactManager = lazy(() =>
  import('../panels/contacts/ContactManager').then((m) => ({ default: m.ContactManager })),
);
```
Replace the `activeKey === 'tool:contacts'` branch body (the `PlaceholderPanel`) with:
```tsx
  if (activeKey === 'tool:contacts') {
    return <ContactManager client={client} />;
  }
```
(Remove the now-unused `Users` import only if nothing else uses it — check first.)

- [ ] **Step 3: Verify and commit**

Run: `pnpm typecheck && pnpm lint`.
```bash
git add src/renderer/panels/contacts/ContactManager.tsx src/renderer/shell/MainPane.tsx
git commit -m "feat(contacts): ContactManager panel mounted at tool:contacts"
```

---

## Task 6: Contextual right rail (bulk + list actions)

**Files:** Create `src/renderer/shell/rightrail/sections/ContactManagerRail.tsx`; Modify `src/renderer/shell/rightrail/sectionsFor.tsx`, `src/renderer/shell/rightrail/helpers.ts`

- [ ] **Step 1: Rail section components**

In `ContactManagerRail.tsx`, export `BulkActions({ client })` and `ListActions({ client })`. Both read `useStore((s) => s.contactManager)` + `s.discovered` and re-derive the filtered rows with `deriveContactView` (for "all filtered" actions and counts). A shared `RailActionButton` (full-width, left-aligned, `flex items-center gap-2.5 rounded-md border border-cs-border bg-cs-bg-2 px-2.5 py-2 text-xs hover:bg-cs-bg-3`, leading lucide icon, optional sub-line in `font-mono text-[9.5px] text-cs-text-dim`, `tone` for danger → `text-cs-danger`).

**BulkActions** (shown when `selected.length > 0`): Add to radio · Remove from radio · Favourite · Block selected — each maps over `selected` calling the api (`api.addToRadio`/`removeFromRadio`/`setFavourite`/`addBlockRules`), then `clearCmSelected()` and a `notify.success` with the count. Plus a "Clear selection" text button.

**ListActions** (shown when `selected.length === 0`): 
- Add all filtered (`api.addToRadio` over the filtered discovered-only rows) / Remove all filtered.
- A "PRUNE OLDER THAN" 2×2 grid (7 days / 1 month / 3 months / 6 months) — for v1 these call `api.removeFromRadio` over on-radio, non-favourite rows whose `lastAdvertMs` is older than the threshold; toast the count or "No contacts older than {label}".
- Auto-Add settings → `setActiveKey('tool:settings:device-config')` (or the real auto-add settings key — confirm in MainPane/settings; if unknown, link to `tool:settings`).
- Import / Export → `notify.info('Import JSON')` / `notify.info('Export JSON')` stubs (Phase 1 deferred cmds 17/18; keep as visible stubs).
- **Clear discovered list** — danger. **MUST show the count it will delete and confirm** before calling `api.clearDiscovered(client)` (lesson from device testing: after a radio wipe, every discovered row is off-radio, so Clear purges the whole pool). Use a `Dialog` (shadcn `dialog.tsx`) confirming "Delete N discovered-only contacts? On-radio contacts are kept." Compute N = filtered/all discovered-only count.
- Add block rule → open `<BlockSenderDialog client={client} open prefill={{}} onClose={…} />`.

- [ ] **Step 2: Wire sectionsFor + railTitle**

In `src/renderer/shell/rightrail/sectionsFor.tsx`, add near the other `tool:` early-returns:
```tsx
  if (activeKey === 'tool:contacts') {
    const selectedCount = /* read via a passed value or a small selector wrapper */ 0;
    return [
      {
        id: 'rail.cm.actions',
        label: 'Actions',
        defaultOpen: true,
        body: () => <ContactManagerRailBody client={opts.client} />,
      },
    ];
  }
```
Because `sectionsFor` is a plain function (not a component), put the selection-vs-list decision INSIDE a component: create `ContactManagerRailBody({ client })` in `ContactManagerRail.tsx` that reads `useStore((s) => s.contactManager.selected)` and renders `<BulkActions>` when non-empty else `<ListActions>`. Import it in `sectionsFor.tsx`. (Confirm the opts param name — it's the 3rd arg `{ clearMentionedContact, client }`.)

In `src/renderer/shell/rightrail/helpers.ts`, add a `railTitle` case: `if (activeKey === 'tool:contacts') return 'Contacts';`.

- [ ] **Step 3: Verify and commit**

Run: `pnpm typecheck && pnpm lint`.
```bash
git add src/renderer/shell/rightrail/sections/ContactManagerRail.tsx src/renderer/shell/rightrail/sectionsFor.tsx src/renderer/shell/rightrail/helpers.ts
git commit -m "feat(contacts): contextual right-rail bulk + list actions"
```

---

## Phase 2 manual verification (device, user-driven)

`pnpm start`, navigate to Contacts (`tool:contacts`):
- [ ] The pool renders as a compact table with keys; capacity meter shows on-radio/max.
- [ ] Search filters by name/key; the All/On Radio/Discovered/Blocked segments filter and show correct counts; Type/Heard/Favourites/Sort all work; table↔list toggles.
- [ ] Row click focuses the row (highlight) without selecting; checkbox selects; "select all filtered" works.
- [ ] With rows selected, the right rail shows Bulk actions; Add to radio moves them to the sidebar; Remove/Favourite/Block work and toast.
- [ ] With nothing selected, the rail shows List actions; "Clear discovered list" shows the **count + confirm** before deleting; Add block rule opens the dialog.
- [ ] Blocked rows are dimmed/struck and appear under the Blocked segment.

---

## Self-review notes (author)

- **Spec coverage:** capacity meter (T3), table+list+pills+row-actions (T3), toolbar/filters/sort/view (T4), panel+mount (T5), bulk+list rail incl. prune & clear-with-confirm (T6), derivation+counts (T2), shared view state so panel+rail agree (T1). Heard-Via inspector + rich detail are Phase 3.
- **No placeholders for logic/state/wiring** (T1, T2, T3 CapacityMeter, T5 panel, T6 wiring are complete code). The visual components in T3/T4 are specified at class-and-behavior level with the exact templates (`Unreads.tsx`, `BlockedSection.tsx`) and design-spec reference to mirror — implementers must match the design spec, not invent.
- **Type consistency:** `ContactManagerState`, `Cm*` unions, `deriveContactView`, `CmView/CmCounts`, and the store action names (`setCmFilter`/`toggleCmSelected`/`setCmSelected`/`clearCmSelected`/`setCmFocus`/`setCmSort`) are used consistently across T1–T6.
- **Confirm during execution:** the auto-add settings route key; that `deviceInfo.maxContacts` is populated on connect (Phase 1 sets it from DEVICE_INFO); the `sectionsFor` opts param name; whether `Users` import in MainPane becomes unused.
