# Contact Management — Phase 3: Rich Right-Pane Detail Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build one reusable, status/kind-adaptive rich contact-detail panel that appears in the right rail whenever a contact is focused anywhere — Manager row, sidebar DM/repeater view, or @mention — mirroring the official MeshCore app's contact page, with the contact's path ("Heard Via") embedded and deep-links into the existing RepeaterAdmin tabs.

**Architecture:** A single presentational component `ContactDetail` keyed by a bare `publicKeyHex`. It resolves a unified view by merging the discovered-pool row (superset: first-heard, last-advert, GPS, hops, favourite, blocked, on-radio) with the matching on-radio `Contact` (link metrics + path), via a new pure `resolveContact` helper. The component is mounted in three rail slots: the Contact Manager rail (when a row is focused and nothing is bulk-selected), the `dm`/`repeater` contact-card section, and the @mention section. RepeaterAdmin gains a renderer-only "pending tab" store field so the detail's Telemetry/Permissions/Remote-Mgmt buttons can deep-link to a specific tab. No new backend — this phase is renderer-only and builds entirely on Phase 1's API surface.

**Tech Stack:** React + Zustand + Tailwind v4 (Field Console `--cs-*` tokens) + lucide-react. Verification is `pnpm typecheck && pnpm lint` plus user-driven device testing — **the repo has no test runner on this branch; do NOT add one** (unit tests are deferred to the separate test-infra branch, consistent with Phases 1 & 2).

---

## Scope & Non-Goals

**In scope (v1):**
- `resolveContact` + distance helpers (pure, exportable).
- RepeaterAdmin tab deep-link plumbing (store field + consumption + shared `RepeaterAdminTab` type).
- `ContactDetail` component: header, info `KeyValueRow`s, status/kind-adaptive action row, embedded path subsection.
- Wiring `ContactDetail` into the Manager rail, the `dm`/`repeater` rail, and the @mention rail; retiring `ContactCardSection`.

**Out of scope (tracked follow-ups, do NOT build here):**
- **Share / Export** (`EXPORT_CONTACT` 0x11) — no backend route exists; render as a `notify.info('Share — coming soon')` stub, matching the existing Import/Export rail stubs.
- **Per-contact "Remove from discovered"** — no individual delete route exists (only bulk `clearDiscovered`). Discovered-only contacts get **no** Remove action in v1 (consistent with the existing "no per-contact unblock" decision). On-radio contacts get Remove via `removeFromRadio`.
- **Inline name edit** (pencil → `ADD_UPDATE_CONTACT` name) — render the name read-only in v1; note as a follow-up.
- **Multi-path "Heard Via" hop chain** — a contact carries a single `outPathHex`, not per-message observations. The path subsection reuses the existing `SetPathEditor` (on-radio) / a read-only flood/hops summary (discovered-only). The message-level `HeardViaSection` (per-message paths) is unchanged.
- **Ping / zero-hop trace** (`SEND_TRACE_PATH` 24) — omitted.

---

## File Structure

**New files:**
- `src/renderer/lib/contactDetail.ts` — `ResolvedContact` type, `resolveContact()`, `distanceKm()`, `fmtDistance()`. Pure, no React.
- `src/renderer/shell/rightrail/sections/ContactDetail.tsx` — the reusable rich detail component (header + info fields + action row + path subsection).

**Modified files:**
- `src/renderer/lib/store.ts` — add `RepeaterAdminTab` type, `repeaterAdminTab` field + `setRepeaterAdminTab` action.
- `src/renderer/panels/repeater-admin/index.tsx` — `TabId` aliases `RepeaterAdminTab`; consume + clear the pending tab.
- `src/renderer/shell/rightrail/sections/ContactCard.tsx` — delete `ContactCardSection`; keep `CardActionButton` (reused by `ContactDetail`).
- `src/renderer/shell/rightrail/sectionsFor.tsx` — `dm`/`repeater` `rail.contact.card` body → `ContactDetail`.
- `src/renderer/shell/rightrail/sections/ContactManagerRail.tsx` — `ContactManagerRailBody` shows `ContactDetail` when a row is focused and nothing is selected.
- `src/renderer/shell/rightrail/sections/MentionedContact.tsx` — wrap `ContactDetail` instead of `ContactCardSection`.

---

## Reference: established patterns to reuse (do not reinvent)

