# Channel addition Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a popover-driven UI for creating and joining MeshCore channels (Create private / Join private / Join public / Join hashtag) reachable from a `+` button next to the LeftNav "Channels" row, a right-click context menu on the same row, and the Command Palette.

**Architecture:** A controlled Radix Popover anchored to the new `+` button in `LeftNav`. The same popover is opened from three triggers (button click, context-menu item, palette command) by routing all of them through a single new store flag `ui.addChannelOpen`. The popover internally toggles between a `pick` view (four type rows matching the mockup) and a `form` view (type-specific inputs). On submit, the client calls `PUT /api/channels/:key` to upsert into app storage, then `POST /api/channels/:key/push-to-device` to write to a free radio slot. If push fails after PUT succeeds, the client rolls back via `DELETE /api/channels/:key`. The entire flow is gated to `transport === 'connected'`.

**Tech Stack:** React + TypeScript, Zustand (`useStore`), Radix Popover (`components/ui/popover`), existing `ContextMenu` primitive (`components/ContextMenu`), existing `api.putChannel` / `api.pushChannelToDevice` / `api.deleteChannel` client wrappers, `notify` for toasts. Package manager: pnpm. Verification: `pnpm typecheck` + `pnpm lint` + manual smoke test. (This repo has no UI test framework configured — do not add one; manual verification + typecheck + lint is the agreed verification path per the spec.)

**Spec reference:** [docs/superpowers/specs/2026-05-22-channel-addition-design.md](../specs/2026-05-22-channel-addition-design.md)

---

## File map

**New:**
- `src/renderer/lib/randomSecret.ts` — `generate16ByteHex()` helper.
- `src/renderer/components/AddChannelPopover.tsx` — picker + form views + submit logic.

**Modified:**
- `src/renderer/lib/store.ts` — add `ui.addChannelOpen` boolean + `setAddChannelOpen` setter.
- `src/shared/types.ts` — extend `UiState` with `addChannelOpen?: boolean` (transient — do not persist).
- `src/renderer/shell/LeftNav.tsx` — render `<Popover>` wrapper around the Channels parent row; add `+` trigger and right-click context menu; pass open state from store.
- `src/renderer/features/CommandPalette.tsx` — add "Add channel…" action item.

---

## Task 1: Store flag + random-secret helper

**Files:**
- Modify: `src/shared/types.ts` (extend `UiState`)
- Modify: `src/renderer/lib/store.ts` (default + setter)
- Create: `src/renderer/lib/randomSecret.ts`

This task introduces the cross-cutting state and a tiny helper so subsequent tasks have somewhere to wire into.

- [ ] **Step 1: Locate the `UiState` interface and `DEFAULT_UI_STATE` constant**

Run:
```bash
grep -n "interface UiState\|DEFAULT_UI_STATE" src/shared/types.ts src/renderer/lib/store.ts
```

Expected output identifies the `UiState` declaration in `src/shared/types.ts` and the `DEFAULT_UI_STATE` initializer in `src/renderer/lib/store.ts`. Read both before editing so the new field lands in the right place.

- [ ] **Step 2: Add `addChannelOpen` to `UiState`**

In `src/shared/types.ts`, locate the `UiState` interface. Add a new optional field right after the existing transient flags (next to `selectedContactKey`, or wherever the file groups ephemeral UI flags):

```ts
  /** True while the Add Channel popover is open. Transient — not persisted. */
  addChannelOpen?: boolean;
```

Do not add it to any persistence serializer; it is intentionally transient.

- [ ] **Step 3: Initialize the new field in `DEFAULT_UI_STATE`**

In `src/renderer/lib/store.ts`, find the `DEFAULT_UI_STATE` constant. Add:

```ts
  addChannelOpen: false,
```

next to the other boolean defaults inside that object.

- [ ] **Step 4: Add the `setAddChannelOpen` action to the store**

In `src/renderer/lib/store.ts`, locate the `CoreState` interface (around line 170–250 — has methods like `setLeftNavGroup`, `setRailSection`). Add the action signature:

```ts
  setAddChannelOpen: (open: boolean) => void;
```

Then in the `create<CoreState>((set) => ({ ... }))` body (around line 302+, where the other ui setters live near `setLeftNavGroup`), add the implementation:

```ts
  setAddChannelOpen: (open) => set((s) => ({ ui: { ...s.ui, addChannelOpen: open } })),
```

- [ ] **Step 5: Create the random-secret helper**

Create `src/renderer/lib/randomSecret.ts` with exactly:

```ts
// Cryptographically random 16-byte shared key for a new private channel,
// lowercase hex-encoded. Uses the Web Crypto API which is available in
// Electron's renderer context.
export function generate16ByteHex(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
```

- [ ] **Step 6: Verify the build is still green**

Run:
```bash
pnpm typecheck
```

Expected: exits 0. If errors mention `addChannelOpen`, you missed the `DEFAULT_UI_STATE` update or the field name diverges.

Run:
```bash
pnpm lint
```

Expected: exits 0.

