# Stable Unreads Sidebar Link — Design

- **Date:** 2026-06-15
- **Status:** Approved (ready for implementation plan)
- **Area:** left nav (`src/renderer/shell/leftnav/index.tsx`), app settings
  (`src/shared/types.ts`, `src/renderer/panels/settings/app/Behavior.tsx`)

## Summary

Stop the left-nav lists from jumping vertically when unread counts change, and
give the user control over the Unreads shortcut.

Today the **Unreads** link lives in its own `SidebarGroup` rendered **above** the
"Conversations" group, and it is mounted only when `totalUnread > 0`
([`leftnav/index.tsx:260-286`](../../../src/renderer/shell/leftnav/index.tsx)).
When the last unread is read (1 → 0) the whole group unmounts and everything
below — Channels, Contacts, Tools — shifts up; when a new unread arrives (0 → 1)
it all shifts back down. That mount/unmount is the height jump.

The fix: move the link **inside** the Conversations group as a fixed first row
and render it based on a **setting** rather than the unread count, so its
presence never depends on whether anything is unread.

## Decisions (from brainstorming)

- **Placement:** first `SidebarMenuItem` inside the existing **Conversations**
  `SidebarMenu`, **above** the Channels branch — a fixed anchor directly under
  the "Conversations" heading.
- **Always present when enabled:** the link renders whenever the setting is on,
  regardless of `totalUnread`. This is what removes the height jump.
- **Zero-unread appearance — muted "0" badge:** the count chip always renders.
  `totalUnread > 0` keeps the current accent style and pulsing dot;
  `totalUnread === 0` shows a dimmed `0` chip and omits the pulse dot. Row height
  is identical in both states.
- **New setting `showLeftNavUnreads: boolean`, default `true`.** When off, the
  sidebar link is hidden but the Unreads pane stays reachable from the command
  palette. Named for consistency with the sibling `showLeftNavSearch`; the UI
  label is "Show Unreads link".
- **Command palette unchanged.** The `tool:unreads` entry stays in `TOOL_ITEMS`,
  independent of the setting.
- **Out of scope:** changing the Unreads pane itself, the badge math
  (`useUnreadByKey`/`totalUnread`), or any other left-nav group.

## Data Model

`src/shared/types.ts` — add one field to `AppSettings` (near the existing
`showLeftNavSearch`):

```ts
export interface AppSettings {
  // …
  showLeftNavSearch: boolean;
  showLeftNavUnreads: boolean; // new
  // …
}
```

and its default in `DEFAULT_APP_SETTINGS`:

```ts
showLeftNavSearch: true,
showLeftNavUnreads: true, // new
```

The settings load path recursively merges defaults over the stored file
(`mergeDefaults` in `src/main/storage/settings.ts`), so existing users' saved
`app-settings.json` gains `showLeftNavUnreads: true` automatically on next read —
no migration needed.

## Settings UI — Behavior section

`src/renderer/panels/settings/app/Behavior.tsx`:

1. Add the field to the dirty-check equality:

   ```ts
   const eqBehavior = (a, b) =>
     // …
     a.showLeftNavSearch === b.showLeftNavSearch &&
     a.showLeftNavUnreads === b.showLeftNavUnreads &&
     // …
   ```

2. Include it in the `onSave` patch alongside `showLeftNavSearch`.

3. Add a `Row` + `Toggle`, placed just after the existing "Show sidebar search"
   row for thematic grouping:

   ```tsx
   <Row
     label="Show Unreads link"
     description="Show the Unreads shortcut in the sidebar. When hidden, it's still reachable from the command palette."
     changed={draft.showLeftNavUnreads !== saved.showLeftNavUnreads}
     control={
       <Toggle checked={draft.showLeftNavUnreads} onChange={(v) => setDraft((s) => ({ ...s, showLeftNavUnreads: v }))} />
     }
   />
   ```

## Left Nav — `leftnav/index.tsx`

1. Read the setting alongside the other `appSettings` selectors already in the
   component:

   ```ts
   const showLeftNavUnreads = useStore((s) => s.appSettings.showLeftNavUnreads);
   ```

2. **Delete** the standalone `{totalUnread > 0 && (<SidebarGroup className="pb-0">…</SidebarGroup>)}`
   block (current lines 260–286).