- **Theme tokens:** `text-cs-text` / `text-cs-text-muted` / `text-cs-text-dim`, `bg-cs-bg-2` / `bg-cs-bg-3`, `border-cs-border`, `text-cs-accent`, `text-cs-online`, `text-cs-warn`, `text-cs-danger`. RGB-triple tokens defined in `src/renderer/index.css`.
- **`KeyValueRow`** — `src/renderer/components/ui/KeyValueRow.tsx`: `<KeyValueRow label value mono? title? />`. Also exports `KeyValueGroup` (titled section wrapper).
- **`TypeGlyph`, `StatusPill`** — exported from `src/renderer/panels/contacts/ContactRows.tsx`. `StatusPill` takes `{ c: DiscoveredContact }`.
- **`CardActionButton`** — exported from `src/renderer/shell/rightrail/sections/ContactCard.tsx`: `<CardActionButton icon={LucideIcon} label onClick />`.
- **`copyToClipboard`** — `src/renderer/components/ContextMenu.tsx`: `copyToClipboard(text, onDone?)`.
- **`notify`** — `src/renderer/lib/notify.ts`: `notify.success/error/info`.
- **Map fly-to** — `import { publish as publishMapBus } from '../../../lib/map/bus'`; `setActiveKey('tool:map'); publishMapBus({ kind: 'flyTo', lng, lat, zoom: 12 })`.
- **Time** — `src/renderer/lib/time.ts`: `fmtRelative(ts)`, `fmtDateTime(ts, timeFormat)`; `timeFormat` from `useStore((s) => s.appSettings.timeFormat)`.
- **API** — `src/renderer/lib/api.ts` `api.*`: `addToRadio(c,key)`, `removeFromRadio(c,key)`, `setFavourite(c,key,bool)` — all take the **bare `publicKeyHex`** as `key`.
- **Block dialog** — `BlockSenderDialog` from `src/renderer/components/BlockSenderDialog.tsx`: `<BlockSenderDialog client open prefill={{ pubkey, name }} onClose />`.
- **Path editor** — `SetPathEditor` from `src/renderer/components/path/SetPathEditor.tsx`: `<SetPathEditor contact={Contact} client />` (already handles edit + reset-to-flood).
- **`hasValidFix(contact)`** — `src/shared/types.ts`: true iff GPS coords are present, non-zero, and in range.

---

## Task 1: Resolve + distance helpers

**Files:**
- Create: `src/renderer/lib/contactDetail.ts`

A contact's data is split across two store slices: `discovered` (the superset — every node heard, with `firstHeardMs`, `lastAdvertMs`, `gpsLat/Lon`, `hops`, `favourite`, `blocked`, `onRadio`) and `contacts` (on-radio only — adds `rssi`, `snr`, `lastSeenMs`, `outPathHex`, `outPathHashSize`, `preferDirect`). The detail needs both, merged by `publicKeyHex`.

- [ ] **Step 1: Write the helper module**

```ts
// src/renderer/lib/contactDetail.ts
import type { DiscoveredContact } from '../../shared/contacts/discovered';
import type { Contact } from '../../shared/types';

/** A contact merged from both store slices for the detail panel. The discovered
 *  pool is the superset (everyone we've heard); the on-radio `Contact` overlays
 *  link metrics + path when present. Either source may be missing: a brand-new
 *  on-radio contact might not yet have a discovered row, and a discovered-only
 *  node has no on-radio row. */
export interface ResolvedContact {
  publicKeyHex: string;
  key: string; // `c:${publicKeyHex}`
  name: string;
  kind: DiscoveredContact['kind'];
  onRadio: boolean;
  favourite: boolean;
  blocked: boolean;
  hops?: number;
  gpsLat?: number;
  gpsLon?: number;
  firstHeardMs?: number;
  lastAdvertMs?: number;
  // From the on-radio Contact (undefined for discovered-only):
  contact: Contact | null;
  rssi?: number;
  snr?: number;
  lastSeenMs?: number;
  outPathHex?: string;
  outPathHashSize?: Contact['outPathHashSize'];
}

/** Merge the discovered-pool row and the on-radio Contact for one pubkey.
 *  Returns null only when the pubkey appears in neither list. */
export function resolveContact(
  publicKeyHex: string,
  discovered: DiscoveredContact[],
  contacts: Contact[],
): ResolvedContact | null {
  const pk = publicKeyHex.toLowerCase();
  const d = discovered.find((x) => x.publicKeyHex.toLowerCase() === pk) ?? null;
  const c = contacts.find((x) => x.publicKeyHex.toLowerCase() === pk) ?? null;
  if (!d && !c) return null;

  const name = d?.name ?? c?.name ?? '';
  const kind = d?.kind ?? c?.kind ?? 'chat';
  return {
    publicKeyHex: d?.publicKeyHex ?? c?.publicKeyHex ?? publicKeyHex,
    key: `c:${d?.publicKeyHex ?? c?.publicKeyHex ?? publicKeyHex}`,
    name,
    kind,
    onRadio: d?.onRadio ?? c != null,
    favourite: d?.favourite ?? false,
    blocked: d?.blocked ?? false,
    hops: d?.hops ?? c?.hops,
    gpsLat: d?.gpsLat ?? c?.gpsLat,
    gpsLon: d?.gpsLon ?? c?.gpsLon,
    firstHeardMs: d?.firstHeardMs,
    lastAdvertMs: d?.lastAdvertMs ?? c?.lastSeenMs,
    contact: c,
    rssi: c?.rssi,
    snr: c?.snr,
    lastSeenMs: c?.lastSeenMs,
    outPathHex: c?.outPathHex,
    outPathHashSize: c?.outPathHashSize,
  };
}

const EARTH_RADIUS_KM = 6371;

/** Great-circle distance between two WGS84 points, in kilometres. */
export function distanceKm(
  aLat: number,
  aLon: number,
  bLat: number,
  bLon: number,
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLon = toRad(bLon - aLon);
  const lat1 = toRad(aLat);
  const lat2 = toRad(bLat);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Render a distance for the detail panel: "12.3 km · 7.6 mi", switching to
 *  metres/feet under 1 km so nearby nodes don't all read "0.0 km". */
export function fmtDistance(km: number): string {
  if (km < 1) {
    const m = Math.round(km * 1000);
    const ft = Math.round(km * 3280.84);
    return `${m} m · ${ft} ft`;
  }
  const mi = km * 0.621371;
  return `${km.toFixed(1)} km · ${mi.toFixed(1)} mi`;
}
```