- [ ] **Step 7: Commit**

```bash
git add src/shared/types.ts src/renderer/lib/store.ts src/renderer/lib/randomSecret.ts
git commit -m "feat(channels): add UI state flag and random-secret helper for add-channel popover"
```

---

## Task 2: AddChannelPopover skeleton (picker view only)

**Files:**
- Create: `src/renderer/components/AddChannelPopover.tsx`

Build the popover content with the four-row picker but no form views or submit logic yet. The component is rendered (and made visible) by Task 4; this task just lands the file so it can be imported.

- [ ] **Step 1: Read the mockup popover for visual reference**

Run:
```bash
sed -n '1218,1260p' "project/MeshCore Desktop.html"
```

Familiarize yourself with the row layout — square glyph tile on the left, two-line label (title + subtitle) on the right.

- [ ] **Step 2: Read the Radix Popover wrapper to know what to import**

Run:
```bash
cat src/renderer/components/ui/popover.tsx
```

You will import `Popover`, `PopoverContent`, and `PopoverTrigger`. The wrapper is `radix-ui`'s Popover under the hood and supports controlled `open` / `onOpenChange`.

- [ ] **Step 3: Create `AddChannelPopover.tsx` with the picker view**

Create `src/renderer/components/AddChannelPopover.tsx`:

```tsx
import { Hash, Key, Plus, Users } from 'lucide-react';
import { useState } from 'react';
import { useStore } from '../lib/store';

type ViewState =
  | { kind: 'pick' }
  | { kind: 'form'; type: 'create-private' | 'join-private' | 'join-hashtag' };

interface RowProps {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  disabled?: boolean;
  disabledHint?: string;
  onClick: () => void;
}

function PickerRow({ icon, title, subtitle, disabled, disabledHint, onClick }: RowProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={disabled ? disabledHint : undefined}
      className="flex w-full items-center gap-3 rounded px-2.5 py-2 text-left transition-colors hover:bg-cs-bg-3 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent"
    >
      <span className="flex size-6 shrink-0 items-center justify-center rounded border border-cs-border bg-cs-bg-3 text-cs-text">
        {icon}
      </span>
      <span className="flex min-w-0 flex-1 flex-col leading-tight">
        <span className="truncate text-xs font-medium text-cs-text">{title}</span>
        <span className="truncate text-[10.5px] text-cs-text-dim">{subtitle}</span>
      </span>
    </button>
  );
}

interface Props {
  // No props yet — state lives entirely inside the component for now.
  // Task 3 will add the LostConnection branch and submit handlers.
  _placeholder?: never;
}

export function AddChannelPopover(_: Props) {
  const channels = useStore((s) => s.channels);
  const [view, setView] = useState<ViewState>({ kind: 'pick' });

  const publicExists = channels.some((c) => c.key === 'ch:Public');

  if (view.kind === 'pick') {
    return (
      <div className="flex flex-col gap-0.5">
        <div className="px-2.5 py-1.5 font-mono text-[9px] uppercase tracking-wider text-cs-text-dim">
          Add channel
        </div>
        <PickerRow
          icon={<Plus className="size-3" />}
          title="Create private channel"
          subtitle="Generate a new shared key"
          onClick={() => setView({ kind: 'form', type: 'create-private' })}
        />
        <PickerRow
          icon={<Key className="size-3" />}
          title="Join private channel"
          subtitle="Paste a shared key"
          onClick={() => setView({ kind: 'form', type: 'join-private' })}
        />
        <PickerRow
          icon={<Users className="size-3" />}
          title="Join public channel"
          subtitle={publicExists ? 'Already added' : 'Anyone in range'}
          disabled={publicExists}
          disabledHint="The Public channel is already in your channel list"
          onClick={() => {
            // Task 3 will implement the one-tap submit here.
          }}
        />
        <PickerRow
          icon={<Hash className="size-3" />}
          title="Join hashtag channel"
          subtitle="Open, name-keyed"
          onClick={() => setView({ kind: 'form', type: 'join-hashtag' })}
        />
      </div>
    );
  }

  // Task 3 replaces this with real forms.
  return (
    <div className="flex flex-col gap-2 p-2 text-xs text-cs-text-muted">
      <span>Form for {view.type} — implemented in Task 3.</span>
      <button
        type="button"
        onClick={() => setView({ kind: 'pick' })}
        className="self-start text-cs-text-dim hover:text-cs-text"
      >
        ← Back
      </button>
    </div>
  );
}
```

- [ ] **Step 4: Typecheck**

Run:
```bash
pnpm typecheck
```

Expected: exits 0. The file should compile in isolation; nothing imports it yet.

- [ ] **Step 5: Lint**

Run:
```bash
pnpm lint
```

