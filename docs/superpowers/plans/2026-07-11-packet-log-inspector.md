# Packet Log Inspector Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single-line Packet Log with a two-part byte-level inspector (columned live list + right-rail byte breakdown), a command-palette/BYON standalone decoder, channel-packet decryption, packet persistence, and light+dark theming.

**Architecture:** Decode happens in the renderer via a pure adapter over `@michaelhart/meshcore-decoder`'s `analyzeStructure()` (the only decoder exposing per-field byte offsets + header bit-breakdown + key-based decryption). The same adapter serves live packets, the in-rail paste panel, and the standalone dialog. Packets persist in a SQLite `packets` table and hydrate through the existing `/api/state/snapshot` → `hydrate()` flow; retention sizes are account-synced `UiState` settings.

**Tech Stack:** Electron + React 19, Zustand, Tailwind v4 + radix-ui/shadcn primitives, lucide-react, react-virtuoso, Hono (main API), `node:sqlite`, Vitest (projects: `unit` node, `dom` jsdom), `@michaelhart/meshcore-decoder`.

**Design reference (read once before Phase D):** `docs/design/handoff-extracted/meshcore-desktop-application/project/design_handoff_packet_log/` — `pl-bytestrip.jsx`, `pl-detail.jsx`, `pl-list.jsx` (inside `Packet Log.html`), and `README.md`. Recreate the visuals; do **not** port the prototype's structure.

**Spec:** `docs/superpowers/specs/2026-07-10-packet-log-inspector-design.md`.

## Global Constraints

- **Decoder:** renderer uses `@michaelhart/meshcore-decoder` (`MeshCoreDecoder`) only. Never import `@andyshinn/meshcore-ts` in the renderer (Node-only).
- **Colors:** all inspector colors go through `--cs-*` tokens (Tailwind `text-cs-*` / `bg-cs-*/<alpha>`). No hard-coded hex in components. Field color by index: `--cs-field0`…`--cs-field6`; route/BLE: `--cs-route-direct`, `--cs-route-flood`, `--cs-ble`.
- **Fonts:** hex/hashes/telemetry use `font-mono`; body uses default sans (Inter). Labels: `text-[10px] uppercase tracking-wider text-cs-text-dim`.
- **Retention settings (defaults):** `liveBufferSize` 2000 (bounds 200–20000), `storedHistorySize` 20000 (bounds 0–200000, 0 = persistence off). Hydrate limit = `min(liveBufferSize, storedHistorySize)`.
- **Payload-type / route names:** use `Utils.getPayloadTypeName` / `Utils.getRouteTypeName` from the decoder (e.g. `Group Text`, `Text Message`, `Flood`, `Direct`).
- **Trace path** button renders **disabled**. **DM decryption** is out (renderer has no node private key). **Serial packets** stay unsupported (pre-existing).
- **Tests:** unit → `tests/unit/**/*.test.ts` (node); component → `tests/component/**/*.test.tsx` (jsdom). Run one file: `pnpm exec vitest run --project <unit|dom> <path>`. Full gate: `pnpm typecheck && pnpm lint && pnpm test`.
- **Commits:** end every commit message body with `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`. Git in this worktree needs the sandbox disabled.
- **Biome:** scope any manual lint to `src tests` (repo-wide `pnpm lint` = `biome check` is fine; it targets the project).

---

## File Structure

**New — renderer**
- `src/renderer/lib/packetInspect.ts` — pure decode adapter → view-model (packet + payload + decrypted/appdata secondary). The swap point.
- `src/renderer/lib/bleFrameLayouts.ts` — companion-frame byte layouts keyed by `codeName`; `inspectBleFrame`.
- `src/renderer/lib/packetInput.ts` — `detectAndDecode` input normalizer (hex / base64 / `meshcore://`).
- `src/renderer/components/packet/ByteStrip.tsx` — hex byte-pair strip, scoped bidirectional hover.
- `src/renderer/components/packet/FieldCard.tsx` — field card (value box + optional bit table + desc).
- `src/renderer/components/packet/BitTable.tsx` — collapsible BITS·FIELD·VALUE·BIN table.
- `src/renderer/components/packet/PacketBreakdown.tsx` — strip + stacked cards for one field set (shared by rail + dialog).
- `src/renderer/components/packet/PacketDetailsRail.tsx` — the whole right-rail detail (DETAILS→hash→breakdowns→secondary/BLE/empty + BYON).
- `src/renderer/components/packet/PacketDecoderDialog.tsx` — standalone decoder modal.
- `src/renderer/panels/settings/PacketLogSection.tsx` — Extra-tab settings section.

**New — main / tests**
- `src/main/storage/packets.ts` — `packetStore` (record/recent/clear/prune) over `openDb()`.
- `tests/support/packetFixtures.ts` — hand-built wire-format hex fixtures.
- `tests/unit/renderer/lib/packetInspect.test.ts`, `tests/unit/renderer/lib/bleFrameLayouts.test.ts`, `tests/unit/renderer/lib/packetInput.test.ts`, `tests/unit/main/storagePackets.test.ts`, `tests/unit/renderer/lib/packetLogStore.test.ts`.
- `tests/component/packet-bytestrip.test.tsx`, `tests/component/packet-log-select.test.tsx`, `tests/component/rail-packetlog.test.tsx`.

**Modified**
- `src/shared/types.ts` — `UiState.packetLog`, `packetLogFilter.source`, `UiState.decoderOpen`, `DEFAULT_UI_STATE`, `StateSnapshot.packets`.
- `src/renderer/lib/store.ts` — `LivePacket`, packet id assignment, `selectedPacketId`/`setSelectedPacket`, `applyPacket` cap from setting, `hydrate` packets, `clearPackets`, `packetLog` setter, `packetLogFilter` migration, `decoderOpen` actions, nav clear.
- `src/renderer/lib/theme.ts` + `src/renderer/index.css` — field/route/ble tokens (dark + light).
- `src/renderer/components/PacketLog.tsx` — full rewrite (list).
- `src/renderer/components/AppHosts.tsx` — `PacketLogHost` passes `LivePacket[]`.
- `src/renderer/shell/rightrail/index.tsx` — bypass to `PacketDetailsRail` for `tool:packetlog` (like Map).
- `src/renderer/shell/useDeselectOnOutsideClick.ts` — also clear `selectedPacketId`; keep `packet-row`.
- `src/renderer/App.tsx` — mount `PacketDecoderDialog` host.
- `src/renderer/features/command-palette/items/actions.ts` — "Decode packet…" action; clear also clears DB.
- `src/renderer/lib/api.ts` — `clearPackets` method.
- `src/renderer/panels/settings/SettingsPanel.tsx` — register PacketLog section in Extra tab.
- `src/main/storage/db.ts` — `packets` table DDL.
- `src/main/server.ts` — persist in `onPacket`.
- `src/main/api/routes.ts` — `packets` in snapshot payload; `POST /api/packets/clear`.

---

## Task 1: SQLite `packets` table + storage module

**Files:**
- Modify: `src/main/storage/db.ts` (append DDL inside the `db.exec(\`…\`)` block, after the `discovered_contacts` indexes near line 104)
- Create: `src/main/storage/packets.ts`
- Test: `tests/unit/main/storagePackets.test.ts`

**Interfaces:**
- Produces: `packetStore.record(p: RawPacket, keep: number): void`, `packetStore.recent(limit: number): RawPacket[]`, `packetStore.clear(): void`. `record` inserts then prunes to `keep` (skips entirely when `keep <= 0`). `recent` returns oldest→newest.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/main/storagePackets.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';

// packetStore uses openDb() → a real on-disk sqlite file. Point userDataDir at a
// fresh temp dir per test run so we exercise the real DDL + statements.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'cs-packets-'));
vi.mock('../../../src/main/runtime/userData', () => ({ userDataDir: () => dir }));

import type { RawPacket } from '../../../src/shared/types';
import { closeDb } from '../../../src/main/storage/db';
import { packetStore } from '../../../src/main/storage/packets';

const mk = (ts: number): RawPacket => ({
  timestamp: ts,
  transportType: 'ble',
  kind: 'mesh',
  hex: '88',
  bytes: [0x88],
  payloadHex: '1501782abbcc',
  payloadBytes: [0x15, 0x01, 0x78, 0x2a, 0xbb, 0xcc],
  snr: 5,
  rssi: -80,
});

afterEach(() => {
  packetStore.clear();
});

describe('packetStore', () => {
  it('records and returns packets oldest→newest', () => {
    packetStore.record(mk(1000), 100);
    packetStore.record(mk(2000), 100);
    const rows = packetStore.recent(10);
    expect(rows.map((r) => r.timestamp)).toEqual([1000, 2000]);
    expect(rows[0].payloadBytes).toEqual([0x15, 0x01, 0x78, 0x2a, 0xbb, 0xcc]);
  });

  it('prunes to the keep cap, retaining the newest', () => {
    for (let i = 0; i < 5; i++) packetStore.record(mk(i + 1), 3);
    const rows = packetStore.recent(100);
    expect(rows.map((r) => r.timestamp)).toEqual([3, 4, 5]);
  });

  it('skips persistence when keep <= 0', () => {
    packetStore.record(mk(1), 0);
    expect(packetStore.recent(10)).toEqual([]);
  });

  it('clear empties the table', () => {
    packetStore.record(mk(1), 100);
    packetStore.clear();
    expect(packetStore.recent(10)).toEqual([]);
  });
});

// keep closeDb referenced so the import isn't tree-shaken in strict builds
void closeDb;
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run --project unit tests/unit/main/storagePackets.test.ts`
Expected: FAIL — `Cannot find module '.../storage/packets'`.

- [ ] **Step 3: Add the table DDL**

In `src/main/storage/db.ts`, inside the existing `db.exec(\`…\`)` template (after the `discovered_by_on_radio` index line), add:

```sql
    CREATE TABLE IF NOT EXISTS packets (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      ts          INTEGER NOT NULL,
      transport   TEXT    NOT NULL,
      kind        TEXT    NOT NULL,
      hex         TEXT    NOT NULL,
      payload_hex TEXT    NOT NULL,
      snr         REAL,
      rssi        REAL,
      code        INTEGER,
      code_name   TEXT
    );
    CREATE INDEX IF NOT EXISTS packets_by_ts ON packets (ts);
```

- [ ] **Step 4: Write the storage module**

Create `src/main/storage/packets.ts`:

```ts
import type { RawPacket } from '../../shared/types';
import { openDb } from './db';

// Re-derive byte arrays from hex on read so we don't store them twice.
function hexToBytes(hex: string): number[] {
  const out: number[] = [];
  for (let i = 0; i + 1 < hex.length; i += 2) out.push(parseInt(hex.slice(i, i + 2), 16));
  return out;
}

// Prune runs on a modulo so we don't DELETE on every insert.
let sinceLastPrune = 0;
const PRUNE_EVERY = 200;

export const packetStore = {
  /** Persist a packet, then prune to the newest `keep`. `keep <= 0` disables persistence. */
  record(p: RawPacket, keep: number): void {
    if (keep <= 0) return;
    const db = openDb();
    db.prepare(
      `INSERT INTO packets (ts, transport, kind, hex, payload_hex, snr, rssi, code, code_name)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      p.timestamp,
      p.transportType,
      p.kind,
      p.hex,
      p.payloadHex,
      p.snr ?? null,
      p.rssi ?? null,
      p.code ?? null,
      p.codeName ?? null,
    );
    if (++sinceLastPrune >= PRUNE_EVERY) {
      sinceLastPrune = 0;
      this.prune(keep);
    }
  },

  prune(keep: number): void {
    if (keep <= 0) {
      this.clear();
      return;
    }
    openDb()
      .prepare(`DELETE FROM packets WHERE id <= (SELECT MAX(id) FROM packets) - ?`)
      .run(keep);
  },

  /** Newest `limit` rows, returned oldest→newest so the live list appends in order. */
  recent(limit: number): RawPacket[] {
    if (limit <= 0) return [];
    const rows = openDb()
      .prepare(
        `SELECT ts, transport, kind, hex, payload_hex, snr, rssi, code, code_name
         FROM packets ORDER BY id DESC LIMIT ?`,
      )
      .all(limit) as Array<{
      ts: number;
      transport: string;
      kind: string;
      hex: string;
      payload_hex: string;
      snr: number | null;
      rssi: number | null;
      code: number | null;
      code_name: string | null;
    }>;
    return rows.reverse().map((r) => ({
      timestamp: r.ts,
      transportType: r.transport as RawPacket['transportType'],
      kind: r.kind as RawPacket['kind'],
      hex: r.hex,
      bytes: hexToBytes(r.hex),
      payloadHex: r.payload_hex,
      payloadBytes: hexToBytes(r.payload_hex),
      ...(r.snr != null ? { snr: r.snr } : {}),
      ...(r.rssi != null ? { rssi: r.rssi } : {}),
      ...(r.code != null ? { code: r.code } : {}),
      ...(r.code_name != null ? { codeName: r.code_name } : {}),
    }));
  },

  clear(): void {
    openDb().prepare('DELETE FROM packets').run();
  },
};
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm exec vitest run --project unit tests/unit/main/storagePackets.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add src/main/storage/db.ts src/main/storage/packets.ts tests/unit/main/storagePackets.test.ts
git commit -m "feat(packetlog): persist packets in a SQLite table

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Shared types — retention settings, filter migration, snapshot field