- [ ] **Step 2: Verify typecheck + lint**

Run: `pnpm typecheck && pnpm lint`
Expected: exit 0, no errors. (Biome may auto-sort imports — that's fine; re-run with `npx @biomejs/biome check --write src/renderer/lib/contactDetail.ts` if it flags formatting, then re-verify.)

- [ ] **Step 3: Commit**

```bash
git add src/renderer/lib/contactDetail.ts
git commit -m "feat(contacts): resolveContact merge + distance helpers for detail panel"
```

---

## Task 2: RepeaterAdmin tab deep-link plumbing

**Files:**
- Modify: `src/renderer/lib/store.ts`
- Modify: `src/renderer/panels/repeater-admin/index.tsx`

RepeaterAdmin holds its active tab in local `useState<TabId>('login')`. To deep-link (Telemetry → Status, Permissions → ACL, Remote-Mgmt → CLI), the detail sets a renderer-only "pending tab" in the store, then navigates to the contact. RepeaterAdmin applies and clears it on mount/change — covering both "panel not yet mounted" and "already showing this repeater" cases. The `RepeaterAdminTab` type lives in the store (not the panel) so the store has no dependency on a panel module.

- [ ] **Step 1: Add the type, field, and action to the store**

In `src/renderer/lib/store.ts`, add the exported type near the other Contact-Manager view types (after the `CmLayout` type, ~line 72):

```ts
/** Tabs in the RepeaterAdmin panel. Lives here (not the panel) so the store
 *  can carry a pending deep-link target without importing a panel module. */
export type RepeaterAdminTab =
  | 'login'
  | 'path'
  | 'status'
  | 'acl'
  | 'neighbours'
  | 'owner'
  | 'cli';
```

Add the field to the store interface, next to the repeater snapshot maps (~line 228, after `repeaterTelemetryByKey`):

```ts
  // Renderer-only deep-link intent: the detail panel's Telemetry/Permissions/
  // Remote-Mgmt buttons set this, then navigate to the repeater contact;
  // RepeaterAdmin consumes + clears it on mount. Not persisted.
  repeaterAdminTab: RepeaterAdminTab | null;
  setRepeaterAdminTab: (tab: RepeaterAdminTab | null) => void;
```

Add the initial value where the store object literal is created (alongside other transient defaults — find where `busy: false` or `repeaterStatusByKey: {}` is initialised) :

```ts
  repeaterAdminTab: null,
```

Add the action implementation near `setCmFocus` (~line 584):

```ts
  setRepeaterAdminTab: (tab) => set(() => ({ repeaterAdminTab: tab })),
```

- [ ] **Step 2: Consume the pending tab in RepeaterAdmin**

In `src/renderer/panels/repeater-admin/index.tsx`:

Replace the local `TabId` definition (line 25) with an alias of the store type, and import it:

```ts
import { type ApiClient, api } from '../../lib/api';
import { type RepeaterAdminTab, useStore } from '../../lib/store';
import { notify } from '../../lib/notify';
// ...
type TabId = RepeaterAdminTab;
```

Inside the `RepeaterAdmin` component, after the existing `const [tab, setTab] = useState<TabId>('login');` line, add the consume effect:

```ts
  const pendingTab = useStore((s) => s.repeaterAdminTab);
  const setRepeaterAdminTab = useStore((s) => s.setRepeaterAdminTab);

  // Apply a deep-link target requested by the contact-detail panel, then clear
  // it so a later manual tab change isn't reverted. Runs whether the panel was
  // just mounted (navigated in) or was already showing this repeater.
  useEffect(() => {
    if (pendingTab) {
      setTab(pendingTab);
      setRepeaterAdminTab(null);
    }
  }, [pendingTab, setRepeaterAdminTab]);
```

(`useEffect` is already imported.)

- [ ] **Step 3: Verify typecheck + lint**

Run: `pnpm typecheck && pnpm lint`
Expected: exit 0. Confirm no unused-import or shadow warnings on `RepeaterAdminTab`.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/lib/store.ts src/renderer/panels/repeater-admin/index.tsx
git commit -m "feat(contacts): RepeaterAdmin tab deep-link plumbing (pending-tab store field)"
```

---

## Task 3: ContactDetail — header + info fields (read-only)

**Files:**
- Create: `src/renderer/shell/rightrail/sections/ContactDetail.tsx`

Build the presentational core: resolve the contact, render an empty-state when unknown, then a header (glyph + name + short key + status pill) and the info `KeyValueRow`s. No actions yet — leave a `{/* action row — Task 4 */}` marker and a `{/* path subsection — Task 5 */}` marker. The component takes a bare `publicKeyHex` (nullable) plus `client` and an optional `showPath` flag (default `true`) consumed in Task 5.

- [ ] **Step 1: Write the component (header + info fields)**

```tsx
// src/renderer/shell/rightrail/sections/ContactDetail.tsx
import { type ApiClient } from '../../../lib/api';
import {
  type ResolvedContact,
  distanceKm,
  fmtDistance,
  resolveContact,
} from '../../../lib/contactDetail';
import { copyToClipboard } from '../../../components/ContextMenu';
import { publish as publishMapBus } from '../../../lib/map/bus';
import { notify } from '../../../lib/notify';
import { useStore } from '../../../lib/store';
import { fmtDateTime, fmtRelative } from '../../../lib/time';
import { hasValidFix } from '../../../../shared/types';
import { KeyValueRow } from '../../../components/ui/KeyValueRow';
import { StatusPill, TypeGlyph } from '../../../panels/contacts/ContactRows';
import { Placeholder } from '../atoms';

const KIND_LABEL: Record<ResolvedContact['kind'], string> = {
  chat: 'Chat',
  repeater: 'Repeater',
  room: 'Room',
  sensor: 'Sensor',
};

interface Props {
  publicKeyHex: string | null;
  client: ApiClient | null;
  /** Render the embedded path subsection. False where the rail already has a
   *  dedicated Path section (dm/repeater view). Default true. */
  showPath?: boolean;
}

export function ContactDetail({ publicKeyHex, client, showPath = true }: Props) {
  const discovered = useStore((s) => s.discovered);
  const contacts = useStore((s) => s.contacts);
  const identity = useStore((s) => s.deviceIdentity);
  const timeFormat = useStore((s) => s.appSettings.timeFormat);

  if (!publicKeyHex) return <Placeholder label="no contact focused" />;
  const rc = resolveContact(publicKeyHex, discovered, contacts);
  if (!rc) return <Placeholder label="unknown contact" />;

  const shortKey = `${rc.publicKeyHex.slice(0, 6)}…${rc.publicKeyHex.slice(-4)}`;
  const hasFix = hasValidFix(rc as never);
  const selfHasFix =
    typeof identity.lat === 'number' &&
    typeof identity.lon === 'number' &&
    (identity.lat !== 0 || identity.lon !== 0);
  const distance =
    hasFix && selfHasFix
      ? distanceKm(
          identity.lat as number,
          identity.lon as number,
          rc.gpsLat as number,
          rc.gpsLon as number,
        )
      : null;

  return (
    <div className="space-y-3 text-cs-text-muted">
      {/* Header */}
      <div className="flex items-start gap-2.5">
        <div className="grid size-9 shrink-0 place-items-center rounded-lg border border-cs-border bg-cs-bg-3">
          <TypeGlyph kind={rc.kind} className="size-4.5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span
              className={`truncate text-sm font-semibold text-cs-text ${rc.blocked ? 'line-through opacity-60' : ''}`}
            >
              {rc.name || '(unnamed)'}
            </span>
          </div>
          <button
            type="button"
            onClick={() => copyToClipboard(rc.publicKeyHex, () => notify.success('Public key copied'))}
            title={`${rc.publicKeyHex} — click to copy`}
            className="font-mono text-[10px] text-cs-text-dim hover:text-cs-text-muted"
          >
            {shortKey}
          </button>
        </div>
        <StatusPill c={{ ...rc, blocked: rc.blocked, onRadio: rc.onRadio } as never} />
      </div>

      {/* action row — Task 4 */}

      {/* Info fields */}
      <div className="space-y-1.5">
        <KeyValueRow
          label="Public key"
          mono
          title={rc.publicKeyHex}
          value={
            <button
              type="button"
              onClick={() => copyToClipboard(rc.publicKeyHex, () => notify.success('Public key copied'))}
              className="truncate font-mono hover:text-cs-text"
            >
              {shortKey}
            </button>
          }
        />
        <KeyValueRow label="Type" value={KIND_LABEL[rc.kind]} />
        {hasFix && (
          <KeyValueRow
            label="Position"
            mono
            value={
              <button
                type="button"
                onClick={() => {
                  setActiveKeyToMap(rc);
                }}
                title="View on map"
                className="hover:text-cs-text"
              >
                {(rc.gpsLat as number).toFixed(5)}, {(rc.gpsLon as number).toFixed(5)}
              </button>
            }
          />
        )}
        {distance != null && <KeyValueRow label="Distance away" value={fmtDistance(distance)} mono />}
        <KeyValueRow
          label="Last advert"
          value={rc.lastAdvertMs == null ? '—' : fmtRelative(rc.lastAdvertMs)}
          title={rc.lastAdvertMs == null ? undefined : fmtDateTime(rc.lastAdvertMs, timeFormat)}
        />
        <KeyValueRow
          label="First heard"
          value={rc.firstHeardMs == null ? '—' : fmtRelative(rc.firstHeardMs)}
          title={rc.firstHeardMs == null ? undefined : fmtDateTime(rc.firstHeardMs, timeFormat)}
        />
        <KeyValueRow
          label="Hops away"
          value={rc.hops == null ? 'Flood' : `${rc.hops} hop${rc.hops === 1 ? '' : 's'}`}
          mono
        />
        {rc.outPathHashSize != null && (
          <KeyValueRow label="Path hash size" value={`${rc.outPathHashSize}-byte`} mono />
        )}
        {rc.rssi != null && <KeyValueRow label="RSSI" value={`${rc.rssi} dBm`} mono />}
      </div>

      {showPath && <div>{/* path subsection — Task 5 */}</div>}
    </div>
  );
}

/** Center the Map panel on a resolved contact's last position. */
function setActiveKeyToMap(rc: ResolvedContact) {
  useStore.getState().setActiveKey('tool:map');
  publishMapBus({ kind: 'flyTo', lng: rc.gpsLon as number, lat: rc.gpsLat as number, zoom: 12 });
}
```

> **Implementer note on `StatusPill`:** it accepts `{ c: DiscoveredContact }` and only reads `c.blocked` / `c.onRadio`. `ResolvedContact` carries both fields, so the `as never` cast above is a pragmatic bridge. If the cast trips lint, instead pass a minimal literal: `<StatusPill c={{ blocked: rc.blocked, onRadio: rc.onRadio } as DiscoveredContact} />` with a `// only blocked/onRadio are read` comment. Prefer whichever the linter accepts cleanly.

> **Implementer note on `hasValidFix`:** it's typed for `Contact`. `ResolvedContact` has the same `gpsLat`/`gpsLon` optional-number shape, so reuse it via the `as never`/structural cast, or inline the same checks (`typeof rc.gpsLat === 'number' && (rc.gpsLat !== 0 || rc.gpsLon !== 0) && in-range`). Don't change `hasValidFix`'s signature.

- [ ] **Step 2: Verify typecheck + lint**

Run: `pnpm typecheck && pnpm lint`
Expected: exit 0. If Biome reflows imports/JSX, run `npx @biomejs/biome check --write src/renderer/shell/rightrail/sections/ContactDetail.tsx` and re-verify. The component is not mounted yet, so no runtime change.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/shell/rightrail/sections/ContactDetail.tsx
git commit -m "feat(contacts): ContactDetail header + info fields (read-only)"
```

---

## Task 4: ContactDetail — status/kind-adaptive action row

**Files:**
- Modify: `src/renderer/shell/rightrail/sections/ContactDetail.tsx`

Replace the `{/* action row — Task 4 */}` marker with a wrapped action row. Actions adapt to status + kind per the spec ("real where backed, link otherwise"):

- **Add to radio** — shown only when `!onRadio && !blocked`; accent CTA; `api.addToRadio`.
- **Message** — on-radio **chat/room** only; `setActiveKey(rc.key)`.
- **Favourite ★** — always (on-radio → device flag; discovered-only → app-tracked); `api.setFavourite`; filled star when `rc.favourite`.
- **View on Map** — when `hasFix`; reuses `setActiveKeyToMap`.
- **Telemetry / Permissions / Remote Mgmt** — on-radio **repeater/sensor** only; each sets the pending RepeaterAdmin tab then navigates: Telemetry→`'status'`, Permissions→`'acl'`, Remote Mgmt→`'cli'`.
- **Block** — when `!blocked`; opens `BlockSenderDialog`.
- **Remove** — on-radio only; confirm via the existing `Dialog`; `api.removeFromRadio`. (Discovered-only has no per-contact remove in v1.)
- **Share** — `notify.info('Share — coming soon')` stub.

- [ ] **Step 1: Add imports**

At the top of `ContactDetail.tsx`, add:

```tsx
import { useState } from 'react';
import {
  Ban,
  MapPin,
  MessageSquare,
  Minus,
  Plus,
  Radio,
  Share2,
  ShieldCheck,
  Star,
  TerminalSquare,
} from 'lucide-react';
import { api } from '../../../lib/api';
import { BlockSenderDialog } from '../../../components/BlockSenderDialog';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../../components/ui/dialog';
import { CardActionButton } from './ContactCard';
```

(Adjust the existing `import { type ApiClient } from '../../../lib/api'` to `import { type ApiClient, api } from '../../../lib/api'` rather than a second import.)

- [ ] **Step 2: Add local state + handlers inside the component**

Just after the `resolveContact` guard (`if (!rc) return …`), add:

```tsx
  const setActiveKey = useStore((s) => s.setActiveKey);
  const setRepeaterAdminTab = useStore((s) => s.setRepeaterAdminTab);
  const [blockOpen, setBlockOpen] = useState(false);
  const [removeOpen, setRemoveOpen] = useState(false);

  const canMessage = rc.onRadio && (rc.kind === 'chat' || rc.kind === 'room');
  const canAdminister = rc.onRadio && (rc.kind === 'repeater' || rc.kind === 'sensor');

  async function act(fn: () => Promise<void>, ok: string) {
    if (!client) return;
    try {
      await fn();
      notify.success(ok);
    } catch (err) {
      notify.error(`Action failed: ${(err as Error).message}`, err);
    }
  }

  function openRepeaterTab(tab: 'status' | 'acl' | 'cli') {
    setRepeaterAdminTab(tab);
    setActiveKey(rc.key);
  }
```

> Note `act`, `canMessage`, etc. reference `rc` and `client`; declare them after `rc` is known. Keep the `if (!rc)` early-return above them.

- [ ] **Step 3: Replace the `{/* action row — Task 4 */}` marker**

```tsx
      <div className="flex flex-wrap gap-1.5">
        {!rc.onRadio && !rc.blocked && (
          <CardActionButton
            icon={Plus}
            label="Add to radio"
            onClick={() => act(() => api.addToRadio(client as never, rc.publicKeyHex), `Added ${rc.name} to radio`)}
          />
        )}
        {canMessage && (
          <CardActionButton icon={MessageSquare} label="Message" onClick={() => setActiveKey(rc.key)} />
        )}
        <CardActionButton
          icon={Star}
          label={rc.favourite ? 'Unfavourite' : 'Favourite'}
          onClick={() =>
            act(
              () => api.setFavourite(client as never, rc.publicKeyHex, !rc.favourite),
              rc.favourite ? 'Removed favourite' : 'Favourited',
            )
          }
        />
        {hasFix && (
          <CardActionButton icon={MapPin} label="View on map" onClick={() => setActiveKeyToMap(rc)} />
        )}
        {canAdminister && (
          <>
            <CardActionButton icon={Radio} label="Telemetry" onClick={() => openRepeaterTab('status')} />
            {rc.kind === 'repeater' && (
              <CardActionButton icon={ShieldCheck} label="Permissions" onClick={() => openRepeaterTab('acl')} />
            )}
            <CardActionButton icon={TerminalSquare} label="Remote mgmt" onClick={() => openRepeaterTab('cli')} />
          </>
        )}
        {!rc.blocked && (
          <CardActionButton icon={Ban} label="Block" onClick={() => setBlockOpen(true)} />
        )}
        {rc.onRadio && (
          <CardActionButton icon={Minus} label="Remove" onClick={() => setRemoveOpen(true)} />
        )}
        <CardActionButton icon={Share2} label="Share" onClick={() => notify.info('Share — coming soon')} />
      </div>

      {blockOpen && (
        <BlockSenderDialog
          client={client}
          open
          prefill={{ pubkey: rc.publicKeyHex, name: rc.name }}
          onClose={() => setBlockOpen(false)}
        />
      )}

      <Dialog open={removeOpen} onOpenChange={(o) => !o && setRemoveOpen(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove from radio</DialogTitle>
            <DialogDescription>
              Remove {rc.name} from the radio's contact store? It stays in your discovered list and
              can be re-added later.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <button
              type="button"
              onClick={() => setRemoveOpen(false)}
              className="rounded-md border border-cs-border bg-cs-bg-2 px-3 py-1.5 text-xs hover:bg-cs-bg-3"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => {
                setRemoveOpen(false);
                void act(() => api.removeFromRadio(client as never, rc.publicKeyHex), `Removed ${rc.name} from radio`);
              }}
              className="rounded-md border border-cs-danger bg-cs-danger/10 px-3 py-1.5 text-xs text-cs-danger hover:bg-cs-danger/20"
            >
              Remove
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
```

> **`client as never`:** the action handlers early-return inside `act` when `client` is null, but the `api.*` calls are written outside that guard's narrowing. Prefer narrowing cleanly: guard each handler with `if (!client) return;` and drop the cast, OR keep `act` and pass `client` through it (e.g. `act(async (c) => api.addToRadio(c, …))` where `act` calls `fn(client)` only when non-null). Choose the cast-free shape that lint accepts; do not ship `as never` if avoidable.

- [ ] **Step 4: Verify typecheck + lint**

Run: `pnpm typecheck && pnpm lint`
Expected: exit 0. Run `npx @biomejs/biome check --write` on the file if formatting flags, then re-verify.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/shell/rightrail/sections/ContactDetail.tsx
git commit -m "feat(contacts): ContactDetail status/kind-adaptive action row + deep-links"
```

---

## Task 5: ContactDetail — embedded path subsection

**Files:**
- Modify: `src/renderer/shell/rightrail/sections/ContactDetail.tsx`

Replace the `{/* path subsection — Task 5 */}` marker. On-radio contacts with a full pubkey get the existing `SetPathEditor` (edit hops + reset-to-flood). Discovered-only or short-key contacts get a read-only summary with a hint.

- [ ] **Step 1: Add the import**

```tsx
import { SetPathEditor } from '../../../components/path/SetPathEditor';
```

- [ ] **Step 2: Replace the marker**

```tsx
      {showPath && (
        <div className="border-t border-cs-border pt-2">
          <div className="mb-1 font-mono text-[10px] uppercase tracking-wider text-cs-text-dim">
            Path
          </div>
          {rc.contact && rc.publicKeyHex.length >= 64 ? (
            <SetPathEditor contact={rc.contact} client={client} />
          ) : (
            <div className="space-y-1 px-1 pb-1">
              <div className="font-mono text-[12px] text-cs-text">
                {rc.outPathHex ? `${rc.outPathHex.length / 2} byte path` : 'Flood'}
              </div>
              <p className="text-[11px] text-cs-text-dim">
                {rc.onRadio
                  ? 'Waiting on a full advert before the path can be edited.'
                  : 'Add this contact to the radio to set a fixed path.'}
              </p>
            </div>
          )}
        </div>
      )}
```

- [ ] **Step 3: Verify typecheck + lint**

Run: `pnpm typecheck && pnpm lint`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/shell/rightrail/sections/ContactDetail.tsx
git commit -m "feat(contacts): embed path editor / read-only path summary in ContactDetail"
```

---

## Task 6: Wire ContactDetail into the three rail slots; retire ContactCardSection

**Files:**
- Modify: `src/renderer/shell/rightrail/sections/ContactManagerRail.tsx`
- Modify: `src/renderer/shell/rightrail/sectionsFor.tsx`
- Modify: `src/renderer/shell/rightrail/sections/MentionedContact.tsx`
- Modify: `src/renderer/shell/rightrail/sections/ContactCard.tsx`

### 6a — Contact Manager rail: show detail when a row is focused

In `ContactManagerRail.tsx`, update `ContactManagerRailBody` (currently `return selected.length > 0 ? <BulkActions/> : <ListActions/>`). Bulk selection still wins; otherwise a focused row shows the detail with a "back to list" affordance; otherwise the list actions.

- [ ] **Step 1: Add imports + focus branch**

Add near the other imports:

```tsx
import { ChevronLeft } from 'lucide-react';
import { ContactDetail } from './ContactDetail';
```

Replace `ContactManagerRailBody`:

```tsx
/** Contextual right-rail body for the Contact Manager: bulk actions when rows
 *  are selected, the focused contact's detail when a single row is focused,
 *  otherwise list-wide actions. */
export function ContactManagerRailBody({ client }: { client: ApiClient | null }) {
  const selected = useStore((s) => s.contactManager.selected);
  const focusKey = useStore((s) => s.contactManager.focusKey);
  const setCmFocus = useStore((s) => s.setCmFocus);

  if (selected.length > 0) return <BulkActions client={client} />;
  if (focusKey) {
    return (
      <div className="space-y-2">
        <button
          type="button"
          onClick={() => setCmFocus(null)}
          className="flex items-center gap-1 text-[11px] text-cs-text-dim hover:text-cs-text"
        >
          <ChevronLeft className="size-3.5" aria-hidden="true" />
          Back to list actions
        </button>
        <ContactDetail publicKeyHex={focusKey} client={client} />
      </div>
    );
  }
  return <ListActions client={client} />;
}
```

> `focusKey` holds the **bare publicKeyHex** (set by `setCmFocus(pk)` in `ContactRows.tsx`), which is exactly what `ContactDetail` expects.

### 6b — dm/repeater rail: replace ContactCardSection with ContactDetail

In `sectionsFor.tsx`, the `case 'dm': case 'repeater':` block's `rail.contact.card` section currently renders `<ContactCardSection contact={data.contact} />`. The rail already has a dedicated `rail.contact.path` section, so pass `showPath={false}` to avoid a duplicate path editor. Derive the pubkey from `activeKey` so a contact not yet in the on-radio list still resolves from the discovered pool.

- [ ] **Step 2: Update the import and the section body**

Replace `import { ContactCardSection } from './sections/ContactCard';` with:

```tsx
import { ContactDetail } from './sections/ContactDetail';
```

In the `'dm' | 'repeater'` return, change the `rail.contact.card` body:

```tsx
        {
          id: 'rail.contact.card',
          label: 'Contact card',
          defaultOpen: baseDefaultOpen,
          body: () => (
            <ContactDetail
              publicKeyHex={activeKey.startsWith('c:') ? activeKey.slice(2) : null}
              client={actions.client}
              showPath={false}
            />
          ),
        },
```

Leave the `rail.contact.path`, `rail.contact.advert`, and `rail.contact.shared` sections unchanged.

### 6c — @mention rail: wrap ContactDetail

In `MentionedContact.tsx`, swap the inner `ContactCardSection` for `ContactDetail` (keep the `onClear` affordance and the section wrapper). Read the file first; it currently renders `<ContactCardSection contact={contact} />`. Replace with `<ContactDetail publicKeyHex={contact.publicKeyHex} client={null} showPath={false} />`.

- [ ] **Step 3: Update MentionedContact**

The component currently receives `{ contact: Contact; onClear }`. Keep that signature (callers in `sectionsFor.tsx` pass `data.mentionedContact`). Replace the body's inner card:

```tsx
// imports: drop ContactCardSection, add:
import { ContactDetail } from './ContactDetail';
// ...
// in the returned JSX, where <ContactCardSection contact={contact} /> was:
<ContactDetail publicKeyHex={contact.publicKeyHex} client={null} showPath={false} />
```

> `client` is `null` here because the @mention section isn't threaded a client (matching today's behaviour — the mention card was read-only). Actions that need a client are disabled/no-op when `client` is null, which is acceptable for the mention surface in v1.

### 6d — Retire ContactCardSection, keep CardActionButton

In `ContactCard.tsx`, delete the `ContactCardSection` function (and its now-unused imports: `Crosshair`, `MessageSquare` if only used there, `Settings`, `hasValidFix`, `KeyValueRow`, `publishMapBus`, `useStore`, `fmtDateTime`, `fmtRelative`, `Placeholder`). **Keep `CardActionButton`** and whatever imports it needs (`type { LucideIcon }` or the existing `typeof MessageSquare` icon type — keep one lucide icon import to type the `icon` prop, e.g. keep `MessageSquare`). Verify no other file imports `ContactCardSection` after 6b/6c.

- [ ] **Step 4: Trim ContactCard.tsx to just CardActionButton**

Read the file, remove `ContactCardSection` and dead imports, retype `CardActionButton`'s `icon` prop if needed (e.g. `import type { LucideIcon } from 'lucide-react';` and `icon: LucideIcon`).

- [ ] **Step 5: Verify typecheck + lint**

Run: `pnpm typecheck && pnpm lint`
Expected: exit 0. Common failures to fix:
- Unused imports in `ContactCard.tsx` / `sectionsFor.tsx` → remove them.
- `grep -rn "ContactCardSection" src/` should return **nothing**.
Run `npx @biomejs/biome check --write` on the four files if formatting flags, then re-verify.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/shell/rightrail/sections/ContactManagerRail.tsx \
        src/renderer/shell/rightrail/sectionsFor.tsx \
        src/renderer/shell/rightrail/sections/MentionedContact.tsx \
        src/renderer/shell/rightrail/sections/ContactCard.tsx
git commit -m "feat(contacts): mount ContactDetail in manager/dm/repeater/mention rails"
```

---

## Final verification (whole phase)

- [ ] **Typecheck + lint clean:** `pnpm typecheck && pnpm lint` → exit 0.
- [ ] **No dangling references:** `grep -rn "ContactCardSection" src/` → empty.
- [ ] **Manual device verification (user-driven)** — confirm each surface:
  1. **Manager focus:** click a row in the Contact Manager → right rail shows the rich detail (header, fields, actions); "Back to list actions" returns to ListActions; selecting checkboxes still shows BulkActions.
  2. **Discovered-only contact:** "Add to radio" is present; Message/Telemetry/Remove are absent; Favourite/Block/Share present; path shows the "add to set a path" hint.
  3. **On-radio chat:** Message + Favourite + Map + Remove; path editor present.
  4. **On-radio repeater:** Telemetry → opens RepeaterAdmin **Status** tab; Permissions → **ACL** tab; Remote mgmt → **CLI** tab (navigating from the Manager and from an already-open repeater both land on the right tab).
  5. **DM view rail:** opening a DM/repeater conversation shows the same detail in the "Contact card" section (no duplicate path — the dedicated Path section still works).
  6. **@mention:** clicking an @mention pill surfaces the contact detail (read-only actions ok).
  7. **Distance:** a contact with GPS, when our radio has a position, shows "Distance away"; hidden when either side lacks a fix.
  8. **Favourite toggle:** ★ flips and persists (on-radio reflects on device; discovered-only persists app-side).

- [ ] **Dispatch final code reviewer** over the whole Phase 3 diff (per subagent-driven-development).
- [ ] **Finish the branch** per `superpowers:finishing-a-development-branch` only after the user confirms device verification.

---

## Self-Review (completed during authoring)

- **Spec coverage:** header + info fields (Task 3), distance (Task 1/3), status/kind-adaptive actions incl. RepeaterAdmin deep-links (Task 2/4), embedded path (Task 5), focus-anywhere wiring across Manager/DM/mention (Task 6). Share/Remove-from-discovered/inline-name-edit/Ping explicitly deferred with rationale in Scope.
- **Type consistency:** `ResolvedContact` defined in Task 1 is the single shape consumed by Tasks 3–6; `RepeaterAdminTab` defined once in the store (Task 2) and reused by RepeaterAdmin + the detail's `openRepeaterTab`; `publicKeyHex` (bare) is the consistent key into `ContactDetail` from all three call sites and matches `setCmFocus`'s payload.
- **Placeholder scan:** the two in-code markers (`{/* action row */}`, `{/* path subsection */}`) are intentional task handoff points, each resolved in a later task — not shipped placeholders. The `as never` casts carry explicit implementer notes to prefer a cast-free narrowing.
- **No test runner:** every task verifies via `pnpm typecheck && pnpm lint` + final manual device testing, per project convention.