Expected: exits 0. If Biome flags the unused `Props` shape or the `_: Props` parameter, change the signature to `export function AddChannelPopover()` and remove the interface — both forms are acceptable.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/components/AddChannelPopover.tsx
git commit -m "feat(channels): scaffold AddChannelPopover with picker view"
```

---

## Task 3: Submit logic + form views

**Files:**
- Modify: `src/renderer/components/AddChannelPopover.tsx`

Replace the placeholder form branch with real per-type forms and wire the full submit pipeline (PUT → push → rollback-on-failure, success toast, error display). Also add the transport-drop guard.

- [ ] **Step 1: Read the API client wrappers you will call**

Run:
```bash
grep -n "putChannel\|pushChannelToDevice\|deleteChannel" src/renderer/lib/api.ts
```

Read the surrounding code so you know each function's signature. You will call:
- `api.putChannel(client, channel)` — upserts; returns `{ ok: true }`.
- `api.pushChannelToDevice(client, key)` — returns `{ ok: true; idx: number }` per `routes.ts:399`; surfaces 409/503 errors as thrown `Error`s.
- `api.deleteChannel(client, key)` — used for rollback.

- [ ] **Step 2: Read the `notify` toast surface**

Run:
```bash
grep -n "export\|notify\." src/renderer/lib/notify.ts | head -20
```

You will use `notify.success(message)` on completion. Failures stay inline in the popover per spec, so do not toast errors — only inline.

- [ ] **Step 3: Read the `Channel` type and confirm key shape**

Run:
```bash
grep -n "interface Channel" src/shared/types.ts
sed -n '60,75p' src/shared/types.ts
```

Confirm: `key` is `'ch:<name>'`. You will build `key = \`ch:${name}\`` (no encoding — the route does its own `decodeURIComponent` and the `name` is what gets persisted as-is).

- [ ] **Step 4: Replace the file with the full implementation**

Overwrite `src/renderer/components/AddChannelPopover.tsx` with this complete version:

