# Stable Unreads Sidebar Link Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the left-nav "Unreads" link a fixed row at the top of the Conversations group that no longer appears/disappears with the unread count, and add a setting to show/hide it.

**Architecture:** Extract the Unreads link's markup into a small, prop-driven `UnreadsNavItem` component so it can be unit-tested in isolation (the spec's inline markup, lifted into a named unit — identical DOM). The LeftNav renders it as the first child of the Conversations `SidebarMenu`, gated on a new `showLeftNavUnreads` app setting instead of on `totalUnread > 0`. The count badge always renders: accent style + pulse when there are unreads, a dimmed `0` chip otherwise. The command-palette entry is untouched, so the pane stays reachable when the link is hidden.

**Tech Stack:** React 19, Zustand store (`useStore`), shadcn sidebar primitives, Vitest (`unit` node project + `dom` jsdom project), React Testing Library, Biome, TypeScript (`noUnusedLocals` on).

**Spec:** `docs/superpowers/specs/2026-06-15-unreads-sidebar-link-design.md`

---

## File Structure

- **Modify** `src/shared/types.ts` — add `showLeftNavUnreads: boolean` to `AppSettings` (after `showLeftNavSearch`, line 378) and `showLeftNavUnreads: true` to `DEFAULT_APP_SETTINGS` (after line 442).
- **Create** `src/renderer/shell/leftnav/UnreadsNavItem.tsx` — prop-driven Unreads row (icon, label, count badge, pulse).
- **Modify** `src/renderer/shell/leftnav/index.tsx` — drop the old standalone block, drop the now-unused `Inbox` import, read the new setting, render `<UnreadsNavItem>` as the first child of the Conversations menu.
- **Modify** `src/renderer/panels/settings/app/Behavior.tsx` — add the "Show Unreads link" toggle (eq, onSave patch, `Row`).
- **Modify** `tests/component/setup.ts` — add a `window.matchMedia` stub (jsdom lacks it; `SidebarProvider`'s `useIsMobile` needs it).
- **Create** `tests/component/unreads-nav-item.test.tsx` — badge/pulse/label/click tests for `UnreadsNavItem`.
- **Create** `tests/unit/shared/settings/left-nav-unreads-default.test.ts` — asserts the default is `true`.
- **Create** `tests/unit/renderer/features/command-palette/unreads-tool-item.test.ts` — guards that the palette keeps the `tool:unreads` entry.

---

## Task 1: Add the `showLeftNavUnreads` setting (type + default)

**Files:**
- Test: `tests/unit/shared/settings/left-nav-unreads-default.test.ts` (create)
- Modify: `src/shared/types.ts` (interface ~line 378, default ~line 442)

- [ ] **Step 1: Write the failing test**

Create `tests/unit/shared/settings/left-nav-unreads-default.test.ts`:

```ts
import { describe, expect, test } from 'vitest';
import { DEFAULT_APP_SETTINGS } from '../../../../src/shared/types';

describe('DEFAULT_APP_SETTINGS.showLeftNavUnreads', () => {
  test('defaults the Unreads sidebar link to visible', () => {
    expect(DEFAULT_APP_SETTINGS.showLeftNavUnreads).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test:unit tests/unit/shared/settings/left-nav-unreads-default.test.ts`
Expected: FAIL — `showLeftNavUnreads` does not exist on `DEFAULT_APP_SETTINGS` (TS error / `undefined` is not `true`).

- [ ] **Step 3: Add the field to the `AppSettings` interface**

In `src/shared/types.ts`, immediately after the `showLeftNavSearch: boolean;` line (line 378):

```ts
  showLeftNavSearch: boolean;
  /** Show the Unreads shortcut at the top of the Conversations section in the
   *  LeftNav. When off, the pane is still reachable from the command palette.
   *  Rendered independently of the unread count so the list never shifts. */
  showLeftNavUnreads: boolean;
```

- [ ] **Step 4: Add the default value**

In `src/shared/types.ts`, immediately after the `showLeftNavSearch: true,` line (line 442) in `DEFAULT_APP_SETTINGS`:

```ts
  showLeftNavSearch: true,
  showLeftNavUnreads: true,
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm test:unit tests/unit/shared/settings/left-nav-unreads-default.test.ts`
Expected: PASS (1 test).

Also run: `pnpm typecheck`
Expected: PASS (no errors — `DEFAULT_APP_SETTINGS` now satisfies the updated interface).

- [ ] **Step 6: Commit**

```bash
git add src/shared/types.ts tests/unit/shared/settings/left-nav-unreads-default.test.ts
git commit -m "feat(settings): add showLeftNavUnreads setting (default on)"
```

---

## Task 2: Create the `UnreadsNavItem` component

**Files:**
- Modify: `tests/component/setup.ts` (add matchMedia stub)
- Test: `tests/component/unreads-nav-item.test.tsx` (create)
- Create: `src/renderer/shell/leftnav/UnreadsNavItem.tsx`

- [ ] **Step 1: Add a `window.matchMedia` stub to the dom test setup**

`SidebarProvider` calls `useIsMobile`, whose effect calls `window.matchMedia` — undefined under jsdom. Add this to `tests/component/setup.ts` (after the existing imports / `cleanup` block):

```ts
// jsdom doesn't implement matchMedia. shadcn's SidebarProvider -> useIsMobile
// calls window.matchMedia in an effect, so any component test that mounts the
// sidebar needs a stub.
if (typeof window !== 'undefined' && !window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}
```

- [ ] **Step 2: Write the failing test**

Create `tests/component/unreads-nav-item.test.tsx`:

```tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import { SidebarMenu, SidebarProvider } from '@/components/ui/sidebar';
import { UnreadsNavItem } from '@/shell/leftnav/UnreadsNavItem';

function renderItem(props: { totalUnread: number; isActive?: boolean; onSelect?: () => void }) {
  const onSelect = props.onSelect ?? (() => {});
  return render(
    <SidebarProvider>
      <SidebarMenu>
        <UnreadsNavItem totalUnread={props.totalUnread} isActive={props.isActive ?? false} onSelect={onSelect} />
      </SidebarMenu>
    </SidebarProvider>,
  );
}

describe('UnreadsNavItem', () => {
  test('always renders the Unreads link', () => {
    renderItem({ totalUnread: 0 });
    expect(screen.queryByRole('button', { name: /unreads/i })).not.toBeNull();
  });

  test('zero unreads: dimmed "0" badge, no pulse dot', () => {
    const { container } = renderItem({ totalUnread: 0 });
    const badge = screen.getByRole('status');
    expect(badge.textContent).toBe('0');
    expect(badge.className).toContain('bg-cs-bg-2');
    expect(badge.className).not.toContain('bg-cs-accent');
    expect(container.querySelector('.animate-pulse')).toBeNull();
  });

  test('unreads present: accent badge with count and a pulse dot', () => {
    const { container } = renderItem({ totalUnread: 3 });
    const badge = screen.getByRole('status');
    expect(badge.textContent).toBe('3');
    expect(badge.className).toContain('bg-cs-accent');
    expect(container.querySelector('.animate-pulse')).not.toBeNull();
  });

  test('caps the badge at 99+', () => {
    renderItem({ totalUnread: 150 });
    expect(screen.getByRole('status').textContent).toBe('99+');
  });

  test('clicking the link calls onSelect', () => {
    const onSelect = vi.fn();
    renderItem({ totalUnread: 0, onSelect });
    fireEvent.click(screen.getByRole('button', { name: /unreads/i }));
    expect(onSelect).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm test:dom tests/component/unreads-nav-item.test.tsx`
Expected: FAIL — cannot resolve `@/shell/leftnav/UnreadsNavItem` (module does not exist yet).

- [ ] **Step 4: Create the component**

Create `src/renderer/shell/leftnav/UnreadsNavItem.tsx`:

```tsx
import { Inbox } from 'lucide-react';
import { SidebarMenuButton, SidebarMenuItem } from '../../components/ui/sidebar';
import { ACTIVE_BUTTON_CLASS } from './atoms';

interface UnreadsNavItemProps {
  totalUnread: number;
  isActive: boolean;
  onSelect: () => void;
}

/** Fixed "Unreads" shortcut at the top of the Conversations group. Its
 *  visibility is owned by the parent (the `showLeftNavUnreads` setting), so it
 *  renders independently of `totalUnread` — the list below never shifts when
 *  unread counts change. When there are no unreads it shows a dimmed `0` chip
 *  and omits the pulse dot. */
export function UnreadsNavItem({ totalUnread, isActive, onSelect }: UnreadsNavItemProps) {
  const hasUnread = totalUnread > 0;
  return (
    <SidebarMenuItem>
      <SidebarMenuButton tooltip="Unreads" isActive={isActive} onClick={onSelect} className={ACTIVE_BUTTON_CLASS}>
        <span className="relative flex shrink-0 items-center">
          <Inbox className="size-4" />
          {hasUnread && (
            <span className="absolute -right-1 -top-1 size-1.5 animate-pulse rounded-full bg-cs-accent" />
          )}
        </span>
        <span>Unreads</span>
        <span
          role="status"
          aria-label={`${totalUnread} unread`}
          className={
            hasUnread
              ? 'ml-auto rounded-full bg-cs-accent px-1.5 py-px font-mono text-[10px] leading-none text-cs-bg tabular-nums'
              : 'ml-auto rounded-full bg-cs-bg-2 px-1.5 py-px font-mono text-[10px] leading-none text-cs-text-dim tabular-nums'
          }
        >
          {totalUnread > 99 ? '99+' : totalUnread}
        </span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm test:dom tests/component/unreads-nav-item.test.tsx`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add src/renderer/shell/leftnav/UnreadsNavItem.tsx tests/component/unreads-nav-item.test.tsx tests/component/setup.ts
git commit -m "feat(leftnav): add prop-driven UnreadsNavItem with muted-zero badge"
```

---

## Task 3: Wire `UnreadsNavItem` into the LeftNav

**Files:**
- Modify: `src/renderer/shell/leftnav/index.tsx` (import line 1, imports ~line 35, selector ~line 52, remove block 260–286, add render ~line 289)

- [ ] **Step 1: Add the component import**

In `src/renderer/shell/leftnav/index.tsx`, add to the local imports near the other `./` imports (e.g. just below the `ParentBranch` import on line 34):

```ts
import { ParentBranch } from './ParentBranch';
import { sortByPinned, sortChannels } from './sorting';
import { UnreadsNavItem } from './UnreadsNavItem';
```

- [ ] **Step 2: Drop the now-unused `Inbox` import**

`Inbox` is only used by the block being removed in Step 4. Change line 1 from:

```ts
import { Hash, Inbox, Plus, Search, Users, X } from 'lucide-react';
```

to:

```ts
import { Hash, Plus, Search, Users, X } from 'lucide-react';
```

- [ ] **Step 3: Read the new setting**

In the `appSettings` selectors near the top of `LeftNav`, just after the `pinUnreadToTop` line (line 52), add:

```ts
  const pinUnreadToTop = useStore((s) => s.appSettings.pinUnreadToTop);
  const showLeftNavUnreads = useStore((s) => s.appSettings.showLeftNavUnreads);
```

- [ ] **Step 4: Remove the old standalone Unreads block**

Delete the entire block at lines 260–286 (the `{totalUnread > 0 && ( <SidebarGroup className="pb-0"> … </SidebarGroup> )}` group), so the JSX goes straight from the search field's closing `)}` (line 259) to the Conversations `<SidebarGroup>` (line 287).

- [ ] **Step 5: Render `UnreadsNavItem` as the first child of the Conversations menu**

In the Conversations group, immediately after `<SidebarMenu>` (line 289) and before the `<Popover open={addChannelOpen} …>` that wraps Channels, add:

```tsx
          <SidebarMenu>
            {showLeftNavUnreads && (
              <UnreadsNavItem
                totalUnread={totalUnread}
                isActive={activeKey === 'tool:unreads'}
                onSelect={() => setActiveKey('tool:unreads')}
              />
            )}
            <Popover open={addChannelOpen} onOpenChange={setAddChannelOpen}>