3. Re-add the Unreads link as the **first child** of the Conversations
   `SidebarMenu` (immediately inside `<SidebarMenu>` on line 289, before the
   Channels `Popover`/`ParentBranch`), gated on the setting and with the
   muted-zero badge logic:

   ```tsx
   {showLeftNavUnreads && (
     <SidebarMenuItem>
       <SidebarMenuButton
         tooltip="Unreads"
         isActive={activeKey === 'tool:unreads'}
         onClick={() => setActiveKey('tool:unreads')}
         className={ACTIVE_BUTTON_CLASS}
       >
         <span className="relative flex shrink-0 items-center">
           <Inbox className="size-4" />
           {totalUnread > 0 && (
             <span className="absolute -right-1 -top-1 size-1.5 animate-pulse rounded-full bg-cs-accent" />
           )}
         </span>
         <span>Unreads</span>
         <span
           role="status"
           aria-label={`${totalUnread} unread`}
           className={
             totalUnread > 0
               ? 'ml-auto rounded-full bg-cs-accent px-1.5 py-px font-mono text-[10px] leading-none text-cs-bg tabular-nums'
               : 'ml-auto rounded-full bg-cs-bg-2 px-1.5 py-px font-mono text-[10px] leading-none text-cs-text-dim tabular-nums'
           }
         >
           {totalUnread > 99 ? '99+' : totalUnread}
         </span>
       </SidebarMenuButton>
     </SidebarMenuItem>
   )}
   ```

   Differences from today's markup: it's a bare `SidebarMenuItem` (no wrapping
   `SidebarGroup`), the pulse dot and accent badge are now conditional on
   `totalUnread > 0`, and a dimmed badge renders the `0`. The `aria-label`
   continues to announce the live count (`"0 unread"` when empty).

No other group changes. `totalUnread` / `unreadByKey` continue to come from
`useUnreadByKey()` and are still used by the Channels/Contacts branches.

## Command Palette

No change. `tool:unreads` in
`src/renderer/features/command-palette/items/tools.ts` and its inclusion via
`buildGotoItems()` are independent of `showLeftNavUnreads`, so the pane stays
reachable when the sidebar link is hidden.

## Edge Cases

- **0 unreads, setting on** → link present with a dimmed `0` badge, no pulse. No
  layout shift versus the unread state.
- **Setting off** → no Unreads link in the sidebar; pane still reachable via
  command palette. (A deliberate, static choice — not a per-message change — so
  it doesn't reintroduce jumpiness.)
- **On the Unreads pane while the link is hidden** → pane renders normally;
  `activeKey === 'tool:unreads'` is unaffected by the link's visibility.
- **Existing saved settings** → `mergeDefaults` supplies `showLeftNavUnreads:
  true`, so current users keep the link by default.

## Testing

Component/RTL test on the left nav (new file under `tests/component/`, following
the existing `useStore.getState()` setup pattern):

- `showLeftNavUnreads: true`, `totalUnread === 0` → an "Unreads" link renders;
  badge text is `0`; no pulse dot.
- `showLeftNavUnreads: true`, unreads > 0 → "Unreads" link renders with the
  accent badge showing the count (and `99+` past 99).
- `showLeftNavUnreads: false` → no "Unreads" link in the rendered sidebar.

Plus a lightweight assertion that the command-palette `tool:unreads` item exists
regardless of the setting (e.g. it remains in `TOOL_ITEMS` / `buildGotoItems`
output), documenting that palette access is independent of the toggle.

Verification: `pnpm test` (scoped), `pnpm typecheck`, and `pnpm lint src tests`.

## Approaches Considered

- **Gate on the setting, render inside Conversations (chosen).** Decouples
  presence from unread count, which is the root cause of the height jump, and
  adds the requested visibility control with the established settings pattern.
- **Keep gating on `totalUnread > 0` but reserve space with a placeholder.**
  Would stop the jump without a setting, but leaves dead space and no way to hide
  the link. Rejected — doesn't meet the show/hide requirement.
- **Label-only zero state (no badge).** Cleaner visually but the user chose the
  muted "0" badge for consistency. Rejected per that decision.