```tsx
import { Hash, Key, Plus, Users } from 'lucide-react';
import { useEffect, useState } from 'react';
import { type ApiClient, api } from '../lib/api';
import { notify } from '../lib/notify';
import { generate16ByteHex } from '../lib/randomSecret';
import { useStore } from '../lib/store';
import type { Channel, ChannelKind } from '../../shared/types';

type FormType = 'create-private' | 'join-private' | 'join-hashtag';

type ViewState =
  | { kind: 'pick' }
  | { kind: 'form'; type: FormType; name: string; secretHex: string; error: string | null; submitting: boolean };

interface RowProps {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  disabled?: boolean;
  disabledHint?: string;
  onClick: () => void;
}

function PickerRow({ icon, title, subtitle, disabled, disabledHint, onClick }: RowProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={disabled ? disabledHint : undefined}
      className="flex w-full items-center gap-3 rounded px-2.5 py-2 text-left transition-colors hover:bg-cs-bg-3 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent"
    >
      <span className="flex size-6 shrink-0 items-center justify-center rounded border border-cs-border bg-cs-bg-3 text-cs-text">
        {icon}
      </span>
      <span className="flex min-w-0 flex-1 flex-col leading-tight">
        <span className="truncate text-xs font-medium text-cs-text">{title}</span>
        <span className="truncate text-[10.5px] text-cs-text-dim">{subtitle}</span>
      </span>
    </button>
  );
}

interface Props {
  client: ApiClient | null;
  onClose: () => void;
}

const initialForm = (type: FormType): Extract<ViewState, { kind: 'form' }> => ({
  kind: 'form',
  type,
  name: '',
  secretHex: '',
  error: null,
  submitting: false,
});

// Strip whitespace and an optional 0x prefix, lowercase. Returns the
// normalized hex string (not validated for length — caller checks that).
function normalizeHex(input: string): string {
  return input.replace(/\s+/g, '').replace(/^0x/i, '').toLowerCase();
}

const HEX_32 = /^[0-9a-f]{32}$/;

function validateName(name: string, channels: Channel[]): string | null {
  const trimmed = name.trim();
  if (trimmed.length === 0) return 'Name is required';
  if (trimmed.length > 32) return 'Name must be 32 characters or fewer';
  const key = `ch:${trimmed}`;
  if (channels.some((c) => c.key === key)) {
    return `A channel named "${trimmed}" already exists`;
  }
  return null;
}

export function AddChannelPopover({ client, onClose }: Props) {
  const channels = useStore((s) => s.channels);
  const transport = useStore((s) => s.transportState);
  const setActiveKey = useStore((s) => s.setActiveKey);
  const [view, setView] = useState<ViewState>({ kind: 'pick' });

  // Reset to picker whenever the popover is reopened. The parent unmounts the
  // component on close (PopoverContent only renders while open), so this is a
  // mount-time reset.
  useEffect(() => {
    setView({ kind: 'pick' });
  }, []);

  // Transport-drop guard: if we lose connection at any time, swap to the
  // disconnect message regardless of which view we were in.
  if (transport !== 'connected') {
    return (
      <div className="flex flex-col gap-2 p-3 text-xs text-cs-text-muted">
        <span className="font-medium text-cs-text">Lost connection</span>
        <span>Reconnect a radio and try again.</span>
        <button
          type="button"
          onClick={onClose}
          className="self-start rounded border border-cs-border bg-cs-bg-3 px-2 py-1 text-cs-text hover:bg-cs-bg-2"
        >
          Close
        </button>
      </div>
    );
  }

  const publicExists = channels.some((c) => c.key === 'ch:Public');

  // Shared submit. Builds the channel body, calls PUT then push, rolls back on
  // push failure, fires a toast + selects the new channel on success.
  async function submit(channel: Channel, displayName: string) {
    if (!client) return;
    try {
      await api.putChannel(client, channel);
    } catch (err) {
      throw new Error(`Couldn't save channel: ${(err as Error).message}`);
    }
    try {
      const res = await api.pushChannelToDevice(client, channel.key);
      notify.success(`Added "${displayName}" to channel slot ${res.idx}`);
      setActiveKey(channel.key);
      onClose();
    } catch (pushErr) {
      // Roll back the PUT so app state and device state stay in sync.
      try {
        await api.deleteChannel(client, channel.key);
      } catch {
        // If rollback itself fails, surface the original push error — the
        // next radio enumeration will reconcile.
      }
      throw new Error(`Couldn't push to device: ${(pushErr as Error).message}`);
    }
  }

  if (view.kind === 'pick') {
    return (
      <div className="flex flex-col gap-0.5">
        <div className="px-2.5 py-1.5 font-mono text-[9px] uppercase tracking-wider text-cs-text-dim">
          Add channel
        </div>
        <PickerRow
          icon={<Plus className="size-3" />}
          title="Create private channel"
          subtitle="Generate a new shared key"
          onClick={() => setView(initialForm('create-private'))}
        />
        <PickerRow
          icon={<Key className="size-3" />}
          title="Join private channel"
          subtitle="Paste a shared key"
          onClick={() => setView(initialForm('join-private'))}
        />
        <PickerRow
          icon={<Users className="size-3" />}
          title="Join public channel"
          subtitle={publicExists ? 'Already added' : 'Anyone in range'}
          disabled={publicExists}
          disabledHint="The Public channel is already in your channel list"
          onClick={async () => {
            // One-tap: build and submit immediately. We synthesize a minimal
            // form state to surface any error before bailing back to picker.
            const next: Extract<ViewState, { kind: 'form' }> = {
              ...initialForm('join-hashtag'), // form type used purely so a thrown error has somewhere to live
              name: 'Public',
              submitting: true,
            };
            setView(next);
            try {
              const channel: Channel = { key: 'ch:Public', name: 'Public', kind: 'public' };
              await submit(channel, 'Public');
            } catch (err) {
              setView({ ...next, submitting: false, error: (err as Error).message });
            }
          }}
        />
        <PickerRow
          icon={<Hash className="size-3" />}
          title="Join hashtag channel"
          subtitle="Open, name-keyed"
          onClick={() => setView(initialForm('join-hashtag'))}
        />
      </div>
    );
  }

  // ----- Form views ---------------------------------------------------------

  const showSecretField = view.type === 'join-private';
  const title =
    view.type === 'create-private'
      ? 'Create private channel'
      : view.type === 'join-private'
        ? 'Join private channel'
        : 'Join hashtag channel';

  const nameError = view.name === '' ? null : validateName(view.name, channels);
  const trimmedName = view.name.trim();
  const normalizedSecret = normalizeHex(view.secretHex);
  const secretError =
    showSecretField && view.secretHex !== '' && !HEX_32.test(normalizedSecret)
      ? 'Shared key must be 32 hex characters (16 bytes)'
      : null;

  const canSubmit =
    !view.submitting &&
    trimmedName.length > 0 &&
    nameError === null &&
    (!showSecretField || (HEX_32.test(normalizedSecret)));

  async function onAdd() {
    if (!canSubmit) return;
    setView((v) => (v.kind === 'form' ? { ...v, submitting: true, error: null } : v));

    let channel: Channel;
    const name = trimmedName;
    const key = `ch:${name}`;
    if (view.type === 'create-private') {
      channel = { key, name, kind: 'private' as ChannelKind, secretHex: generate16ByteHex() };
    } else if (view.type === 'join-private') {
      channel = { key, name, kind: 'private' as ChannelKind, secretHex: normalizedSecret };
    } else {
      // join-hashtag — leave secretHex undefined, server derives.
      channel = { key, name, kind: 'hashtag' as ChannelKind };
    }

    try {
      await submit(channel, name);
    } catch (err) {
      setView((v) =>
        v.kind === 'form' ? { ...v, submitting: false, error: (err as Error).message } : v,
      );
    }
  }

  return (
    <form
      className="flex flex-col gap-3 p-3"
      onSubmit={(e) => {
        e.preventDefault();
        void onAdd();
      }}
    >
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-cs-text">{title}</span>
        <button
          type="button"
          onClick={() => setView({ kind: 'pick' })}
          className="text-[10px] uppercase tracking-wider text-cs-text-dim hover:text-cs-text"
          disabled={view.submitting}
        >
          Back
        </button>
      </div>

      <label className="flex flex-col gap-1">
        <span className="text-[10px] uppercase tracking-wider text-cs-text-dim">Name</span>
        <input
          autoFocus
          type="text"
          value={view.name}
          onChange={(e) =>
            setView((v) => (v.kind === 'form' ? { ...v, name: e.target.value, error: null } : v))
          }
          maxLength={48}
          placeholder="my-channel"
          className="h-7 rounded-md border border-cs-border bg-cs-bg-3 px-2 text-xs text-cs-text outline-none focus:border-cs-accent"
        />
        {nameError && <span className="text-[10px] text-cs-danger">{nameError}</span>}
      </label>

      {showSecretField && (
        <label className="flex flex-col gap-1">
          <span className="text-[10px] uppercase tracking-wider text-cs-text-dim">
            Shared key (32 hex chars)
          </span>
          <input
            type="text"
            value={view.secretHex}
            onChange={(e) =>
              setView((v) =>
                v.kind === 'form' ? { ...v, secretHex: e.target.value, error: null } : v,
              )
            }
            placeholder="0123456789abcdef0123456789abcdef"
            spellCheck={false}
            className="h-7 rounded-md border border-cs-border bg-cs-bg-3 px-2 font-mono text-[11px] text-cs-text outline-none focus:border-cs-accent"
          />
          {secretError && <span className="text-[10px] text-cs-danger">{secretError}</span>}
        </label>
      )}

      {view.error && (
        <div className="rounded border border-cs-danger/40 bg-cs-danger/10 px-2 py-1.5 text-[11px] text-cs-danger">
          {view.error}
        </div>
      )}

      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          disabled={view.submitting}
          className="rounded border border-cs-border bg-cs-bg-3 px-3 py-1 text-xs text-cs-text-muted hover:bg-cs-bg-2 hover:text-cs-text disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={!canSubmit}
          className="rounded bg-cs-accent px-3 py-1 text-xs font-medium text-cs-bg disabled:cursor-not-allowed disabled:opacity-50"
        >
          {view.submitting ? 'Adding…' : 'Add'}
        </button>
      </div>
    </form>
  );
}
```

- [ ] **Step 5: Typecheck**

Run:
```bash
pnpm typecheck
```

Expected: exits 0. The most likely failure mode is a missing import or a mismatched `Channel` field — the type allows `kind: ChannelKind`, optional `secretHex`, optional `idx`, optional `order`, optional `muted`, optional `pinned`. Builder above omits the optional fields, which is valid.

- [ ] **Step 6: Lint**

Run:
```bash
pnpm lint
```

Expected: exits 0.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/components/AddChannelPopover.tsx
git commit -m "feat(channels): implement AddChannelPopover submit logic and forms"
```