**Files:**
- Modify: `src/shared/types.ts` (`UiState` ~761-806, `DEFAULT_UI_STATE` ~808-838, `StateSnapshot` ~840)
- Test: `tests/unit/main/storagePackets.test.ts` already green; this task is type-only + verified by `pnpm typecheck`.

**Interfaces:**
- Produces: `UiState.packetLog: { liveBufferSize: number; storedHistorySize: number }`, `UiState.packetLogFilter: { source: 'both' | 'rf' | 'ble' }`, `UiState.decoderOpen: boolean`, `StateSnapshot.packets: RawPacket[]`, `DEFAULT_PACKET_LOG_SETTINGS`.

- [ ] **Step 1: Edit `UiState`**

In `src/shared/types.ts`, replace the `packetLogFilter` line and add fields:

```ts
  // Packet log source filter: RF (mesh) packets, BLE/companion frames, or both.
  packetLogFilter: { source: 'both' | 'rf' | 'ble' };
  // Packet log retention. liveBufferSize = packets kept in memory / shown.
  // storedHistorySize = packets persisted on disk (0 = off).
  packetLog: { liveBufferSize: number; storedHistorySize: number };
  // Whether the standalone packet-decoder dialog is open.
  decoderOpen: boolean;
```

- [ ] **Step 2: Add the settings default constant + edit `DEFAULT_UI_STATE`**

Add above `DEFAULT_UI_STATE`:

```ts
export const PACKET_LOG_BOUNDS = {
  liveBufferSize: { min: 200, max: 20_000 },
  storedHistorySize: { min: 0, max: 200_000 },
} as const;

export const DEFAULT_PACKET_LOG_SETTINGS = { liveBufferSize: 2_000, storedHistorySize: 20_000 };
```

In `DEFAULT_UI_STATE`, replace `packetLogFilter: { showCompanion: false },` with:

```ts
  packetLogFilter: { source: 'both' },
  packetLog: { ...DEFAULT_PACKET_LOG_SETTINGS },
  decoderOpen: false,
```

- [ ] **Step 3: Add `packets` to `StateSnapshot`**

In the `StateSnapshot` interface, after `blockRules: BlockRule[];` add:

```ts
  /** Newest persisted packets (min(liveBufferSize, storedHistorySize)), oldest→newest. */
  packets: RawPacket[];
```

- [ ] **Step 4: Verify typecheck fails where consumers still use old shapes**

Run: `pnpm typecheck`
Expected: errors in `PacketLog.tsx` (`packetLogFilter.showCompanion`), the snapshot handler (`routes.ts` missing `packets`), and `hydrate`/store. These are fixed in later tasks; this step just confirms the type changes landed. (Do NOT commit yet — commit with Task 3 to keep the tree compiling.)

---

## Task 3: Store — packet identity, selection, retention, hydrate, migration

**Files:**
- Modify: `src/renderer/lib/store.ts`
- Test: `tests/unit/renderer/lib/packetLogStore.test.ts`

**Interfaces:**
- Consumes: `UiState.packetLog`, `StateSnapshot.packets` (Task 2).
- Produces: exported `type LivePacket = RawPacket & { id: string }`; store fields `packets: LivePacket[]`, `selectedPacketId: string | null`; actions `setSelectedPacket(id: string | null)`, `setPacketLogSettings(patch: Partial<UiState['packetLog']>)`, `setDecoderOpen(open: boolean)`; `applyPacket`/`hydrate`/`clearPackets` updated; `migratePacketLogFilter(ui)` exported helper.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/renderer/lib/packetLogStore.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_UI_STATE } from '../../../../src/shared/types';
import { migratePacketLogFilter, useStore } from '../../../../src/renderer/lib/store';

const reset = () => useStore.setState({ packets: [], selectedPacketId: null, ui: structuredClone(DEFAULT_UI_STATE) });

beforeEach(reset);