```

- [ ] **Step 6: Run typecheck and lint**

Run: `pnpm typecheck`
Expected: PASS — no unused `Inbox`, `showLeftNavUnreads` resolves, `UnreadsNavItem` props match.

Run: `pnpm lint src tests`
Expected: PASS (no `noUnusedImports` warnings for `Inbox`).

- [ ] **Step 7: Run the dom tests to confirm nothing regressed**

Run: `pnpm test:dom`
Expected: PASS (existing component test + the new `UnreadsNavItem` tests).

- [ ] **Step 8: Commit**

```bash
git add src/renderer/shell/leftnav/index.tsx
git commit -m "feat(leftnav): move Unreads link under Conversations, gate on setting"
```

---

## Task 4: Add the "Show Unreads link" toggle to the Behavior settings

**Files:**
- Modify: `src/renderer/panels/settings/app/Behavior.tsx` (eq ~line 26, onSave ~line 48, Row after the "Show sidebar search" row ~line 126)

- [ ] **Step 1: Add the field to the equality check**

In `eqBehavior`, after the `a.showLeftNavSearch === b.showLeftNavSearch &&` line (line 26):

```ts
  a.showLeftNavSearch === b.showLeftNavSearch &&
  a.showLeftNavUnreads === b.showLeftNavUnreads &&