---

## Task 4: LeftNav integration

**Files:**
- Modify: `src/renderer/shell/LeftNav.tsx`

Add the `+` trigger button next to the Channels parent-branch label, the right-click "Add channel…" context menu on the same row, and wire both to the store flag plus a Radix `Popover` wrapping the Channels branch as its anchor.

- [ ] **Step 1: Read the relevant region of `LeftNav.tsx`**

Run:
```bash
sed -n '416,460p' src/renderer/shell/LeftNav.tsx
```

This is the `<ParentBranch label="Channels" …>` invocation. You will wrap it in a `<Popover>` and feed the trigger via a sibling element.

- [ ] **Step 2: Read how Radix Popover is used elsewhere in the project**

Run:
```bash
sed -n '50,70p' src/renderer/components/MeshcoreLink.tsx
```

This shows the `Popover` + `PopoverTrigger asChild` + `PopoverContent` pattern. You will follow this pattern but pass `open` and `onOpenChange` for controlled state.

- [ ] **Step 3: Extend `ParentBranch` to accept a trailing action slot**

In `src/renderer/shell/LeftNav.tsx`, locate the `ParentBranch` function definition (around line 561). Change its prop interface and JSX to add an optional trailing action slot. Replace the existing definition with this version (the structural change is the new `trailingAction` prop and the new wrapper `div` that swaps the chevron-only trailing region for `trailingAction` + chevron when provided):