describe('packet log store', () => {
  it('assigns a stable unique id to each applied packet', () => {
    const p = { timestamp: 1, transportType: 'ble', kind: 'mesh', hex: '88', bytes: [0x88], payloadHex: '15', payloadBytes: [0x15] } as const;
    useStore.getState().applyPacket({ ...p });
    useStore.getState().applyPacket({ ...p });
    const ids = useStore.getState().packets.map((x) => x.id);
    expect(new Set(ids).size).toBe(2);
  });

  it('caps the live buffer at liveBufferSize', () => {
    useStore.getState().setPacketLogSettings({ liveBufferSize: 3 });
    for (let i = 0; i < 6; i++)
      useStore.getState().applyPacket({ timestamp: i, transportType: 'ble', kind: 'mesh', hex: '88', bytes: [], payloadHex: '', payloadBytes: [] });
    expect(useStore.getState().packets).toHaveLength(3);
  });

  it('trims the buffer immediately when liveBufferSize decreases', () => {
    for (let i = 0; i < 5; i++)
      useStore.getState().applyPacket({ timestamp: i, transportType: 'ble', kind: 'mesh', hex: '88', bytes: [], payloadHex: '', payloadBytes: [] });
    useStore.getState().setPacketLogSettings({ liveBufferSize: 2 });
    expect(useStore.getState().packets).toHaveLength(2);
    expect(useStore.getState().packets.map((p) => p.timestamp)).toEqual([3, 4]);
  });

  it('migrates a legacy showCompanion filter to a source', () => {
    expect(migratePacketLogFilter({ showCompanion: true }).source).toBe('both');
    expect(migratePacketLogFilter({ showCompanion: false }).source).toBe('rf');
    expect(migratePacketLogFilter({ source: 'ble' }).source).toBe('ble');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run --project unit tests/unit/renderer/lib/packetLogStore.test.ts`
Expected: FAIL — `migratePacketLogFilter` / `setPacketLogSettings` not exported.

- [ ] **Step 3: Add the `LivePacket` type + id counter**

Near the top of `src/renderer/lib/store.ts` (after imports, by `const MAX_PACKETS = 500;` — **delete that line**), add:

```ts
export type LivePacket = RawPacket & { id: string };

// Monotonic id for live + hydrated packets so list keys and selection never
// collide regardless of source. Not persisted; a reload restarts the counter
// and re-ids the hydrated set.
let packetSeq = 0;
const nextPacketId = () => `pkt-${packetSeq++}`;

/** Back-compat: older ui-state.json stored { showCompanion }. */
export function migratePacketLogFilter(f: unknown): { source: 'both' | 'rf' | 'ble' } {
  if (f && typeof f === 'object' && 'source' in f) return { source: (f as { source: 'both' | 'rf' | 'ble' }).source };
  if (f && typeof f === 'object' && 'showCompanion' in f)
    return { source: (f as { showCompanion: boolean }).showCompanion ? 'both' : 'rf' };
  return { source: 'both' };
}
```

- [ ] **Step 4: Change the `packets` field type + selection field**

- In the `CoreState` interface, change `packets: RawPacket[];` → `packets: LivePacket[];`.
- Below the `selectedMessageId` field (`store.ts:307-309`), add:

```ts
  // ID of the packet currently inspected in the right rail. Cleared on nav.
  selectedPacketId: string | null;
```

- In the `create()` initializer, after `selectedMessageId: null,` (line 556) add `selectedPacketId: null,`.
- In the `CoreState` interface method block, add declarations:

```ts
  setSelectedPacket: (id: string | null) => void;
  setPacketLogSettings: (patch: Partial<UiState['packetLog']>) => void;
  setDecoderOpen: (open: boolean) => void;
```

- [ ] **Step 5: Rewrite `applyPacket`, add the new actions, update `clearPackets` + `hydrate` + nav**

Replace the `applyPacket` action (`store.ts:602-606`) with:

```ts
  applyPacket: (p) =>
    set((s) => {
      const cap = s.ui.packetLog.liveBufferSize;
      const withId: LivePacket = { ...p, id: nextPacketId() };
      const base = s.packets.length >= cap ? s.packets.slice(-(cap - 1)) : s.packets;
      return { packets: [...base, withId] };
    }),
```

Add near the other selection actions (by `setSelectedMessage`, `store.ts:838`):

```ts
  setSelectedPacket: (id) => set(() => ({ selectedPacketId: id })),
  setPacketLogSettings: (patch) =>
    set((s) => {
      const packetLog = { ...s.ui.packetLog, ...patch };
      const cap = packetLog.liveBufferSize;
      const packets = s.packets.length > cap ? s.packets.slice(-cap) : s.packets;
      return { ui: { ...s.ui, packetLog }, packets };
    }),
  setDecoderOpen: (open) => set((s) => ({ ui: { ...s.ui, decoderOpen: open } })),
```

In `hydrate` (`store.ts` ~567), add — inside the `set(() => ({ … }))` object — a `packets` seed after `ui: snapshot.uiState,`:

```ts
      packets: (snapshot.packets ?? []).map((p) => ({ ...p, id: nextPacketId() })),
```

In `navStateUpdate` (`store.ts:462-484`), add `selectedPacketId: null,` next to `selectedMessageId: null,` in the returned `out` object.

`clearPackets` (`store.ts:917`) stays `() => set(() => ({ packets: [] }))` (the DB clear is wired in Task 12's action).

- [ ] **Step 6: Migrate the persisted filter on hydrate**

Still in `hydrate`, change `ui: snapshot.uiState,` to normalize the legacy filter:

```ts
      ui: { ...snapshot.uiState, packetLogFilter: migratePacketLogFilter(snapshot.uiState.packetLogFilter) },
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `pnpm exec vitest run --project unit tests/unit/renderer/lib/packetLogStore.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 8: Commit (types + store together so the tree compiles)**

```bash
git add src/shared/types.ts src/renderer/lib/store.ts tests/unit/renderer/lib/packetLogStore.test.ts
git commit -m "feat(packetlog): live-packet ids, selection, tunable retention in store

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Wire persistence + snapshot hydration + clear endpoint (main)

**Files:**
- Modify: `src/main/server.ts` (`onPacket` line 190; add `stateHolder` + `packetStore` imports)
- Modify: `src/main/api/routes.ts` (snapshot handler ~84-121; add a clear route)
- Modify: `src/renderer/lib/api.ts` (add `clearPackets`)
- Test: `tests/unit/main/storagePackets.test.ts` (extend with a snapshot-limit helper) — or verify via `pnpm typecheck` + the app-drive in Task 15.

**Interfaces:**
- Consumes: `packetStore` (Task 1), `StateSnapshot.packets` + `UiState.packetLog` (Task 2), `stateHolder().getUiState()`.
- Produces: `POST /api/packets/clear`; `api.clearPackets(c: ApiClient): Promise<{ ok: true }>`.

- [ ] **Step 1: Persist on every packet**

In `src/main/server.ts`, add imports (near the other `../storage`/`../state` imports):

```ts
import { stateHolder } from './state/holder';
import { packetStore } from './storage/packets';
```

Replace `const onPacket = (p: RawPacket) => broadcast({ type: 'packet', payload: p });` (line 190) with:

```ts
  const onPacket = (p: RawPacket) => {
    packetStore.record(p, stateHolder().getUiState().packetLog.storedHistorySize);
    broadcast({ type: 'packet', payload: p });
  };
```

(If `stateHolder` is already imported in server.ts, don't duplicate the import.)

- [ ] **Step 2: Include packets in the snapshot**

In `src/main/api/routes.ts`, add the import:

```ts
import { packetStore } from '../storage/packets';
```

In the `/api/state/snapshot` handler, add to the `payload` object (after `blockRules: holder.getBlockRules(),`):

```ts
      packets: packetStore.recent(
        Math.min(holder.getUiState().packetLog.liveBufferSize, holder.getUiState().packetLog.storedHistorySize),
      ),
```

- [ ] **Step 3: Add the clear route**

In `src/main/api/routes.ts`, near the other `api.get`/`api.post` routes, add:

```ts
  api.post('/api/packets/clear', (c) => {
    packetStore.clear();
    return c.json({ ok: true } as const);
  });
```

- [ ] **Step 4: Add the renderer API method**

In `src/renderer/lib/api.ts`, add alongside the other methods (mirror `putUiState`'s shape):

```ts
  clearPackets: (c: ApiClient) => request<{ ok: true }>(c, '/api/packets/clear', { method: 'POST' }),
```

- [ ] **Step 5: Verify typecheck passes**

Run: `pnpm typecheck`
Expected: PASS (the snapshot payload now satisfies `StateSnapshot`; `hydrate` reads `snapshot.packets`).

- [ ] **Step 6: Commit**

```bash
git add src/main/server.ts src/main/api/routes.ts src/renderer/lib/api.ts
git commit -m "feat(packetlog): persist packets + hydrate via snapshot, add clear route

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Decode adapter — packet + payload byte breakdown

**Files:**
- Create: `src/renderer/lib/packetInspect.ts`
- Create: `tests/support/packetFixtures.ts`
- Test: `tests/unit/renderer/lib/packetInspect.test.ts`

**Interfaces:**
- Produces: types `InspectField`, `BitRow`, `Secondary`, `PacketInspection`; `inspectPacket(hex: string, opts?: { keyStore?: CryptoKeyStore }): PacketInspection`; helper `buildPlaintextFields(timestamp: number, flags: number, message: string): { bytes: number[]; fields: InspectField[] }` (used by Task 6). `InspectField = { key: string; name: string; start: number; end: number; colorIdx: number; value: string; desc?: string; bits?: BitRow[] }`.

- [ ] **Step 1: Write the fixtures**

Create `tests/support/packetFixtures.ts` (hand-built wire-format hex; comments show the byte layout):

```ts
// Header byte = (version<<6)|(payloadType<<2)|routeType. Route Flood=1, Direct=2.
// PayloadType: TextMessage=2, Ack=3, Advert=4, GroupText=5.

// Flood GroupText, 1 hop. header 0x15 (v0,ptype5,route1) · pathlen 0x01 · path '78'
// · payload: channelHash 2a · mac bbcc · ciphertext 00112233
export const GROUP_TEXT_HEX = '1501782abbcc00112233';

// Direct TextMessage, 0 hops. header 0x0a (v0,ptype2,route2) · pathlen 0x00
// · payload: destHash cb · srcHash e3 · mac 1122 · ciphertext aabbccdd
export const TEXT_MESSAGE_HEX = '0a00cbe31122aabbccdd';

// Direct Ack, 0 hops. header 0x0e (v0,ptype3,route2) · pathlen 0x00 · payload: 4-byte crc
export const ACK_HEX = '0e00deadbeef';
```

(These are minimal but wire-valid; the decoder parses header/path-len/path/payload structurally regardless of ciphertext content.)

- [ ] **Step 2: Write the failing test**

Create `tests/unit/renderer/lib/packetInspect.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { inspectPacket } from '../../../../src/renderer/lib/packetInspect';
import { ACK_HEX, GROUP_TEXT_HEX } from '../../../support/packetFixtures';

describe('inspectPacket', () => {
  it('decodes packet-level fields with contiguous byte coverage', () => {
    const r = inspectPacket(GROUP_TEXT_HEX);
    expect(r.ok).toBe(true);
    expect(r.size).toBe(10);
    expect(r.payloadTypeName).toBe('Group Text');
    expect(r.routeName).toBe('Flood');
    // Header is byte 0 and carries a bit table (route/payload/version).
    expect(r.fields[0].start).toBe(0);
    expect(r.fields[0].end).toBe(0);
    expect(r.fields[0].bits?.some((b) => /route/i.test(b.field))).toBe(true);
    // Path-length byte is index 1 and gets a computed bit table (hop count + hash size).
    const pathLen = r.fields.find((f) => f.start === 1 && f.end === 1);
    expect(pathLen?.bits?.some((b) => /hop/i.test(b.field))).toBe(true);
    // Coverage is contiguous 0..size-1.
    const covered = new Set<number>();
    for (const f of r.fields) for (let i = f.start; i <= f.end; i++) covered.add(i);
    expect(covered.size).toBe(r.size);
    // Each colorIdx is in range.
    expect(r.fields.every((f) => f.colorIdx >= 0 && f.colorIdx < 7)).toBe(true);
  });

  it('exposes a normalized payload breakdown starting at byte 0', () => {
    const r = inspectPacket(GROUP_TEXT_HEX);
    expect(r.payload).not.toBeNull();
    const pf = r.payload!.fields;
    expect(pf[0].start).toBe(0);
    const last = pf[pf.length - 1];
    expect(last.end).toBe(r.payload!.bytes.length - 1);
  });

  it('returns ok:false for junk input instead of throwing', () => {
    const r = inspectPacket('zz');
    expect(r.ok).toBe(false);
  });

  it('handles a payload with no sub-structure (Ack) without crashing', () => {
    const r = inspectPacket(ACK_HEX);
    expect(r.ok).toBe(true);
    expect(r.payloadTypeName).toBe('Ack');
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm exec vitest run --project unit tests/unit/renderer/lib/packetInspect.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement the adapter core**

Create `src/renderer/lib/packetInspect.ts`:

```ts
import {
  type CryptoKeyStore,
  MeshCoreDecoder,
  type PacketStructure,
  PayloadType,
  type RouteType,
  Utils,
} from '@michaelhart/meshcore-decoder';

export interface BitRow {
  range: string;
  field: string;
  value: string;
  binary: string;
}

export interface InspectField {
  key: string;
  name: string;
  start: number; // byte index within this strip (0-based, inclusive)
  end: number;
  colorIdx: number; // 0..6 → --cs-field0..6
  value: string;
  desc?: string;
  bits?: BitRow[];
}

export type Secondary =
  | { kind: 'decrypted'; available: true; bytes: number[]; fields: InspectField[] }
  | { kind: 'appdata'; available: true; title: string; bytes: number[]; fields: InspectField[] }
  | { kind: 'encrypted'; available: false; note: string };

export interface PacketInspection {
  ok: boolean;
  size: number;
  bytes: number[];
  routeName: string;
  payloadTypeName: string;
  hashFull: string;
  hops: number;
  pathArrows: string | null;
  fields: InspectField[];
  payload: { typeName: string; bytes: number[]; fields: InspectField[]; secondary: Secondary | null } | null;
  lowConfidence?: string;
  error?: string;
}

const NUM_FIELD_COLORS = 7;
export const fieldColorIdx = (i: number) => ((i % NUM_FIELD_COLORS) + NUM_FIELD_COLORS) % NUM_FIELD_COLORS;

const hexToBytes = (hex: string): number[] => {
  const clean = hex.replace(/[^0-9a-fA-F]/g, '');
  const out: number[] = [];
  for (let i = 0; i + 1 < clean.length; i += 2) out.push(parseInt(clean.slice(i, i + 2), 16));
  return out;
};
const bin = (v: number, w: number) => (v >>> 0).toString(2).padStart(w, '0');

// path_len byte → hop-count + hash-size bit rows (the decoder only bit-breaks the header).
function pathLenBits(byte: number): BitRow[] {
  const hop = byte & 0b111111;
  const hashSel = (byte >> 6) & 0b11;
  return [
    { range: '6-7', field: 'Hash Size', value: `${hashSel + 1} byte(s)/hop`, binary: bin(hashSel, 2) },
    { range: '0-5', field: 'Hop Count', value: `${hop} hop${hop === 1 ? '' : 's'}`, binary: bin(hop, 6) },
  ];
}

export function buildPlaintextFields(timestamp: number, flags: number, message: string): { bytes: number[]; fields: InspectField[] } {
  const ts: number[] = [];
  let t = timestamp >>> 0;
  for (let i = 0; i < 4; i++) {
    ts.push(t & 0xff);
    t = Math.floor(t / 256);
  }
  const msg = Array.from(new TextEncoder().encode(message));
  const bytes = [...ts, flags & 0xff, ...msg];
  const fields: InspectField[] = [
    { key: 'pts', name: 'Timestamp', start: 0, end: 3, colorIdx: 0, value: bytesHex(ts, 0, 3), desc: 'Sender clock (unix, little-endian).' },
    { key: 'pfl', name: 'Flags', start: 4, end: 4, colorIdx: 1, value: bytesHex([flags & 0xff], 0, 0), desc: `0x${(flags & 0xff).toString(16).padStart(2, '0')}` },
  ];
  if (msg.length) fields.push({ key: 'ptx', name: 'Message', start: 5, end: bytes.length - 1, colorIdx: 2, value: message, desc: 'Decoded UTF-8 text.' });
  return { bytes, fields };
}

const bytesHex = (b: number[], a: number, z: number) => {
  let s = '';
  for (let i = a; i <= z && i < b.length; i++) s += b[i].toString(16).padStart(2, '0');
  return s.toUpperCase();
};

// Payload segment offsets may be absolute (whole-packet) or already payload-relative;
// normalize to a 0-based strip.
function normalize(start: number, payloadStart: number): number {
  return start >= payloadStart ? start - payloadStart : start;
}

export function inspectPacket(hex: string, opts?: { keyStore?: CryptoKeyStore }): PacketInspection {
  const options = opts?.keyStore ? { keyStore: opts.keyStore, attemptDecryption: true, includeRawCiphertext: true } : undefined;
  try {
    const struct: PacketStructure = MeshCoreDecoder.analyzeStructure(hex, options);
    const decoded = MeshCoreDecoder.decode(hex, options);
    const bytes = hexToBytes(struct.rawHex);

    const fields: InspectField[] = struct.segments.map((seg, i) => {
      const bits = seg.headerBreakdown
        ? seg.headerBreakdown.fields.map((f) => ({ range: f.bits, field: f.field, value: f.value, binary: f.binary }))
        : seg.startByte === 1 && seg.endByte === 1
          ? pathLenBits(bytes[1] ?? 0)
          : undefined;
      return {
        key: `pk${i}`,
        name: seg.name,
        start: seg.startByte,
        end: seg.endByte,
        colorIdx: fieldColorIdx(i),
        value: seg.value,
        desc: seg.description || undefined,
        bits,
      };
    });

    const pStart = struct.payload.startByte;
    const payloadBytes = hexToBytes(struct.payload.hex);
    const payloadFields: InspectField[] = struct.payload.segments.map((seg, i) => ({
      key: `pl${i}`,
      name: seg.name,
      start: normalize(seg.startByte, pStart),
      end: normalize(seg.endByte, pStart),
      colorIdx: fieldColorIdx(i),
      value: seg.value,
      desc: seg.description || undefined,
    }));

    return {
      ok: decoded.isValid,
      size: struct.totalBytes,
      bytes,
      routeName: Utils.getRouteTypeName(decoded.routeType as RouteType),
      payloadTypeName: Utils.getPayloadTypeName(decoded.payloadType as PayloadType),
      hashFull: struct.messageHash,
      hops: decoded.pathLength,
      pathArrows: decoded.path && decoded.path.length ? decoded.path.join(' → ') : null,
      fields,
      payload: payloadBytes.length
        ? { typeName: Utils.getPayloadTypeName(decoded.payloadType as PayloadType), bytes: payloadBytes, fields: payloadFields, secondary: secondaryFor(decoded) }
        : null,
      ...(decoded.isValid ? {} : { lowConfidence: decoded.errors?.[0] ?? 'Decoder reported an invalid packet.' }),
    };
  } catch (err) {
    return {
      ok: false,
      size: 0,
      bytes: [],
      routeName: '?',
      payloadTypeName: 'invalid',
      hashFull: '',
      hops: 0,
      pathArrows: null,
      fields: [],
      payload: null,
      error: (err as Error).message,
    };
  }
}

// Filled in by Task 6.
function secondaryFor(_decoded: ReturnType<typeof MeshCoreDecoder.decode>): Secondary | null {
  return null;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm exec vitest run --project unit tests/unit/renderer/lib/packetInspect.test.ts`
Expected: PASS (4 tests). If the payload-offset test fails because segment offsets are already payload-relative, the `normalize()` guard already handles both — re-check the fixture byte math.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/lib/packetInspect.ts tests/support/packetFixtures.ts tests/unit/renderer/lib/packetInspect.test.ts
git commit -m "feat(packetlog): decode adapter for packet + payload byte breakdown

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Decode adapter — decrypt / advert / lock-note secondary

**Files:**
- Modify: `src/renderer/lib/packetInspect.ts` (`secondaryFor`)
- Test: `tests/unit/renderer/lib/packetInspect.test.ts` (extend)

**Interfaces:**
- Consumes: `MeshCoreDecoder.decode` typed payloads (`GroupTextPayload.decrypted`, `AdvertPayload.appData`), `buildPlaintextFields` (Task 5).
- Produces: `secondaryFor` returns a `Secondary` for GroupText/GroupData (decrypted or channel lock note), DM types (lock note), Advert (appdata), else `null`.

- [ ] **Step 1: Write the failing test (extend the file)**

Append to `tests/unit/renderer/lib/packetInspect.test.ts`:

```ts
import { buildPlaintextFields } from '../../../../src/renderer/lib/packetInspect';
import { TEXT_MESSAGE_HEX } from '../../../support/packetFixtures';

describe('inspectPacket secondary sections', () => {
  it('marks a GroupText with no key as an unavailable channel lock note', () => {
    const r = inspectPacket(GROUP_TEXT_HEX); // no keyStore
    expect(r.payload?.secondary?.kind).toBe('encrypted');
    expect(r.payload?.secondary && 'available' in r.payload.secondary && r.payload.secondary.available).toBe(false);
  });

  it('marks a DM (TextMessage) as an unavailable "not addressed to us" note', () => {
    const r = inspectPacket(TEXT_MESSAGE_HEX);
    expect(r.payload?.secondary?.kind).toBe('encrypted');
  });

  it('builds a plaintext strip: timestamp(4) · flags(1) · message', () => {
    const { bytes, fields } = buildPlaintextFields(0x01020304, 0x00, 'hi');
    expect(bytes.slice(0, 4)).toEqual([0x04, 0x03, 0x02, 0x01]); // little-endian
    expect(fields.map((f) => [f.start, f.end])).toEqual([[0, 3], [4, 4], [5, 6]]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run --project unit tests/unit/renderer/lib/packetInspect.test.ts`
Expected: FAIL — secondary is `null` (Task 5 stub).

- [ ] **Step 3: Implement `secondaryFor`**

In `src/renderer/lib/packetInspect.ts`, add the payload-type imports to the existing `@michaelhart/meshcore-decoder` import (`PayloadType` is already imported as a value from Task 5 — do **not** re-import it):

```ts
import type { AdvertPayload, GroupTextPayload } from '@michaelhart/meshcore-decoder';
```

```ts
const CHANNEL_LOCK = "No key for this channel — can't decrypt. Add the channel (with its secret) to decode the message.";
const DM_LOCK = "This message isn't addressed to us — no shared secret to decrypt.";

function secondaryFor(decoded: ReturnType<typeof MeshCoreDecoder.decode>): Secondary | null {
  const d = decoded.payload.decoded;
  switch (decoded.payloadType as PayloadType) {
    case PayloadType.GroupText:
    case PayloadType.GroupData: {
      const g = d as GroupTextPayload | null;
      if (g?.decrypted) {
        const { bytes, fields } = buildPlaintextFields(g.decrypted.timestamp, g.decrypted.flags, g.decrypted.message);
        return { kind: 'decrypted', available: true, bytes, fields };
      }
      return { kind: 'encrypted', available: false, note: CHANNEL_LOCK };
    }
    case PayloadType.TextMessage:
    case PayloadType.Request:
    case PayloadType.Response:
    case PayloadType.AnonRequest:
      return { kind: 'encrypted', available: false, note: DM_LOCK };
    case PayloadType.Advert:
      return advertAppData(d as AdvertPayload | null);
    default:
      return null;
  }
}

function advertAppData(a: AdvertPayload | null): Secondary | null {
  if (!a) return null;
  const hasLoc = a.appData.hasLocation && a.appData.location;
  const fields: InspectField[] = [
    { key: 'aflags', name: 'Flags', start: 0, end: 0, colorIdx: 0, value: a.appData.flags.toString(16).padStart(2, '0').toUpperCase(), desc: `${hasLoc ? 'has location' : 'no location'}${a.appData.hasName ? ' · has name' : ''}` },
  ];
  let p = 1;
  const bytes = [a.appData.flags & 0xff];
  if (hasLoc && a.appData.location) {
    fields.push({ key: 'alat', name: 'Latitude', start: p, end: p + 3, colorIdx: 1, value: `${a.appData.location.latitude}`, desc: 'int32 / 1e6' });
    fields.push({ key: 'alon', name: 'Longitude', start: p + 4, end: p + 7, colorIdx: 2, value: `${a.appData.location.longitude}`, desc: 'int32 / 1e6' });
    for (let i = 0; i < 8; i++) bytes.push(0);
    p += 8;
  }
  if (a.appData.name) {
    const nm = Array.from(new TextEncoder().encode(a.appData.name));
    fields.push({ key: 'aname', name: 'Node Name', start: p, end: p + nm.length - 1, colorIdx: 3, value: a.appData.name, desc: 'UTF-8' });
    bytes.push(...nm);
  }
  return { kind: 'appdata', available: true, title: 'Advert App-Data', bytes, fields };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm exec vitest run --project unit tests/unit/renderer/lib/packetInspect.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/lib/packetInspect.ts tests/unit/renderer/lib/packetInspect.test.ts
git commit -m "feat(packetlog): decrypt / advert / lock-note secondary sections

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: BLE companion-frame layouts + `inspectBleFrame`

**Files:**
- Create: `src/renderer/lib/bleFrameLayouts.ts`
- Test: `tests/unit/renderer/lib/bleFrameLayouts.test.ts`

**Interfaces:**
- Produces: `inspectBleFrame(payloadHex: string, codeName?: string): { codeName: string; fields: InspectField[]; bytes: number[] }` — walks a per-`codeName` layout table with a cursor, assigning offsets. Unknown codes → single "Body" field.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/renderer/lib/bleFrameLayouts.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { inspectBleFrame } from '../../../../src/renderer/lib/bleFrameLayouts';

describe('inspectBleFrame', () => {
  it('lays out a known channel-message frame by field', () => {
    // chash(1)=2a · pathType(1)=01 · ts(4) · text "hi"
    const r = inspectBleFrame('2a01aabbccdd6869', 'RESP_CHANNEL_MSG_RECV');
    expect(r.fields[0].start).toBe(0);
    expect(r.fields[0].end).toBe(0);
    // the text field runs to the end
    expect(r.fields[r.fields.length - 1].end).toBe(r.bytes.length - 1);
  });

  it('falls back to a single Body field for an unknown code', () => {
    const r = inspectBleFrame('deadbeef', 'RESP_MYSTERY');
    expect(r.fields).toHaveLength(1);
    expect(r.fields[0].start).toBe(0);
    expect(r.fields[0].end).toBe(3);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run --project unit tests/unit/renderer/lib/bleFrameLayouts.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/renderer/lib/bleFrameLayouts.ts`:

```ts
import { type InspectField, fieldColorIdx } from './packetInspect';

interface Seg {
  key: string;
  name: string;
  len: number | 'rest';
  desc?: string;
}

// Firmware-version-specific. codeName values come from main's companionFrame.ts
// (PUSH_NAMES / RESP_NAMES). Extend as new frames need breakdowns.
const LAYOUTS: Record<string, Seg[]> = {
  RESP_CHANNEL_MSG_RECV: [
    { key: 'chash', name: 'Channel Hash', len: 1, desc: 'Which channel the message arrived on.' },
    { key: 'ptype', name: 'Path Type', len: 1, desc: 'How it was routed.' },
    { key: 'txts', name: 'Sender Timestamp', len: 4, desc: 'Sender clock (unix, little-endian).' },
    { key: 'text', name: 'Text', len: 'rest', desc: 'UTF-8 "sender: message".' },
  ],
  RESP_CONTACT_MSG_RECV: [
    { key: 'pk', name: 'Public Key Prefix', len: 6, desc: 'First 6 bytes of the sender public key.' },
    { key: 'ptype', name: 'Path Type', len: 1, desc: 'Routing type.' },
    { key: 'txt', name: 'Text Type', len: 1, desc: 'Plain / CLI-data / signed.' },
    { key: 'txts', name: 'Sender Timestamp', len: 4, desc: 'Sender clock (unix, little-endian).' },
    { key: 'text', name: 'Text', len: 'rest', desc: 'UTF-8 message body.' },
  ],
  PUSH_ADVERT: [
    { key: 'pk', name: 'Public Key', len: 32, desc: 'Advertising node public key (32 B).' },
    { key: 'ts', name: 'Timestamp', len: 4, desc: 'Advert time (unix, little-endian).' },
    { key: 'rest', name: 'App Data', len: 'rest', desc: 'Flags, location, and name.' },
  ],
};

const hexToBytes = (hex: string): number[] => {
  const clean = hex.replace(/[^0-9a-fA-F]/g, '');
  const out: number[] = [];
  for (let i = 0; i + 1 < clean.length; i += 2) out.push(parseInt(clean.slice(i, i + 2), 16));
  return out;
};
const hx = (b: number[], a: number, z: number) => {
  let s = '';
  for (let i = a; i <= z && i < b.length; i++) s += b[i].toString(16).padStart(2, '0');
  return s.toUpperCase();
};

export function inspectBleFrame(payloadHex: string, codeName?: string): { codeName: string; fields: InspectField[]; bytes: number[] } {
  const bytes = hexToBytes(payloadHex);
  const last = bytes.length - 1;
  const layout = codeName ? LAYOUTS[codeName] : undefined;
  if (!layout) {
    return {
      codeName: codeName ?? 'frame',
      bytes,
      fields: bytes.length ? [{ key: 'body', name: 'Body', start: 0, end: last, colorIdx: 0, value: hx(bytes, 0, last), desc: 'Raw frame body.' }] : [],
    };
  }
  const fields: InspectField[] = [];
  let cursor = 0;
  layout.forEach((seg, i) => {
    if (cursor > last) return;
    const len = seg.len === 'rest' ? last - cursor + 1 : seg.len;
    const end = Math.min(cursor + len - 1, last);
    fields.push({ key: seg.key, name: seg.name, start: cursor, end, colorIdx: fieldColorIdx(i), value: hx(bytes, cursor, end), desc: seg.desc });
    cursor = end + 1;
  });
  return { codeName: codeName ?? 'frame', bytes, fields };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm exec vitest run --project unit tests/unit/renderer/lib/bleFrameLayouts.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/lib/bleFrameLayouts.ts tests/unit/renderer/lib/bleFrameLayouts.test.ts
git commit -m "feat(packetlog): BLE companion-frame byte layouts

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Input normalizer — hex / base64 / `meshcore://`

**Files:**
- Create: `src/renderer/lib/packetInput.ts`
- Test: `tests/unit/renderer/lib/packetInput.test.ts`

**Interfaces:**
- Produces: `normalizeToHex(input: string): { hex: string; kind: 'hex' | 'base64' | 'uri' } | null` — trims, strips a `meshcore://` prefix (hex payload), accepts spaced/newlined hex, else tries base64→hex; returns `null` when nothing decodes to ≥1 byte.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/renderer/lib/packetInput.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { normalizeToHex } from '../../../../src/renderer/lib/packetInput';

describe('normalizeToHex', () => {
  it('accepts spaced hex', () => {
    expect(normalizeToHex('15 01 78 2a')).toEqual({ hex: '1501782a', kind: 'hex' });
  });
  it('accepts a meshcore:// hex link', () => {
    expect(normalizeToHex('meshcore://1501782a')).toEqual({ hex: '1501782a', kind: 'uri' });
  });
  it('decodes base64', () => {
    // base64 of bytes [0x15,0x01,0x78,0x2a] = "FQF4Kg=="
    expect(normalizeToHex('FQF4Kg==')).toEqual({ hex: '1501782a', kind: 'base64' });
  });
  it('returns null for garbage', () => {
    expect(normalizeToHex('!!!')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run --project unit tests/unit/renderer/lib/packetInput.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/renderer/lib/packetInput.ts`:

```ts
export type PacketInputKind = 'hex' | 'base64' | 'uri';

const isHexBody = (s: string) => s.length >= 2 && s.length % 2 === 0 && /^[0-9a-f]+$/i.test(s);

export function normalizeToHex(raw: string): { hex: string; kind: PacketInputKind } | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // meshcore://<hex>
  if (/^meshcore:\/\//i.test(trimmed)) {
    const body = trimmed.replace(/^meshcore:\/\//i, '').trim();
    return isHexBody(body) ? { hex: body.toLowerCase(), kind: 'uri' } : null;
  }

  // spaced / newlined hex
  const compact = trimmed.replace(/[\s:,-]/g, '');
  if (isHexBody(compact)) return { hex: compact.toLowerCase(), kind: 'hex' };

  // base64 → hex
  try {
    const bin = atob(trimmed.replace(/\s/g, ''));
    if (bin.length < 1) return null;
    let hex = '';
    for (let i = 0; i < bin.length; i++) hex += bin.charCodeAt(i).toString(16).padStart(2, '0');
    return { hex, kind: 'base64' };
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm exec vitest run --project unit tests/unit/renderer/lib/packetInput.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/lib/packetInput.ts tests/unit/renderer/lib/packetInput.test.ts
git commit -m "feat(packetlog): auto-detect hex/base64/meshcore:// decoder input

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: Theme tokens — field / route / BLE colors (light + dark)

**Files:**
- Modify: `src/renderer/lib/theme.ts` (`Palette`, `DARK`, `LIGHT`)
- Modify: `src/renderer/index.css` (`:root` defaults + the second `@theme` block)
- Test: `tests/component/packet-theme.test.tsx`

**Interfaces:**
- Produces: CSS vars `--cs-field0`…`--cs-field6`, `--cs-route-direct`, `--cs-route-flood`, `--cs-ble` (written by `applyTheme`, defaulted dark in `:root`); Tailwind tokens `--color-cs-field0`… etc. so `text-cs-field0` / `bg-cs-field0/15` work.

- [ ] **Step 1: Write the failing test**

Create `tests/component/packet-theme.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest';
import { applyTheme } from '@/lib/theme';

describe('inspector theme tokens', () => {
  it('applyTheme writes field + route tokens for dark and light', () => {
    applyTheme('dark');
    const dark = getComputedStyle(document.documentElement).getPropertyValue('--cs-field0').trim();
    expect(dark.length).toBeGreaterThan(0);
    applyTheme('light');
    const light = getComputedStyle(document.documentElement).getPropertyValue('--cs-field0').trim();
    expect(light.length).toBeGreaterThan(0);
    expect(light).not.toBe(dark);
    expect(getComputedStyle(document.documentElement).getPropertyValue('--cs-route-direct').trim().length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run --project dom tests/component/packet-theme.test.tsx`
Expected: FAIL — `--cs-field0` empty.

- [ ] **Step 3: Extend the `Palette` interface + `DARK`/`LIGHT`**

In `src/renderer/lib/theme.ts`, add to the `Palette` interface:

```ts
  field0: string;
  field1: string;
  field2: string;
  field3: string;
  field4: string;
  field5: string;
  field6: string;
  routeDirect: string;
  routeFlood: string;
  ble: string;
```

Add to `DARK` (handoff palette as RGB triplets):

```ts
  field0: '232 163 61',
  field1: '110 161 230',
  field2: '155 207 90',
  field3: '229 140 110',
  field4: '70 183 174',
  field5: '185 138 224',
  field6: '212 180 74',
  routeDirect: '127 184 77',
  routeFlood: '110 161 230',
  ble: '185 138 224',
```

Add to `LIGHT` (darkened for contrast on the light surface):

```ts
  field0: '176 110 20',
  field1: '43 96 179',
  field2: '90 130 40',
  field3: '190 90 60',
  field4: '25 120 112',
  field5: '120 78 160',
  field6: '150 120 30',
  routeDirect: '78 130 40',
  routeFlood: '43 96 179',
  ble: '120 78 160',
```

(`applyTheme` already loops `Object.entries(palette)` → `--cs-<kebab(key)>`, so `field0`→`--cs-field0`, `routeDirect`→`--cs-route-direct`. No change to `applyTheme`.)

- [ ] **Step 4: Add `:root` dark defaults + Tailwind tokens in `index.css`**

In `src/renderer/index.css`, inside `:root { … }` (after `--cs-danger: 220 38 38;`), add:

```css
  --cs-field0: 232 163 61;
  --cs-field1: 110 161 230;
  --cs-field2: 155 207 90;
  --cs-field3: 229 140 110;
  --cs-field4: 70 183 174;
  --cs-field5: 185 138 224;
  --cs-field6: 212 180 74;
  --cs-route-direct: 127 184 77;
  --cs-route-flood: 110 161 230;
  --cs-ble: 185 138 224;
```

In the second `@theme { … }` block (the `--color-cs-*` one), add before `--font-sans`:

```css
  --color-cs-field0: rgb(var(--cs-field0));
  --color-cs-field1: rgb(var(--cs-field1));
  --color-cs-field2: rgb(var(--cs-field2));
  --color-cs-field3: rgb(var(--cs-field3));
  --color-cs-field4: rgb(var(--cs-field4));
  --color-cs-field5: rgb(var(--cs-field5));
  --color-cs-field6: rgb(var(--cs-field6));
  --color-cs-route-direct: rgb(var(--cs-route-direct));
  --color-cs-route-flood: rgb(var(--cs-route-flood));
  --color-cs-ble: rgb(var(--cs-ble));
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm exec vitest run --project dom tests/component/packet-theme.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/lib/theme.ts src/renderer/index.css tests/component/packet-theme.test.tsx
git commit -m "feat(packetlog): theme-aware field/route/BLE color tokens

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 10: Byte-level UI primitives — ByteStrip, FieldCard, BitTable, PacketBreakdown

**Files:**
- Create: `src/renderer/components/packet/ByteStrip.tsx`, `FieldCard.tsx`, `BitTable.tsx`, `PacketBreakdown.tsx`
- Test: `tests/component/packet-bytestrip.test.tsx`

**Interfaces:**
- Consumes: `InspectField` (Task 5).
- Produces:
  - `ByteStrip({ bytes, fields, scope, hovered, setHovered }: { bytes: number[]; fields: InspectField[]; scope: string; hovered: string | null; setHovered: (id: string | null) => void })`
  - `FieldCard({ field, scope, hovered, setHovered })`
  - `BitTable({ rows, colorVar }: { rows: BitRow[]; colorVar: string })`
  - `PacketBreakdown({ title, count, bytes, fields, scope, hovered, setHovered })` — section title + strip + stacked cards.
  - Field id convention: `` `${scope}:${field.key}` ``. Color: `` `rgb(var(--cs-field${field.colorIdx}))` `` via inline style + alpha with `color-mix`.

- [ ] **Step 1: Write the failing test**

Create `tests/component/packet-bytestrip.test.tsx`:

```tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { ByteStrip } from '@/components/packet/ByteStrip';
import type { InspectField } from '@/lib/packetInspect';

const fields: InspectField[] = [
  { key: 'header', name: 'Header', start: 0, end: 0, colorIdx: 0, value: '15' },
  { key: 'payload', name: 'Payload', start: 1, end: 2, colorIdx: 1, value: '012A' },
];

function Harness() {
  const [hovered, setHovered] = useState<string | null>(null);
  return (
    <div>
      <span data-testid="hovered">{hovered ?? 'none'}</span>
      <ByteStrip bytes={[0x15, 0x01, 0x2a]} fields={fields} scope="pk" hovered={hovered} setHovered={setHovered} />
    </div>
  );
}

describe('ByteStrip', () => {
  it('renders one cell per byte as uppercase hex pairs', () => {
    render(<Harness />);
    expect(screen.getByText('15')).toBeTruthy();
    expect(screen.getByText('2A')).toBeTruthy();
  });

  it('sets scoped hovered id on mouse enter', () => {
    render(<Harness />);
    fireEvent.mouseEnter(screen.getByText('15'));
    expect(screen.getByTestId('hovered').textContent).toBe('pk:header');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run --project dom tests/component/packet-bytestrip.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `ByteStrip.tsx`**

Create `src/renderer/components/packet/ByteStrip.tsx`:

```tsx
import { useMemo } from 'react';
import type { InspectField } from '../../lib/packetInspect';

const hx = (b: number) => b.toString(16).toUpperCase().padStart(2, '0');
const colorVar = (idx: number) => `rgb(var(--cs-field${idx}))`;

interface Props {
  bytes: number[];
  fields: InspectField[];
  scope: string;
  hovered: string | null;
  setHovered: (id: string | null) => void;
}

export function ByteStrip({ bytes, fields, scope, hovered, setHovered }: Props) {
  const map = useMemo(() => {
    const m: Array<{ key: string; colorIdx: number } | undefined> = [];
    for (const f of fields) for (let i = f.start; i <= f.end; i++) m[i] = { key: f.key, colorIdx: f.colorIdx };
    return m;
  }, [fields]);

  return (
    <div className="rounded-lg border border-cs-border bg-cs-bg-3/40 px-3 py-2.5 font-mono text-[12.5px] leading-8 tracking-wide break-all">
      {bytes.map((b, i) => {
        const info = map[i];
        const id = info ? `${scope}:${info.key}` : null;
        const color = info ? colorVar(info.colorIdx) : 'rgb(var(--cs-text-dim))';
        const active = id != null && hovered === id;
        const dimmed = hovered != null && id != null && hovered !== id;
        const prev = map[i - 1];
        const next = map[i + 1];
        const runStart = !prev || prev.key !== info?.key;
        const runEnd = !next || next.key !== info?.key;
        return (
          <span
            // biome-ignore lint/suspicious/noArrayIndexKey: byte position is the identity
            key={i}
            onMouseEnter={() => id && setHovered(id)}
            onMouseLeave={() => id && setHovered(null)}
            style={{
              background: active ? color : `color-mix(in srgb, ${color} ${dimmed ? '6%' : '16%'}, transparent)`,
              color: active ? 'rgb(var(--cs-bg))' : dimmed ? `color-mix(in srgb, ${color} 50%, transparent)` : color,
              paddingLeft: runStart ? 5 : 1,
              paddingRight: runEnd ? 5 : 1,
              marginLeft: runStart && i !== 0 ? 3 : 0,
              borderTopLeftRadius: runStart ? 4 : 0,
              borderBottomLeftRadius: runStart ? 4 : 0,
              borderTopRightRadius: runEnd ? 4 : 0,
              borderBottomRightRadius: runEnd ? 4 : 0,
              cursor: id ? 'pointer' : 'default',
            }}
          >
            {hx(b)}
          </span>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 4: Implement `BitTable.tsx`**

Create `src/renderer/components/packet/BitTable.tsx`:

```tsx
import type { BitRow } from '../../lib/packetInspect';

export function BitTable({ rows, colorVar }: { rows: BitRow[]; colorVar: string }) {
  return (
    <table className="mt-2 w-full table-fixed border-collapse">
      <thead>
        <tr className="text-[9px] uppercase tracking-wide text-cs-text-dim">
          <th className="w-[20%] border-b border-cs-border px-2 py-1 text-left font-mono font-medium">Bits</th>
          <th className="w-[34%] border-b border-cs-border px-2 py-1 text-left font-mono font-medium">Field</th>
          <th className="w-[28%] border-b border-cs-border px-2 py-1 text-left font-mono font-medium">Value</th>
          <th className="w-[18%] border-b border-cs-border px-2 py-1 text-left font-mono font-medium">Bin</th>
        </tr>
      </thead>
      <tbody className="font-mono text-[11px]">
        {rows.map((r) => (
          <tr key={`${r.range}-${r.field}`}>
            <td className="border-b border-cs-border px-2 py-1 text-cs-text-dim">{r.range}</td>
            <td className="border-b border-cs-border px-2 py-1 text-cs-text">{r.field}</td>
            <td className="border-b border-cs-border px-2 py-1 text-cs-text-muted">{r.value}</td>
            <td className="border-b border-cs-border px-2 py-1 font-semibold" style={{ color: colorVar }}>
              {r.binary}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
```

- [ ] **Step 5: Implement `FieldCard.tsx`**

Create `src/renderer/components/packet/FieldCard.tsx`:

```tsx
import { ChevronDown } from 'lucide-react';
import { useState } from 'react';
import type { InspectField } from '../../lib/packetInspect';
import { BitTable } from './BitTable';

const colorVar = (idx: number) => `rgb(var(--cs-field${idx}))`;

interface Props {
  field: InspectField;
  scope: string;
  hovered: string | null;
  setHovered: (id: string | null) => void;
}

export function FieldCard({ field, scope, hovered, setHovered }: Props) {
  const id = `${scope}:${field.key}`;
  const color = colorVar(field.colorIdx);
  const active = hovered === id;
  const dimmed = hovered != null && hovered !== id;
  const [openBits, setOpenBits] = useState(true);
  const range = field.start === field.end ? `Byte ${field.start}` : `Bytes ${field.start}-${field.end}`;

  return (
    <div
      onMouseEnter={() => setHovered(id)}
      onMouseLeave={() => setHovered(null)}
      className="relative rounded-lg border px-3 py-2.5 pl-3.5 transition-[opacity,border-color] bg-cs-bg-3"
      style={{
        borderColor: active ? `color-mix(in srgb, ${color} 55%, transparent)` : 'rgb(var(--cs-border))',
        opacity: dimmed ? 0.55 : 1,
      }}
    >
      <div className="absolute top-2 bottom-2 left-0 w-[3px] rounded" style={{ background: color }} />
      <div className="mb-2 flex items-baseline gap-2">
        <span className="text-[12px] font-semibold" style={{ color }}>
          {field.name}
        </span>
        <span className="flex-1" />
        <span className="font-mono text-[10px] whitespace-nowrap text-cs-text-dim">{range}</span>
        {field.bits && (
          <button
            type="button"
            onClick={() => setOpenBits((v) => !v)}
            title={openBits ? 'Hide bits' : 'Show bits'}
            className="text-cs-text-dim"
            style={{ transform: openBits ? 'none' : 'rotate(-90deg)', transition: 'transform .12s' }}
          >
            <ChevronDown size={13} />
          </button>
        )}
      </div>
      <div className="max-h-24 overflow-y-auto rounded border border-cs-border bg-cs-bg-2 px-2.5 py-1.5 font-mono text-[11.5px] break-all text-cs-text-muted">
        {field.value || '—'}
      </div>
      {field.bits && openBits && <BitTable rows={field.bits} colorVar={color} />}
      {field.desc && <div className="mt-2 truncate text-[11px] text-cs-text-dim" title={field.desc}>{field.desc}</div>}
    </div>
  );
}
```

- [ ] **Step 6: Implement `PacketBreakdown.tsx`**

Create `src/renderer/components/packet/PacketBreakdown.tsx`:

```tsx
import type { InspectField } from '../../lib/packetInspect';
import { ByteStrip } from './ByteStrip';
import { FieldCard } from './FieldCard';

interface Props {
  title: string;
  count?: number;
  bytes: number[];
  fields: InspectField[];
  scope: string;
  hovered: string | null;
  setHovered: (id: string | null) => void;
}

export function PacketBreakdown({ title, count, bytes, fields, scope, hovered, setHovered }: Props) {
  return (
    <div>
      <div className="mt-5 mb-2.5 flex items-baseline gap-2">
        <span className="text-[13.5px] font-bold text-cs-text">{title}</span>
        {count != null && <span className="font-mono text-[11px] text-cs-text-dim">({count} bytes)</span>}
      </div>
      <ByteStrip bytes={bytes} fields={fields} scope={scope} hovered={hovered} setHovered={setHovered} />
      <div className="mt-2.5 flex flex-col gap-2">
        {fields.map((f) => (
          <FieldCard key={f.key} field={f} scope={scope} hovered={hovered} setHovered={setHovered} />
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `pnpm exec vitest run --project dom tests/component/packet-bytestrip.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 8: Commit**

```bash
git add src/renderer/components/packet/ByteStrip.tsx src/renderer/components/packet/FieldCard.tsx src/renderer/components/packet/BitTable.tsx src/renderer/components/packet/PacketBreakdown.tsx tests/component/packet-bytestrip.test.tsx
git commit -m "feat(packetlog): byte strip, field card, bit table, breakdown

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 11: List pane rewrite — columns, badge, source filter, selection

**Files:**
- Modify: `src/renderer/components/PacketLog.tsx` (full rewrite)
- Modify: `src/renderer/components/AppHosts.tsx` (`LivePacket` type flows through — usually no change needed since it reads `s.packets`)
- Test: `tests/component/packet-log-select.test.tsx`

**Interfaces:**
- Consumes: `LivePacket` (Task 3), `summarizePacket` (existing), store `selectedPacketId`/`setSelectedPacket`/`ui.packetLogFilter.source`/`setPacketLogFilter`/`toggleRightRail`/`ui.rightOpen`.
- Produces: a `PacketLog` list where rows carry `data-testid="packet-row"`, clicking selects + opens the rail.

- [ ] **Step 1: Write the failing test**

Create `tests/component/packet-log-select.test.tsx`:

```tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { PacketLog } from '@/components/PacketLog';
import type { LivePacket } from '@/lib/store';
import { useStore } from '@/lib/store';

const pkt = (id: string, over: Partial<LivePacket> = {}): LivePacket => ({
  id,
  timestamp: Date.parse('2026-07-10T20:26:00Z'),
  transportType: 'ble',
  kind: 'mesh',
  hex: '88',
  bytes: [],
  payloadHex: '0a00cbe31122aabbccdd',
  payloadBytes: [],
  snr: 5,
  rssi: -70,
  ...over,
});

beforeEach(() => {
  useStore.setState({ selectedPacketId: null });
  useStore.getState().setPacketLogFilter({ source: 'both' });
});

describe('PacketLog list', () => {
  it('renders a row per packet and selects on click', () => {
    render(<PacketLog packets={[pkt('pkt-0'), pkt('pkt-1', { kind: 'companion', codeName: 'PUSH_ADVERT' })]} />);
    const rows = screen.getAllByTestId('packet-row');
    expect(rows).toHaveLength(2);
    fireEvent.click(rows[0]);
    expect(useStore.getState().selectedPacketId).toBe('pkt-0');
  });

  it('filters to RF only when source=rf', () => {
    useStore.getState().setPacketLogFilter({ source: 'rf' });
    render(<PacketLog packets={[pkt('pkt-0'), pkt('pkt-1', { kind: 'companion', codeName: 'PUSH_ADVERT' })]} />);
    expect(screen.getAllByTestId('packet-row')).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run --project dom tests/component/packet-log-select.test.tsx`
Expected: FAIL — old `PacketLog` has no `packet-row` / uses `showCompanion`.

- [ ] **Step 3: Rewrite `PacketLog.tsx`**

Replace `src/renderer/components/PacketLog.tsx` with:

```tsx
import { Layers, Radio, Search, Waypoints } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso';
import { type PacketSummary, summarizePacket } from '../lib/decodePacket';
import { type LivePacket, useStore } from '../lib/store';
import { fmtTimePrecise } from '../lib/time';

interface Props {
  packets: LivePacket[];
}

const GRID = 'grid-cols-[70px_112px_minmax(0,1fr)_92px_30px]';

function badge(p: LivePacket): { letter: string; varName: string } {
  if (p.kind === 'companion') return { letter: 'B', varName: '--cs-ble' };
  const route = summarizePacket(p.payloadHex).routeName;
  return route === 'Direct' ? { letter: 'D', varName: '--cs-route-direct' } : { letter: 'F', varName: '--cs-route-flood' };
}

function rssiClass(rssi?: number): string {
  if (rssi == null) return 'text-cs-text-dim';
  if (rssi > -80) return 'text-cs-online';
  if (rssi > -96) return 'text-cs-text-muted';
  return 'text-cs-warn';
}

function Row({ packet, selected, onSelect }: { packet: LivePacket; selected: boolean; onSelect: () => void }) {
  const timeFormat = useStore((s) => s.appSettings.timeFormat);
  const summary: PacketSummary = useMemo(() => summarizePacket(packet.payloadHex), [packet.payloadHex]);
  const b = badge(packet);
  const typeName = packet.kind === 'companion' ? (packet.codeName ?? 'BLE').replace(/_/g, ' ') : summary.typeName;
  return (
    <div
      data-testid="packet-row"
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect();
        }
      }}
      className={`grid ${GRID} items-center gap-2 border-l-2 px-3.5 py-1.5 ${selected ? 'border-cs-accent bg-cs-bg-3' : 'border-transparent hover:bg-cs-bg-2'} cursor-pointer`}
    >
      <span className="truncate font-mono text-[11px] text-cs-text-dim">{fmtTimePrecise(packet.timestamp, timeFormat).replace(/\.\d+/, '')}</span>
      <span className="flex min-w-0 items-center gap-2">
        <span className="flex size-[18px] shrink-0 items-center justify-center rounded font-mono text-[11px] font-bold" style={{ background: `rgb(var(${b.varName}))`, color: 'rgb(var(--cs-bg))' }}>
          {b.letter}
        </span>
        <span className="truncate text-[12.5px] text-cs-text">{typeName}</span>
      </span>
      <span className="truncate text-[12.5px] text-cs-text-muted">{summary.detail ?? ''}</span>
      <span className={`truncate font-mono text-[11px] ${rssiClass(packet.rssi)}`}>{packet.rssi == null ? '—' : `${packet.rssi} / ${packet.snr}`}</span>
      <span className="text-right font-mono text-[11px] text-cs-text-muted">{packet.kind === 'companion' ? '—' : summary.decoded?.pathLength ?? 0}</span>
    </div>
  );
}

const SOURCES = [
  { k: 'both', label: 'Both', Icon: Layers },
  { k: 'rf', label: 'RF', Icon: Radio },
  { k: 'ble', label: 'BLE', Icon: Waypoints },
] as const;

export function PacketLog({ packets }: Props) {
  const source = useStore((s) => s.ui.packetLogFilter.source);
  const setPacketLogFilter = useStore((s) => s.setPacketLogFilter);
  const selectedId = useStore((s) => s.selectedPacketId);
  const setSelectedPacket = useStore((s) => s.setSelectedPacket);
  const rightOpen = useStore((s) => s.ui.rightOpen);
  const toggleRightRail = useStore((s) => s.toggleRightRail);
  const [q, setQ] = useState('');
  const virtuosoRef = useRef<VirtuosoHandle>(null);

  const visible = useMemo(() => {
    const s = q.trim().toLowerCase();
    return packets.filter((p) => {
      if (source === 'rf' && p.kind !== 'mesh') return false;
      if (source === 'ble' && p.kind !== 'companion') return false;
      if (!s) return true;
      return `${p.codeName ?? ''} ${p.payloadHex} ${p.rssi ?? ''}`.toLowerCase().includes(s);
    });
  }, [packets, source, q]);

  const onSelect = (id: string) => {
    setSelectedPacket(selectedId === id ? null : id);
    if (!rightOpen) toggleRightRail();
  };

  return (
    <section className="flex min-h-0 flex-1 flex-col rounded border border-cs-border bg-cs-bg">
      <header className="flex flex-wrap items-center gap-3 border-b border-cs-border px-4 py-2.5">
        <span className="flex items-center gap-2">
          <span className="size-1.5 rounded-full bg-cs-online shadow-[0_0_6px_rgb(var(--cs-online))]" />
          <span className="font-mono text-[11.5px] tracking-wide text-cs-text-muted">RAW PACKETS</span>
        </span>
        <span className="flex-1" />
        <div className="relative">
          <Search size={13} className="absolute top-1/2 left-2.5 -translate-y-1/2 text-cs-text-dim" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="filter by kind, hex, RSSI…"
            className="h-7 w-52 rounded border border-cs-border bg-cs-bg-2 pr-2.5 pl-7 text-[12px] text-cs-text outline-none"
          />
        </div>
        <div className="inline-flex gap-0.5 rounded-md border border-cs-border bg-cs-bg-3 p-0.5">
          {SOURCES.map(({ k, label, Icon }) => (
            <button
              key={k}
              type="button"
              onClick={() => setPacketLogFilter({ source: k })}
              className={`inline-flex h-6 items-center gap-1.5 rounded px-2.5 text-[11.5px] ${source === k ? 'bg-cs-bg text-cs-text shadow-[inset_0_0_0_1px_rgb(var(--cs-border))]' : 'text-cs-text-muted'}`}
            >
              <Icon size={13} />
              {label}
            </button>
          ))}
        </div>
        <span className="font-mono text-[11px] whitespace-nowrap text-cs-text-dim">
          <span className="text-cs-text-muted">{visible.length}</span> / {packets.length}
        </span>
      </header>

      <div className={`grid ${GRID} gap-2 border-b border-cs-border px-3.5 py-1.5 font-mono text-[9.5px] tracking-wide text-cs-text-dim`}>
        <span>TIME</span>
        <span>TYPE</span>
        <span>DETAILS</span>
        <span>RSSI/SNR</span>
        <span className="text-right">HOP</span>
      </div>

      <div className="min-h-0 flex-1">
        {visible.length === 0 ? (
          <div className="py-12 text-center text-[12.5px] text-cs-text-dim">No packets match this filter.</div>
        ) : (
          <Virtuoso
            ref={virtuosoRef}
            data={visible}
            followOutput="auto"
            initialTopMostItemIndex={visible.length - 1}
            style={{ height: '100%' }}
            itemContent={(_, p) => <Row packet={p} selected={selectedId === p.id} onSelect={() => onSelect(p.id)} />}
          />
        )}
      </div>
    </section>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm exec vitest run --project dom tests/component/packet-log-select.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Verify AppHosts typechecks (LivePacket flows through)**

Run: `pnpm typecheck`
Expected: PASS (`PacketLogHost` reads `s.packets: LivePacket[]` → `PacketLog` `Props.packets: LivePacket[]`). If a `TimeFormatPref` import is now unused in PacketLog, remove it.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/components/PacketLog.tsx tests/component/packet-log-select.test.tsx
git commit -m "feat(packetlog): columned live list with route badge, source filter, selection

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 12: Deselect-on-outside-click for packets + DB-aware clear action

**Files:**
- Modify: `src/renderer/shell/useDeselectOnOutsideClick.ts`
- Modify: `src/renderer/features/command-palette/items/actions.ts` (`action:clearPacketLog`)
- Test: `tests/component/packet-log-select.test.tsx` (extend)

**Interfaces:**
- Consumes: `selectedPacketId`/`setSelectedPacket` (Task 3), `api.clearPackets` (Task 4).
- Produces: outside-click clears both message + packet selection; keeps selection for `packet-row`; the palette "Clear packet log" also clears the DB.

- [ ] **Step 1: Write the failing test (extend)**

Append to `tests/component/packet-log-select.test.tsx`:

```tsx
import { useDeselectOnOutsideClick } from '@/shell/useDeselectOnOutsideClick';

function Harness() {
  useDeselectOnOutsideClick();
  return (
    <div>
      <button type="button" data-testid="packet-row" onClick={() => useStore.getState().setSelectedPacket('pkt-9')}>
        row
      </button>
      <button type="button" data-testid="outside">
        outside
      </button>
    </div>
  );
}

describe('packet deselect-on-outside-click', () => {
  it('clears selectedPacketId when clicking outside', () => {
    useStore.getState().setSelectedPacket('pkt-1');
    render(<Harness />);
    fireEvent.click(screen.getByTestId('outside'));
    expect(useStore.getState().selectedPacketId).toBeNull();
  });

  it('keeps the selection when clicking a packet row', () => {
    render(<Harness />);
    fireEvent.click(screen.getByTestId('packet-row'));
    expect(useStore.getState().selectedPacketId).toBe('pkt-9');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run --project dom tests/component/packet-log-select.test.tsx`
Expected: FAIL — clicking outside doesn't clear `selectedPacketId` yet.

- [ ] **Step 3: Update the hook**

In `src/renderer/shell/useDeselectOnOutsideClick.ts`:

- Add `'[data-testid="packet-row"]'` to `KEEP_SELECTION_SELECTORS`.
- Replace the early-return guard and the final clear:

```ts
      const st = useStore.getState();
      if (st.selectedMessageId == null && st.selectedPacketId == null) return;
```

```ts
      const st2 = useStore.getState();
      st2.setSelectedMessage(null);
      st2.setSelectedPacket(null);
```

(Keep the `composedPath()` loop unchanged.)

- [ ] **Step 4: Make "Clear packet log" also clear the DB**

In `src/renderer/features/command-palette/items/actions.ts`, the `action:clearPacketLog` `run` currently calls `clearPackets()`. The action factory already has an `ApiClient` in scope (used by other actions) — call the API too:

```ts
    run: () => {
      clearPackets();
      const c = client; // the ApiClient available in this action factory's scope
      if (c) void api.clearPackets(c).catch(() => {});
      notify.success('Packet log cleared');
      close();
    },
```

If `client`/`api` aren't already in scope in this file, import `api` from `../../../lib/api` and thread the existing client the factory receives. (Grep the top of `actions.ts` for how `clearPackets`/`close` are obtained and mirror that for `client`.)

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm exec vitest run --project dom tests/component/packet-log-select.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add src/renderer/shell/useDeselectOnOutsideClick.ts src/renderer/features/command-palette/items/actions.ts tests/component/packet-log-select.test.tsx
git commit -m "feat(packetlog): outside-click deselect + DB-aware clear

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 13: Right-rail detail (`PacketDetailsRail`) + wire the bypass

**Files:**
- Create: `src/renderer/components/packet/PacketDetailsRail.tsx`
- Modify: `src/renderer/shell/rightrail/index.tsx` (add a `tool:packetlog` bypass like `tool:map`)
- Test: `tests/component/rail-packetlog.test.tsx`

**Interfaces:**
- Consumes: store `selectedPacketId`/`packets`/`channels`/`radioSettings`/`setDecoderOpen`; `inspectPacket` + `inspectBleFrame`; `MeshCoreDecoder.createKeyStore`; `PacketBreakdown`, `KeyValueRow`, `fmtDateTime`.
- Produces: `PacketDetailsRail({ client }: { client: ApiClient | null })` — DETAILS → hash → breakdowns → secondary/BLE/empty.

- [ ] **Step 1: Write the failing test**

Create `tests/component/rail-packetlog.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { PacketDetailsRail } from '@/components/packet/PacketDetailsRail';
import type { LivePacket } from '@/lib/store';
import { useStore } from '@/lib/store';

const gt: LivePacket = {
  id: 'pkt-0',
  timestamp: Date.parse('2026-07-10T20:26:00Z'),
  transportType: 'ble',
  kind: 'mesh',
  hex: '88',
  bytes: [],
  payloadHex: '1501782abbcc00112233',
  payloadBytes: [],
  snr: 5,
  rssi: -84,
};

beforeEach(() => {
  useStore.setState({ packets: [gt], selectedPacketId: null, channels: [] });
});

describe('PacketDetailsRail', () => {
  it('shows the empty state with a Decode button when nothing is selected', () => {
    render(<PacketDetailsRail client={null} />);
    expect(screen.getByText(/Decode hex/i)).toBeTruthy();
  });

  it('renders the byte breakdown for a selected packet', () => {
    useStore.setState({ selectedPacketId: 'pkt-0' });
    render(<PacketDetailsRail client={null} />);
    expect(screen.getByText(/Packet Byte Breakdown/i)).toBeTruthy();
    expect(screen.getByText(/Group Text Payload Byte Breakdown/i)).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run --project dom tests/component/rail-packetlog.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `PacketDetailsRail.tsx`**

Create `src/renderer/components/packet/PacketDetailsRail.tsx`:

```tsx
import { Binary, Copy, Route, Unlock } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { ApiClient } from '../../lib/api';
import { inspectBleFrame } from '../../lib/bleFrameLayouts';
import { type PacketInspection, inspectPacket } from '../../lib/packetInspect';
import { useStore } from '../../lib/store';
import { fmtDateTime } from '../../lib/time';
import { KeyValueRow } from '../ui/KeyValueRow';
import { MeshCoreDecoder } from '@michaelhart/meshcore-decoder';
import { PacketBreakdown } from './PacketBreakdown';

function useKeyStore() {
  const channels = useStore((s) => s.channels);
  return useMemo(() => {
    const secrets = channels.map((c) => c.secretHex).filter((x): x is string => !!x);
    return secrets.length ? MeshCoreDecoder.createKeyStore({ channelSecrets: secrets }) : undefined;
  }, [channels]);
}

function CopyHash({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard.writeText(text);
        setDone(true);
        setTimeout(() => setDone(false), 1100);
      }}
      title="Copy hash"
      className={`inline-flex items-center gap-1.5 font-mono text-[12.5px] ${done ? 'text-cs-online' : 'text-cs-accent'}`}
    >
      <span className="truncate">{text}</span>
      <Copy size={13} />
    </button>
  );
}

export function PacketDetailsRail({ client: _client }: { client: ApiClient | null }) {
  const selectedId = useStore((s) => s.selectedPacketId);
  const packet = useStore((s) => s.packets.find((p) => p.id === s.selectedPacketId) ?? null);
  const radio = useStore((s) => s.radioSettings);
  const timeFormat = useStore((s) => s.appSettings.timeFormat);
  const setDecoderOpen = useStore((s) => s.setDecoderOpen);
  const keyStore = useKeyStore();
  const [hovered, setHovered] = useState<string | null>(null);

  if (!packet) {
    return (
      <div className="flex flex-col items-center gap-3.5 px-5 py-12 text-center">
        <Binary size={34} className="text-cs-text-dim opacity-60" />
        <div className="max-w-[220px] text-[12.5px] text-cs-text-muted">Select a packet to see its full byte-level breakdown.</div>
        <button
          type="button"
          onClick={() => setDecoderOpen(true)}
          className="inline-flex items-center gap-1.5 rounded-md border border-cs-border bg-cs-bg-2 px-3 py-1.5 text-[12px] text-cs-text"
        >
          <Binary size={14} className="text-cs-accent" /> Decode hex…
        </button>
      </div>
    );
  }

  if (packet.kind === 'companion') {
    const ble = inspectBleFrame(packet.payloadHex, packet.codeName);
    return (
      <div className="px-3.5 py-3.5" key={selectedId}>
        <div className="mb-1 font-mono text-[10px] tracking-wide text-cs-text-dim">DETAILS</div>
        <div className="rounded-lg border border-cs-border bg-cs-bg-2 px-3 py-2">
          <KeyValueRow label="Frame" value={ble.codeName} mono />
          <KeyValueRow label="Transport" value="BLE / serial companion link" mono />
          <KeyValueRow label="Size" value={`${ble.bytes.length} bytes`} mono />
          <KeyValueRow label="Received" value={fmtDateTime(packet.timestamp, timeFormat)} mono />
        </div>
        <PacketBreakdown title="BLE Frame Breakdown" count={ble.bytes.length} bytes={ble.bytes} fields={ble.fields} scope="ble" hovered={hovered} setHovered={setHovered} />
      </div>
    );
  }

  const d: PacketInspection = inspectPacket(packet.payloadHex, keyStore ? { keyStore } : undefined);
  const sec = d.payload?.secondary ?? null;

  return (
    <div className="px-3.5 py-3.5" key={selectedId}>
      <div className="mb-1 font-mono text-[10px] tracking-wide text-cs-text-dim">DETAILS</div>
      <div className="rounded-lg border border-cs-border bg-cs-bg-2 px-3 py-2">
        <KeyValueRow label="Type" value={d.payloadTypeName} />
        <KeyValueRow label="Route" value={d.routeName} mono />
        <KeyValueRow label="RSSI / SNR" value={packet.rssi == null ? '—' : `${packet.rssi} dBm · ${packet.snr} dB`} mono />
        <KeyValueRow label="Hops" value={d.hops === 0 ? '0 · direct' : String(d.hops)} mono />
        {d.pathArrows && <KeyValueRow label="Path" value={d.pathArrows} mono />}
        <KeyValueRow label="Size" value={`${d.size} bytes`} mono />
        <KeyValueRow label="Received" value={fmtDateTime(packet.timestamp, timeFormat)} mono />
        <KeyValueRow label="Radio" value={`${(radio.frequencyHz / 1e6).toFixed(3)} MHz · SF${radio.spreadingFactor} / BW${(radio.bandwidthHz / 1000).toFixed(1)} / CR${radio.codingRate}`} mono />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2.5">
        <span className="font-mono text-[10px] tracking-wide text-cs-text-dim">PACKET HASH</span>
        <CopyHash text={d.hashFull} />
        <span className="flex-1" />
        <button type="button" disabled title="Trace path (coming soon)" className="inline-flex cursor-not-allowed items-center gap-1.5 rounded border border-cs-border bg-cs-bg-2 px-2 py-0.5 text-[11px] text-cs-text-dim opacity-60">
          <Route size={13} /> Trace path
        </button>
      </div>

      {d.lowConfidence && (
        <div className="mt-2 rounded-md border border-cs-warn/25 bg-cs-warn/10 px-3 py-2 text-[11.5px] text-cs-text-muted">{d.lowConfidence}</div>
      )}

      <PacketBreakdown title="Packet Byte Breakdown" count={d.size} bytes={d.bytes} fields={d.fields} scope="packet" hovered={hovered} setHovered={setHovered} />

      {d.payload && (
        <>
          <PacketBreakdown title={`${d.payload.typeName} Payload Byte Breakdown`} count={d.payload.bytes.length} bytes={d.payload.bytes} fields={d.payload.fields} scope="payload" hovered={hovered} setHovered={setHovered} />

          {sec?.kind === 'decrypted' && (
            <>
              <div className="mt-5 flex items-center gap-2">
                <span className="text-[13.5px] font-bold text-cs-text">Decrypted Plaintext</span>
                <span className="inline-flex items-center gap-1 rounded border border-cs-online/35 bg-cs-online/10 px-1.5 py-0.5 font-mono text-[9.5px] text-cs-online">
                  <Unlock size={11} /> key held
                </span>
              </div>
              <div className="mt-2.5">
                <PacketBreakdown title="" bytes={sec.bytes} fields={sec.fields} scope="plain" hovered={hovered} setHovered={setHovered} />
              </div>
            </>
          )}
          {sec?.kind === 'appdata' && (
            <PacketBreakdown title={sec.title} count={sec.bytes.length} bytes={sec.bytes} fields={sec.fields} scope="appdata" hovered={hovered} setHovered={setHovered} />
          )}
          {sec?.kind === 'encrypted' && (
            <div className="mt-3 rounded-md border border-cs-accent/25 bg-cs-accent/10 px-3 py-2.5 text-[11.5px] text-cs-text-muted">{sec.note}</div>
          )}
        </>
      )}
    </div>
  );
}
```

(Note: `PacketBreakdown` with `title=""` renders an empty title line but keeps the strip+cards; acceptable for the decrypted sub-section which has its own header above.)

- [ ] **Step 4: Wire the bypass in `rightrail/index.tsx`**

In `src/renderer/shell/rightrail/index.tsx`, add the import:

```tsx
import { PacketDetailsRail } from '../../components/packet/PacketDetailsRail';
```

Change the body render so `tool:packetlog` bypasses the Collapsible sections (mirror the `tool:map` branch):

```tsx
        {activeKey === 'tool:map' ? (
          <MapDetailsRail client={client} />
        ) : activeKey === 'tool:packetlog' ? (
          <div className="h-full overflow-y-auto">
            <PacketDetailsRail client={client} />
          </div>
        ) : (
          <div className="h-full overflow-y-auto py-1">
            {/* …existing sections map… */}
          </div>
        )}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm exec vitest run --project dom tests/component/rail-packetlog.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add src/renderer/components/packet/PacketDetailsRail.tsx src/renderer/shell/rightrail/index.tsx tests/component/rail-packetlog.test.tsx
git commit -m "feat(packetlog): right-rail byte-level detail inspector

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 14: Standalone decoder dialog + command-palette action + BYON

**Files:**
- Create: `src/renderer/components/packet/PacketDecoderDialog.tsx`
- Modify: `src/renderer/App.tsx` (mount the host next to `ShortcutsHelpDialog`)
- Modify: `src/renderer/features/command-palette/items/actions.ts` (add "Decode packet…")
- Test: `tests/component/packet-decoder-dialog.test.tsx`

**Interfaces:**
- Consumes: `ui.decoderOpen`/`setDecoderOpen` (Task 3), `normalizeToHex` (Task 8), `inspectPacket`/`inspectBleFrame`, `PacketBreakdown`, `Dialog` primitives, `useKeyStore` pattern (inline).
- Produces: `PacketDecoderDialog()` host; palette action `action:decodePacket`.

- [ ] **Step 1: Write the failing test**

Create `tests/component/packet-decoder-dialog.test.tsx`:

```tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { PacketDecoderDialog } from '@/components/packet/PacketDecoderDialog';
import { useStore } from '@/lib/store';

beforeEach(() => {
  useStore.getState().setDecoderOpen(true);
  useStore.setState({ channels: [] });
});

describe('PacketDecoderDialog', () => {
  it('decodes pasted hex into a byte breakdown', () => {
    render(<PacketDecoderDialog />);
    fireEvent.change(screen.getByPlaceholderText(/paste/i), { target: { value: '1501782abbcc00112233' } });
    fireEvent.click(screen.getByRole('button', { name: /decode/i }));
    expect(screen.getByText(/Packet Byte Breakdown/i)).toBeTruthy();
  });

  it('decodes base64 too', () => {
    render(<PacketDecoderDialog />);
    // base64 of the GroupText fixture bytes
    fireEvent.change(screen.getByPlaceholderText(/paste/i), { target: { value: 'FQF4KrvMABEiMw==' } });
    fireEvent.click(screen.getByRole('button', { name: /decode/i }));
    expect(screen.getByText(/Packet Byte Breakdown/i)).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run --project dom tests/component/packet-decoder-dialog.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `PacketDecoderDialog.tsx`**

Create `src/renderer/components/packet/PacketDecoderDialog.tsx`:

```tsx
import { Binary } from 'lucide-react';
import { useMemo, useState } from 'react';
import { MeshCoreDecoder } from '@michaelhart/meshcore-decoder';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../ui/dialog';
import { inspectBleFrame } from '../../lib/bleFrameLayouts';
import { inspectPacket } from '../../lib/packetInspect';
import { normalizeToHex } from '../../lib/packetInput';
import { useStore } from '../../lib/store';
import { PacketBreakdown } from './PacketBreakdown';

export function PacketDecoderDialog() {
  const open = useStore((s) => s.ui.decoderOpen);
  const setDecoderOpen = useStore((s) => s.setDecoderOpen);
  const channels = useStore((s) => s.channels);
  const [raw, setRaw] = useState('');
  const [kind, setKind] = useState<'rf' | 'ble'>('rf');
  const [decoded, setDecoded] = useState<React.ReactNode>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const keyStore = useMemo(() => {
    const secrets = channels.map((c) => c.secretHex).filter((x): x is string => !!x);
    return secrets.length ? MeshCoreDecoder.createKeyStore({ channelSecrets: secrets }) : undefined;
  }, [channels]);

  const norm = normalizeToHex(raw);
  const nBytes = norm ? norm.hex.length / 2 : 0;

  const onDecode = () => {
    setError(null);
    if (!norm) {
      setError('Could not read that as hex, base64, or a meshcore:// link.');
      setDecoded(null);
      return;
    }
    if (kind === 'ble') {
      const b = inspectBleFrame(norm.hex);
      setDecoded(<PacketBreakdown title="BLE Frame Breakdown" count={b.bytes.length} bytes={b.bytes} fields={b.fields} scope="ble" hovered={hovered} setHovered={setHovered} />);
      return;
    }
    const d = inspectPacket(norm.hex, keyStore ? { keyStore } : undefined);
    if (!d.ok && !d.fields.length) {
      setError(d.error ?? 'Decode failed.');
      setDecoded(null);
      return;
    }
    setDecoded(
      <>
        <PacketBreakdown title="Packet Byte Breakdown" count={d.size} bytes={d.bytes} fields={d.fields} scope="packet" hovered={hovered} setHovered={setHovered} />
        {d.payload && <PacketBreakdown title={`${d.payload.typeName} Payload Byte Breakdown`} count={d.payload.bytes.length} bytes={d.payload.bytes} fields={d.payload.fields} scope="payload" hovered={hovered} setHovered={setHovered} />}
      </>,
    );
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && setDecoderOpen(false)}>
      <DialogContent className="flex max-h-[calc(100%-2rem)] w-[560px] max-w-[calc(100%-2rem)] flex-col gap-0 overflow-hidden rounded-[7px] border border-cs-border-strong bg-cs-bg-2 p-0 text-cs-text">
        <div className="flex items-center gap-2 border-b border-cs-border px-4 py-3">
          <Binary size={14} className="text-cs-accent" />
          <DialogTitle className="text-[14px] font-semibold">Decode a packet</DialogTitle>
          <DialogDescription className="sr-only">Paste raw hex, base64, or a meshcore link to break it down.</DialogDescription>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <div className="mb-2.5 inline-flex gap-0.5 rounded-md border border-cs-border bg-cs-bg-3 p-0.5">
            {(['rf', 'ble'] as const).map((k) => (
              <button key={k} type="button" onClick={() => setKind(k)} className={`rounded px-3 py-1 text-[11.5px] ${kind === k ? 'bg-cs-bg text-cs-text' : 'text-cs-text-muted'}`}>
                {k === 'rf' ? 'RF packet' : 'BLE frame'}
              </button>
            ))}
          </div>
          <textarea
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
            placeholder="Paste hex, base64, or meshcore://…"
            className="min-h-24 w-full resize-y rounded-md border border-cs-border bg-cs-bg px-2.5 py-2 font-mono text-[12px] text-cs-text outline-none"
          />
          <div className="mt-2.5 flex items-center gap-2.5">
            <span className="font-mono text-[10.5px] text-cs-text-dim">{nBytes} bytes{norm ? ` · ${norm.kind}` : ''}</span>
            <span className="flex-1" />
            <button
              type="button"
              onClick={onDecode}
              disabled={nBytes < 1}
              className="rounded-md bg-cs-accent px-3.5 py-1.5 text-[12px] font-semibold text-cs-bg disabled:cursor-not-allowed disabled:opacity-50"
            >
              Decode
            </button>
          </div>
          {error && <div className="mt-3 rounded-md border border-cs-danger/30 bg-cs-danger/10 px-3 py-2 text-[11.5px] text-cs-text-muted">{error}</div>}
          {decoded}
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 4: Mount the host in `App.tsx`**

In `src/renderer/App.tsx`, add the import and render it next to `<ShortcutsHelpDialog />`:

```tsx
import { PacketDecoderDialog } from './components/packet/PacketDecoderDialog';
```

```tsx
      <ShortcutsHelpDialog />
      <PacketDecoderDialog />
```

- [ ] **Step 5: Add the command-palette action**

In `src/renderer/features/command-palette/items/actions.ts`, near `action:clearPacketLog`, add (using the store setter — the factory can call `useStore.getState().setDecoderOpen(true)`):

```ts
  list.push({
    id: 'action:decodePacket',
    label: 'Decode packet…',
    hint: 'hex / base64 / meshcore://',
    group: 'action',
    groupLabel: 'Actions',
    icon: Binary,
    keywords: 'decode packet hex base64 byon inspector',
    run: () => {
      useStore.getState().setDecoderOpen(true);
      close();
    },
  });
```

Add `Binary` to the lucide import at the top of `actions.ts`, and `useStore` if not already imported.

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm exec vitest run --project dom tests/component/packet-decoder-dialog.test.tsx`
Expected: PASS (2 tests). (If the base64 fixture string differs from the real base64 of the GroupText bytes, compute it: bytes `15 01 78 2a bb cc 00 11 22 33` → base64. Adjust the test literal to match.)

- [ ] **Step 7: Commit**

```bash
git add src/renderer/components/packet/PacketDecoderDialog.tsx src/renderer/App.tsx src/renderer/features/command-palette/items/actions.ts tests/component/packet-decoder-dialog.test.tsx
git commit -m "feat(packetlog): standalone decoder dialog (hex/base64/meshcore://)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 15: Settings — Packet Log section (Extra tab)

**Files:**
- Create: `src/renderer/panels/settings/PacketLogSection.tsx`
- Modify: `src/renderer/panels/settings/SettingsPanel.tsx` (register in `TAB_SECTIONS.extra` + render in `ExtraTab`)
- Test: `tests/component/packet-log-settings.test.tsx`

**Interfaces:**
- Consumes: `ui.packetLog`/`setPacketLogSettings` (Task 3), `PACKET_LOG_BOUNDS` (Task 2), `SettingsSection` + `NumberInput`/`Row`.
- Produces: an `extra-packetlog` settings section that live-edits `ui.packetLog` (persisted by the debounced `putUiState` in App.tsx).

- [ ] **Step 1: Write the failing test**

Create `tests/component/packet-log-settings.test.tsx`:

```tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_UI_STATE } from '../../src/shared/types';
import { PacketLogSection } from '@/panels/settings/PacketLogSection';
import { useStore } from '@/lib/store';

beforeEach(() => {
  useStore.setState({ ui: structuredClone(DEFAULT_UI_STATE), packets: [] });
});

describe('PacketLogSection', () => {
  it('live-updates liveBufferSize in the store', () => {
    render(<PacketLogSection />);
    const input = screen.getByLabelText(/live buffer/i);
    fireEvent.change(input, { target: { value: '500' } });
    expect(useStore.getState().ui.packetLog.liveBufferSize).toBe(500);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run --project dom tests/component/packet-log-settings.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `PacketLogSection.tsx`**

Create `src/renderer/panels/settings/PacketLogSection.tsx`. (Uses the shared `Field` controls; live-updates the store — no Save button, so `SettingsSection` is used without `onSave`.)

```tsx
import { ScrollText } from 'lucide-react';
import { NumberInput, Row } from '../../components/settings/Field';
import { SettingsSection } from '../../components/settings/SettingsSection';
import { useStore } from '../../lib/store';
import { PACKET_LOG_BOUNDS } from '../../../shared/types';

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.round(v)));

export function PacketLogSection() {
  const packetLog = useStore((s) => s.ui.packetLog);
  const setPacketLogSettings = useStore((s) => s.setPacketLogSettings);

  return (
    <SettingsSection id="extra-packetlog" icon={ScrollText} title="Packet Log" description="How many packets the Packet Log keeps in memory and on disk.">
      <Row
        label="Live buffer"
        description="Packets kept in memory and shown in the list."
        control={
          <NumberInput
            aria-label="Live buffer"
            value={packetLog.liveBufferSize}
            min={PACKET_LOG_BOUNDS.liveBufferSize.min}
            max={PACKET_LOG_BOUNDS.liveBufferSize.max}
            step={100}
            onChange={(v) => setPacketLogSettings({ liveBufferSize: clamp(v, PACKET_LOG_BOUNDS.liveBufferSize.min, PACKET_LOG_BOUNDS.liveBufferSize.max) })}
          />
        }
      />
      <Row
        label="Stored history"
        description="Packets saved to disk so the log survives a reload. 0 turns off saving."
        control={
          <NumberInput
            aria-label="Stored history"
            value={packetLog.storedHistorySize}
            min={PACKET_LOG_BOUNDS.storedHistorySize.min}
            max={PACKET_LOG_BOUNDS.storedHistorySize.max}
            step={1000}
            onChange={(v) => setPacketLogSettings({ storedHistorySize: clamp(v, PACKET_LOG_BOUNDS.storedHistorySize.min, PACKET_LOG_BOUNDS.storedHistorySize.max) })}
          />
        }
      />
    </SettingsSection>
  );
}
```

(If `NumberInput` doesn't forward `aria-label`, wrap the input's label via `Row`'s `label` — the test's `getByLabelText` should still match the `Row` label association; if not, switch the test to `getAllByRole('spinbutton')[0]`.)

- [ ] **Step 4: Register the section**

In `src/renderer/panels/settings/SettingsPanel.tsx`:

- Add to `TAB_SECTIONS.extra` (at the top of the array so it leads the Extra tab):

```ts
    { id: 'extra-packetlog', title: 'Packet Log', tab: 'extra' },
```

- Import and render in `ExtraTab`:

```tsx
import { PacketLogSection } from './PacketLogSection';
```

```tsx
function ExtraTab({ client }: { client: ApiClient | null }) {
  return (
    <>
      <PacketLogSection />
      <MaintenanceSection client={client} />
      <ImportExportSection />
      <DangerZoneSection />
    </>
  );
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm exec vitest run --project dom tests/component/packet-log-settings.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/panels/settings/PacketLogSection.tsx src/renderer/panels/settings/SettingsPanel.tsx tests/component/packet-log-settings.test.tsx
git commit -m "feat(packetlog): tunable retention settings in the Extra tab

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 16: Full-suite gate + real-app verification

**Files:** none (verification only).

- [ ] **Step 1: Typecheck + lint + full test suite**

Run:
```bash
pnpm typecheck
pnpm lint
pnpm test
```
Expected: all green. Fix any fallout (unused imports in `PacketLog.tsx`; `RawPacket` import still needed in `store.ts`; `TimeFormatPref` import). Baseline before this feature was 396 dom+unit tests passing; the new count should be higher with 0 failures.

- [ ] **Step 2: Drive the real app (per the project `verify` / `run` skill)**

Package + launch under Playwright/Electron with a fake transport / replay seed (see project memory "E2E renderer verification"). Confirm, screenshotting each:
1. Live rows render with `TIME · TYPE(badge) · DETAILS · RSSI/SNR · HOP`; `[Both][RF][BLE]` filters the stream.
2. Clicking a row shows the right-rail DETAILS → PACKET HASH (copy works) → Packet + Payload byte breakdowns; hovering a byte-run highlights its card and vice-versa; dimming works.
3. A channel (GroupText) packet whose secret is held shows **Decrypted Plaintext**; a DM shows the **lock note**.
4. `Cmd+K` → "Decode packet…" opens the dialog; paste the GroupText **hex** and its **base64** — both render the breakdown; a `meshcore://` advert link decodes.
5. Settings → Extra → Packet Log: lower **Live buffer** and confirm the list trims; set **Stored history** and reload — packets survive; set it to 0 and confirm new packets stop persisting.
6. Toggle app theme light/dark and confirm the byte strips/cards/badges recolor legibly in both.

- [ ] **Step 3: Commit any verification fixes, then finish the branch**

```bash
git add -A
git commit -m "fix(packetlog): verification fixes

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

Then invoke **superpowers:finishing-a-development-branch** to choose merge/PR/cleanup.

---

## Self-Review notes (already reconciled)

- **Spec coverage:** list UI (T11), byte breakdown primitives (T10), right-rail detail (T13), decrypt + advert + lock (T6), standalone decoder hex/base64/uri (T8, T14), persistence + hydrate + clear (T1, T3, T4), tunable settings (T2, T3, T15), light+dark theming (T9), deselect + selection (T3, T12). Trace path disabled (T13); DM decrypt = lock note (T6); serial unchanged.
- **Type consistency:** `LivePacket`, `InspectField`, `PacketInspection`, `Secondary`, `packetStore.{record,recent,clear}`, `normalizeToHex`, `inspectBleFrame`, `setPacketLogSettings`, `setSelectedPacket`, `setDecoderOpen`, `PACKET_LOG_BOUNDS`, `DEFAULT_PACKET_LOG_SETTINGS`, `StateSnapshot.packets` are used with identical signatures across tasks.
- **Known verification-time adjustments (flagged inline, not placeholders):** payload-segment offset base (`normalize()` handles absolute-or-relative; pin with fixtures at T5); base64 test literals (compute exact at T14); `NumberInput` `aria-label` forwarding (fallback selector noted at T15); `client` scoping in `actions.ts` (grep + mirror at T12).