```

- [ ] **Step 2: Add the field to the onSave patch**

In the `onSave` patch object, after the `showLeftNavSearch: d.showLeftNavSearch,` line (line 48):

```ts
          showLeftNavSearch: d.showLeftNavSearch,
          showLeftNavUnreads: d.showLeftNavUnreads,
```

- [ ] **Step 3: Add the toggle Row**

Immediately after the "Show sidebar search" `Row` (it closes on line 126, before the "Collapse long lists" Row), insert:

```tsx
      <Row
        label="Show Unreads link"
        description="Show the Unreads shortcut at the top of Conversations. When hidden, it's still reachable from the command palette."
        changed={draft.showLeftNavUnreads !== saved.showLeftNavUnreads}
        control={
          <Toggle checked={draft.showLeftNavUnreads} onChange={(v) => setDraft((s) => ({ ...s, showLeftNavUnreads: v }))} />
        }
      />
```

- [ ] **Step 4: Run typecheck and lint**

Run: `pnpm typecheck`
Expected: PASS.

Run: `pnpm lint src tests`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/panels/settings/app/Behavior.tsx
git commit -m "feat(settings): Behavior toggle to show/hide the Unreads link"
```

---

## Task 5: Guard that the command palette keeps the Unreads entry

**Files:**
- Test: `tests/unit/renderer/features/command-palette/unreads-tool-item.test.ts` (create)