```tsx
function ParentBranch({
  label,
  icon: Icon,
  open,
  onToggle,
  unreadTotal,
  trailingAction,
  onContextMenu,
  children,
}: {
  label: string;
  icon: LucideIcon;
  open: boolean;
  onToggle: () => void;
  unreadTotal: number;
  /** Optional control rendered before the chevron — e.g. an "add" button. */
  trailingAction?: ReactNode;
  onContextMenu?: (e: MouseEvent) => void;
  children: ReactNode;
}) {
  const { state, setOpen } = useSidebar();
  const handleClick = () => {
    if (state === 'collapsed') {
      setOpen(true);
      if (!open) onToggle();
      return;
    }
    onToggle();
  };
  return (
    <Collapsible.Root open={open} className="group/collapsible" asChild>
      <SidebarMenuItem>
        <SidebarMenuButton tooltip={label} onClick={handleClick} onContextMenu={onContextMenu}>
          <Icon />
          <span>{label}</span>
          {unreadTotal > 0 && (
            <span
              role="status"
              aria-label={`${unreadTotal} unread`}
              className="ml-auto rounded-full bg-cs-accent px-1.5 py-px font-mono text-[10px] leading-none text-cs-bg tabular-nums"
            >
              {unreadTotal > 99 ? '99+' : unreadTotal}
            </span>
          )}
          {trailingAction ? (
            <span className={cn('flex items-center gap-1', unreadTotal > 0 ? '' : 'ml-auto')}>
              {trailingAction}
              <ChevronRight className="transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90" />
            </span>
          ) : (
            <ChevronRight
              className={cn(
                'transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90',
                unreadTotal > 0 ? '' : 'ml-auto',
              )}
            />
          )}
        </SidebarMenuButton>
        <Collapsible.Content>{children}</Collapsible.Content>
      </SidebarMenuItem>
    </Collapsible.Root>
  );
}
```

- [ ] **Step 4: Add the imports needed by the new code**

At the top of `src/renderer/shell/LeftNav.tsx`, add to the existing imports:

```tsx
import { Popover, PopoverContent, PopoverTrigger } from '../components/ui/popover';
import { AddChannelPopover } from '../components/AddChannelPopover';
import type { ApiClient } from '../lib/api';
```

(The `ApiClient` import may already be present — check first.) The `Plus` icon is already in the lucide import block.

- [ ] **Step 5: Subscribe to the store flag inside `LeftNav`**

Inside the `LeftNav` function body, near the other `useStore` selectors (around line 150–175), add:

```tsx
  const addChannelOpen = useStore((s) => s.ui.addChannelOpen ?? false);
  const setAddChannelOpen = useStore((s) => s.setAddChannelOpen);
  const connected = transport === 'connected';
```

(Note: `transport` is already selected via `const transport = useStore((s) => s.transportState);` on line 156.)

- [ ] **Step 6: Track the right-click context-menu anchor for the Channels row**

Near the existing `const [menu, setMenu] = useState<ChannelMenuState | null>(null);` and the analogous contact menu state (around line 255), add:

```tsx
  const [channelsRowMenu, setChannelsRowMenu] = useState<{ x: number; y: number } | null>(null);
```

- [ ] **Step 7: Replace the Channels `ParentBranch` invocation with the Popover-wrapped version**

Find this block in `LeftNav.tsx` (around line 419–455):

```tsx
            <ParentBranch
              label="Channels"
              icon={Hash}
              open={openChannels}
              onToggle={() => setLeftNavGroup('channels', !openChannels)}
              unreadTotal={channelUnreadTotal}
            >
              {sortedChannels.length === 0 ? (
                ...
              ) : (
                ...
              )}
            </ParentBranch>
```

Replace it with:

```tsx
            <Popover open={addChannelOpen} onOpenChange={setAddChannelOpen}>
              <ParentBranch
                label="Channels"
                icon={Hash}
                open={openChannels}
                onToggle={() => setLeftNavGroup('channels', !openChannels)}
                unreadTotal={channelUnreadTotal}
                onContextMenu={(e) => {
                  if (!connected) return;
                  e.preventDefault();
                  setChannelsRowMenu({ x: e.clientX, y: e.clientY });
                }}
                trailingAction={
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      aria-label="Add channel"
                      title={connected ? 'Add channel' : 'Connect a radio to add channels'}
                      disabled={!connected}
                      onClick={(e) => {
                        // Don't let the click also toggle the Channels collapsible.
                        e.stopPropagation();
                      }}
                      className="flex size-5 items-center justify-center rounded text-cs-text-dim hover:bg-cs-bg-3 hover:text-cs-text disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
                    >
                      <Plus className="size-3" />
                    </button>
                  </PopoverTrigger>
                }
              >
                {sortedChannels.length === 0 ? (
                  <EmptySubHint>
                    {transport === 'connected'
                      ? 'No channels on this radio.'
                      : 'Connect a radio to sync channels.'}
                  </EmptySubHint>
                ) : (
                  <ChannelSubList
                    channels={sortedChannels}
                    activeKey={activeKey}
                    pinSet={pinSet}
                    presence={channelPresence}
                    unreadByKey={unreadByKey}
                    limit={collapseListsEnabled ? collapseListsLimit : null}
                    revealed={!!revealed.channels}
                    onShowMore={() => revealList('channels')}
                    onSelect={setActiveKey}
                    onReorder={onReorder}
                    onContext={(channel, e) => {
                      e.preventDefault();
                      setMenu({
                        channel,
                        onDevice: channelPresence.has(channel.key),
                        x: e.clientX,
                        y: e.clientY,
                      });
                    }}
                  />
                )}
              </ParentBranch>
              <PopoverContent
                align="start"
                sideOffset={6}
                className="w-72 p-0"
                onOpenAutoFocus={(e) => {
                  // Let the form's autoFocus input win instead of Radix's default
                  // focus-to-content behavior. Without this the popover steals focus
                  // before the input mounts.
                  if (addChannelOpen) e.preventDefault();
                }}
              >
                <AddChannelPopover client={client} onClose={() => setAddChannelOpen(false)} />
              </PopoverContent>
            </Popover>
```

- [ ] **Step 8: Render the right-click context menu**

Near the bottom of the `LeftNav` return (just before the closing `</Sidebar>` and alongside the existing `{menu && ...}` / `{contactMenu && ...}` blocks, around line 536), add:

```tsx
      {channelsRowMenu && (
        <ContextMenu
          x={channelsRowMenu.x}
          y={channelsRowMenu.y}
          items={[
            menuItem(
              'Add channel…',
              () => {
                setAddChannelOpen(true);
              },
              { icon: Plus, disabled: !connected },
            ),
          ]}
          onClose={() => setChannelsRowMenu(null)}
        />
      )}
```

- [ ] **Step 9: Typecheck**

Run:
```bash
pnpm typecheck
```

Expected: exits 0. Common failure: `ParentBranch` is referenced inside the contacts top-level branch too (around line 459), but those instances don't pass `trailingAction` or `onContextMenu`, so the new optional props don't break them.

- [ ] **Step 10: Lint**

Run:
```bash
pnpm lint
```

Expected: exits 0.

- [ ] **Step 11: Manual smoke test**

Run:
```bash
pnpm start
```

In the app, connect to a radio (or use the existing dev radio if you have one). Verify:
1. A `+` icon appears at the right edge of the "Channels" row.
2. Click `+` — popover opens with four rows. The Public row says "Already added" if `ch:Public` exists.
3. Right-click on the "Channels" row — context menu shows "Add channel…". Click it — popover opens.
4. Disconnect the radio. The `+` button is now disabled (greyed) and shows the tooltip on hover. Right-click does nothing (or surfaces a disabled item).