- [ ] **Step 1: Write the test**

This documents that palette access to the Unreads pane is independent of the `showLeftNavUnreads` setting. Create `tests/unit/renderer/features/command-palette/unreads-tool-item.test.ts`:

```ts
import { describe, expect, test } from 'vitest';
import { TOOL_ITEMS } from '@/features/command-palette/items/tools';

describe('command palette Unreads entry', () => {
  test('TOOL_ITEMS includes a tool:unreads item so the pane stays reachable when the sidebar link is hidden', () => {
    const unreads = TOOL_ITEMS.find((t) => t.key === 'tool:unreads');
    expect(unreads).toBeDefined();
    expect(unreads?.label).toBe('Unreads');
  });
});
```

- [ ] **Step 2: Run the test to verify it passes**

Run: `pnpm test:unit tests/unit/renderer/features/command-palette/unreads-tool-item.test.ts`
Expected: PASS (1 test). (This is a green-on-first-run guard test — the entry already exists and we are not changing it; the test fails loudly only if a future change removes palette access.)

- [ ] **Step 3: Commit**

```bash
git add tests/unit/renderer/features/command-palette/unreads-tool-item.test.ts
git commit -m "test(command-palette): guard Unreads pane stays palette-reachable"
```

---

## Final Verification

- [ ] **Full test suite:** `pnpm test` → all `unit`, `integration`, and `dom` projects pass.
- [ ] **Typecheck:** `pnpm typecheck` → no errors.
- [ ] **Lint:** `pnpm lint src tests` → clean.
- [ ] **Manual smoke (optional, via the `/run` skill):** launch the app, confirm:
  - With unreads, the "Unreads" link sits at the top of Conversations with the accent count badge and pulse; reading them all turns the badge into a dimmed `0` **without** the Channels/Contacts rows shifting.
  - Settings → Behavior → "Show Unreads link" off hides the sidebar link; the pane is still reachable from the command palette ("Go to → Unreads").

---

## Self-Review Notes

- **Spec coverage:** setting + default (Task 1), always-present link under Conversations + muted-zero badge (Tasks 2–3), settings toggle (Task 4), palette independence (Task 5), height-stability via setting-gated render (Task 3). All spec sections map to a task.
- **Deviation from spec:** the spec showed the markup inline in `leftnav/index.tsx`; this plan lifts the identical markup into `UnreadsNavItem.tsx` so it is unit-testable without scaffolding the entire LeftNav store state (owner/channels/contacts/transport). DOM output and placement are unchanged. This matches the codebase's testing approach (small isolated component tests) and the brainstorming isolation principle.
- **Type consistency:** `showLeftNavUnreads` (boolean) is used identically in types.ts, the store selector, Behavior.tsx, and the LeftNav render. `UnreadsNavItem` props (`totalUnread`, `isActive`, `onSelect`) match between the component, its test, and the LeftNav call site.
- **No placeholders:** every step has concrete code and an exact command with expected result.