Close the app when done. (Verifying actual channel creation belongs to Task 6's full smoke pass — this step only confirms the triggers wire up.)

- [ ] **Step 12: Commit**

```bash
git add src/renderer/shell/LeftNav.tsx
git commit -m "feat(channels): wire AddChannelPopover into LeftNav with + button and right-click"
```

---

## Task 5: Command Palette entry

**Files:**
- Modify: `src/renderer/features/CommandPalette.tsx`

Add an "Add channel…" command that opens the popover by flipping the same store flag.

- [ ] **Step 1: Locate the actions section in `CommandPalette.tsx`**

Run:
```bash
sed -n '155,200p' src/renderer/features/CommandPalette.tsx
```

This shows where action items are appended. The "Add channel…" entry slots in alongside the advert entries.

- [ ] **Step 2: Add the store hook and the command item**

In `src/renderer/features/CommandPalette.tsx`, near the other `useStore` selectors at the top of the `CommandPalette` function (around line 75–96), add:

```tsx
  const setAddChannelOpen = useStore((s) => s.setAddChannelOpen);
```

Then in the `items` `useMemo` body, find the existing zero-hop advert block (around line 172–188) and add this new entry directly after it:

```tsx
    list.push({
      id: 'action:addChannel',
      label: 'Add channel…',
      hint: transportState === 'connected' ? 'Create or join' : 'Connect a radio first',
      group: 'action',
      groupLabel: 'Actions',
      icon: Hash,
      keywords: 'add new create join channel hashtag private public',
      run: () => {
        if (transportState !== 'connected') return;
        setAddChannelOpen(true);
        close();
      },
    });
```

`Hash` is already imported at the top of the file. Make sure to extend the deps of the `useMemo` (line ~226 — search for `}, [` after the items array) to include `setAddChannelOpen` if a deps-array exhaustiveness check fires; the existing list already includes `transportState` and `close`.

- [ ] **Step 3: Typecheck**

Run:
```bash
pnpm typecheck
```

Expected: exits 0.

- [ ] **Step 4: Lint**

Run:
```bash
pnpm lint
```

Expected: exits 0. If Biome flags the missing dep in `useMemo`, add `setAddChannelOpen` to the dependency array.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/features/CommandPalette.tsx
git commit -m "feat(channels): add Command Palette entry for adding channels"
```

---

## Task 6: End-to-end manual verification

**Files:** None modified — verification only.

Walk through every flow in the spec's "Testing notes" section to confirm the implementation matches the design before declaring done.

- [ ] **Step 1: Start the app against a real (or simulated) radio**

Run:
```bash
pnpm start
```

Wait for the radio to connect and channels to enumerate. Confirm the `+` button is enabled.

- [ ] **Step 2: Verify Create private**

1. Click `+` → "Create private channel".
2. Enter a name that does not already exist (e.g. `test-create-1`).
3. Click Add.
4. Expected: success toast like `Added "test-create-1" to channel slot N`; the channel is selected in the LeftNav; opening the right-rail Channel info shows a `secretHex` of 32 hex chars and a slot index.

- [ ] **Step 3: Verify Join public**

1. If `ch:Public` already exists, remove it via the existing channel right-click menu's "Delete from app" so the public row becomes enabled again.
2. Click `+` → "Join public channel" (one-tap).
3. Expected: toast announces a slot, `ch:Public` appears in the LeftNav.
4. Reopen the `+` popover and confirm the Public row now reads "Already added" and is disabled.

- [ ] **Step 4: Verify Join private**

1. Generate or copy a 16-byte hex string (32 chars). For example: `0123456789abcdef0123456789abcdef`.
2. Click `+` → "Join private channel".
3. Enter a unique name and paste the hex key.
4. Test the normalizer: paste `0x0123 4567 89ab cdef 0123 4567 89ab cdef` (with `0x` and whitespace). The submit button should stay enabled.
5. Click Add.
6. Expected: toast + channel selected. Right-rail shows the exact `secretHex` you supplied (after normalization).

- [ ] **Step 5: Verify Join hashtag**

1. Click `+` → "Join hashtag channel".
2. Enter a name (e.g. `test-hashtag`).
3. Click Add.
4. Expected: toast + channel selected. Right-rail shows a derived `secretHex` (different from random — it is `sha256("test-hashtag")[:16]`, which is deterministic).

- [ ] **Step 6: Verify duplicate-name rejection**

1. Click `+` → "Create private channel".
2. Enter the name of an existing channel (e.g. `test-create-1`).
3. Expected: inline `A channel named "test-create-1" already exists` appears under the name field, and the Add button is disabled.

- [ ] **Step 7: Verify bad-hex rejection**

1. Click `+` → "Join private channel".
2. Enter a unique name; paste a key of the wrong length (e.g. 30 chars).
3. Expected: inline `Shared key must be 32 hex characters (16 bytes)`; Add disabled.

- [ ] **Step 8: Verify the connection-required guard**

1. Disconnect the radio (or unplug BLE).
2. Try the `+` button — disabled, tooltip says "Connect a radio to add channels".
3. Open the Command Palette (Cmd+K) → "Add channel…" — hint says "Connect a radio first"; activating does nothing.
4. Right-click the "Channels" row — the context menu (if it opens at all per Task 4 Step 7) shows the "Add channel…" item disabled.
5. Open the popover via any path, then disconnect mid-flow. Popover body swaps to "Lost connection."

- [ ] **Step 9: Verify the rollback path**

This is harder to trigger reliably. The cheapest path: fill all 16 channel slots by repeatedly creating channels (the firmware allows up to 16). On the 17th, the push should fail with 409. Expected: inline error in the popover, and `GET /api/channels` shows the orphan was deleted (no extra row).

If you cannot easily fill all 16 slots, skip this step but note the manual check in the PR description and rely on the typecheck + the code path being straightforward.

- [ ] **Step 10: Verify Command Palette entry**

1. Cmd+K → type "add channel" → activate.
2. Expected: palette closes, popover opens anchored to the LeftNav `+`. Pick view shows the four rows.

- [ ] **Step 11: Final typecheck + lint**

Run:
```bash
pnpm typecheck && pnpm lint
```

Expected: both exit 0.

- [ ] **Step 12: Stop the dev app and report verification results**

Quit `pnpm start` (Ctrl+C). Summarize which manual steps passed in the PR description; flag any that you couldn't run (e.g. the 16-slot test).

There is no final commit — all preceding tasks already produced commits. The branch is ready to push.

---

## Self-review notes

Re-checked against the spec:

- **Goals**: all four add-types implemented (Task 3); connection-gating in three places (Task 4 button, Task 4 context menu, Task 5 palette); no new endpoints; rollback on push failure (Task 3 `submit`).
- **Non-goals**: QR / `meshcore://` import / edit-existing / no-radio adds — explicitly absent from all tasks. No code added for them.
- **Form fields table**: Create private generates 16 random bytes (`generate16ByteHex`, Task 1); Join private uses normalized user input; Join public submits `{ key:'ch:Public', name:'Public', kind:'public' }`; Join hashtag omits `secretHex`. Matches spec exactly.
- **Validation**: name 1–32 + uniqueness in `validateName`; hex 32-char check via `HEX_32`; whitespace + `0x` prefix stripped via `normalizeHex`. Matches spec.
- **Backend wiring**: only `api.putChannel`, `api.pushChannelToDevice`, `api.deleteChannel`. No new endpoints. Matches spec.
- **Atomicity & rollback**: `submit` rolls back via DELETE inside the push catch. Matches spec.
- **Error handling table**: every row in the spec table has a path (validation = inline disable; PUT fail = inline "Couldn't save channel"; push 409/503 = inline + rollback; transport drop = component-level guard). Matches spec.
- **Open question** ("how is the popover controlled from three triggers"): resolved by using a store flag `ui.addChannelOpen` plus a controlled Radix `Popover`.

No placeholders, no TBDs. Types are consistent between Task 1 (UiState extension), Task 3 (`AddChannelPopover` props), and Task 4 (call site).
