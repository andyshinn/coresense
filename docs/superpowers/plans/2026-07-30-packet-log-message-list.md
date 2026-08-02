# Packet Log → VirtuosoMessageList Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render the Packet Log with `@virtuoso.dev/message-list`'s `VirtuosoMessageList` using the built-in `scrollToBottomIfAtBottom` scroll policy, and remove `react-virtuoso` from the project.

**Architecture:** Split `PacketLog.tsx` the way `panels/logs/` is split — a pure `filterPackets()` module and a standalone, prop-driven `PacketRow` component — then swap the list implementation in `PacketLog.tsx` to `VirtuosoMessageList`. The filter and row are unit/component tested directly (the virtualized list renders only one row under jsdom); the list itself is exercised in the e2e spec.

**Tech Stack:** React 19, TypeScript, Zustand, `@virtuoso.dev/message-list` (already a dependency, licensed via `VITE_VIRTUOSO_LICENSE_KEY`), Vitest (`unit` + `dom` projects), Playwright + Electron (e2e), Biome.

Spec: `docs/superpowers/specs/2026-07-30-packet-log-message-list-design.md`

## Global Constraints

- Run tooling via `npx`, not `pnpm <script>` — in `.claude/worktrees/` worktrees the pnpm wrappers fail a deps-check under the sandbox. Use `npx vitest run --project <p> <path>`, `npx tsc --noEmit`, `npx biome check src tests`.
- `git add`/`git commit` must run with the Bash sandbox disabled (worktree git needs it). Tests/typecheck/biome run fine sandboxed.
- Biome scope is `src tests` only — a repo-wide lint trips on pre-existing build artifacts.
- Format touched files with `npx biome check --write <files>` before committing (Biome wraps long literals; Vitest won't catch that).
- Vitest test projects: `unit` (node, `tests/unit/**`), `dom` (jsdom, `tests/component/**/*.test.tsx`). The `@/` alias maps to `src/renderer/` in `dom` tests; unit tests use relative `../../../../src/renderer/...` paths.
- The `dom` project has **no `ResizeObserver` polyfill**; do not render `VirtuosoMessageList` under jsdom — it throws `ResizeObserver not found`, and even polyfilled renders only one row. Test `PacketRow` directly instead.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `src/renderer/lib/packetLogFilter.ts` | **New.** Pure `filterPackets(packets, opts)` — source + text predicate lifted from `PacketLog.tsx`. |
| `src/renderer/components/PacketRow.tsx` | **New.** Prop-driven single-row component + the shared `PACKET_GRID` template and `badge()`/`rssiClass()` helpers. |
| `src/renderer/components/PacketLog.tsx` | **Modify.** Toolbar + column header + `VirtuosoMessageList` wiring. Imports `PACKET_GRID` and `filterPackets`. |
| `src/renderer/shell/MainPane.tsx` | Unchanged by this plan (padding fix already applied). |
| `package.json` | **Modify.** Remove `react-virtuoso`. |
| `tests/unit/renderer/lib/packetLogFilter.test.ts` | **New.** Filter unit tests. |
| `tests/component/packet-log-row.test.tsx` | **New.** `PacketRow` component tests. |
| `tests/component/packet-log-select.test.tsx` | **Modify.** Remove the 5 `PacketLog`-list tests; keep the deselect-harness tests. |
| `tests/e2e/packet-log.spec.ts` | **Modify.** Add a row-renders + click-opens-inspector assertion. |

---

## Task 1: Extract `filterPackets` into a pure module

**Files:**
- Create: `src/renderer/lib/packetLogFilter.ts`
- Test: `tests/unit/renderer/lib/packetLogFilter.test.ts`

**Interfaces:**
- Consumes: `LivePacket` from `src/renderer/lib/store`, `UiState` from `src/shared/types`.
- Produces: `filterPackets(packets: LivePacket[], opts: { source: UiState['packetLogFilter']['source']; query: string }): LivePacket[]`.

Reference for the predicate is the current `useMemo` in `PacketLog.tsx`:

```ts
return packets.filter((p) => {
  if (source === 'rf' && p.kind !== 'mesh') return false;
  if (source === 'ble' && p.kind !== 'companion') return false;
  if (!s) return true;
  return `${p.codeName ?? ''} ${p.payloadHex} ${p.rssi ?? ''}`.toLowerCase().includes(s);
});
```

- [ ] **Step 1: Write the failing test**

Create `tests/unit/renderer/lib/packetLogFilter.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { filterPackets } from '../../../../src/renderer/lib/packetLogFilter';
import type { LivePacket } from '../../../../src/renderer/lib/store';

const pkt = (id: string, over: Partial<LivePacket> = {}): LivePacket => ({
  id,
  timestamp: 0,
  transportType: 'ble',
  kind: 'mesh',
  hex: '88',
  bytes: [],
  payloadHex: 'deadbeef',
  payloadBytes: [],
  rssi: -70,
  snr: 5,
  ...over,
});

const ids = (ps: LivePacket[]) => ps.map((p) => p.id);

describe('filterPackets', () => {
  const mesh = pkt('mesh-0');
  const ble = pkt('ble-0', { kind: 'companion', codeName: 'PUSH_ADVERT', payloadHex: 'aa' });

  it('source "both" keeps every packet', () => {
    expect(ids(filterPackets([mesh, ble], { source: 'both', query: '' }))).toEqual(['mesh-0', 'ble-0']);
  });

  it('source "rf" keeps only mesh packets', () => {
    expect(ids(filterPackets([mesh, ble], { source: 'rf', query: '' }))).toEqual(['mesh-0']);
  });

  it('source "ble" keeps only companion packets', () => {
    expect(ids(filterPackets([mesh, ble], { source: 'ble', query: '' }))).toEqual(['ble-0']);
  });

  it('matches query against codeName, payloadHex, and rssi (case-insensitive)', () => {
    expect(ids(filterPackets([mesh, ble], { source: 'both', query: 'ADVERT' }))).toEqual(['ble-0']);
    expect(ids(filterPackets([mesh, ble], { source: 'both', query: 'deadbeef' }))).toEqual(['mesh-0']);
    expect(ids(filterPackets([mesh, ble], { source: 'both', query: '-70' }))).toEqual(['mesh-0']);
  });

  it('trims/ignores whitespace-only queries', () => {
    expect(ids(filterPackets([mesh, ble], { source: 'both', query: '   ' }))).toEqual(['mesh-0', 'ble-0']);
  });

  it('applies source and query together', () => {
    const ble2 = pkt('ble-1', { kind: 'companion', codeName: 'PUSH_ADVERT', payloadHex: 'bb' });
    expect(ids(filterPackets([mesh, ble, ble2], { source: 'ble', query: 'bb' }))).toEqual(['ble-1']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --project unit tests/unit/renderer/lib/packetLogFilter.test.ts`
Expected: FAIL — cannot resolve `../../../../src/renderer/lib/packetLogFilter`.

- [ ] **Step 3: Write minimal implementation**

Create `src/renderer/lib/packetLogFilter.ts`:

```ts
import type { UiState } from '../../shared/types';
import type { LivePacket } from './store';

export interface PacketFilterOpts {
  source: UiState['packetLogFilter']['source'];
  query: string;
}

// Mirrors the field concatenation the toolbar search box has always used:
// code name + payload hex + RSSI, lower-cased, substring match.
export function filterPackets(packets: LivePacket[], opts: PacketFilterOpts): LivePacket[] {
  const needle = opts.query.trim().toLowerCase();
  return packets.filter((p) => {
    if (opts.source === 'rf' && p.kind !== 'mesh') return false;
    if (opts.source === 'ble' && p.kind !== 'companion') return false;
    if (!needle) return true;
    return `${p.codeName ?? ''} ${p.payloadHex} ${p.rssi ?? ''}`.toLowerCase().includes(needle);
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run --project unit tests/unit/renderer/lib/packetLogFilter.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Format + commit**

```bash
npx biome check --write src/renderer/lib/packetLogFilter.ts tests/unit/renderer/lib/packetLogFilter.test.ts
git add src/renderer/lib/packetLogFilter.ts tests/unit/renderer/lib/packetLogFilter.test.ts
git commit -m "feat(packetlog): extract pure filterPackets"
```
(Commit runs with the Bash sandbox disabled.)

---

## Task 2: Extract `PacketRow` into a standalone component

**Files:**
- Create: `src/renderer/components/PacketRow.tsx`
- Test: `tests/component/packet-log-row.test.tsx`

**Interfaces:**
- Consumes: `LivePacket`, `useStore` from `src/renderer/lib/store`; `summarizePacket`, `PacketSummary` from `src/renderer/lib/decodePacket`; `summarizeBleFrame` from `src/renderer/lib/bleFrameLayouts`; `spaceWords` from `src/renderer/lib/packetInspect`; `fmtTimePrecise` from `src/renderer/lib/time`.
- Produces:
  - `PACKET_GRID: string` — the grid-template class shared by row + column header.
  - `PacketRow(props: { packet: LivePacket; selected: boolean; onSelect: () => void }): JSX.Element` — the `<button data-testid="packet-row">` row.

This is the current `Row` function and its `GRID`/`badge`/`rssiClass` helpers, moved out verbatim, with `GRID` renamed to the exported `PACKET_GRID`.

- [ ] **Step 1: Write the failing test**

Create `tests/component/packet-log-row.test.tsx`:

```tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PacketRow } from '@/components/PacketRow';
import type { LivePacket } from '@/lib/store';

const pkt = (over: Partial<LivePacket> = {}): LivePacket => ({
  id: 'p0',
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

describe('PacketRow', () => {
  it('humanizes a GroupText mesh payload type name', () => {
    render(<PacketRow packet={pkt({ payloadHex: '1501782abbcc00112233' })} selected={false} onSelect={() => {}} />);
    expect(screen.getByText('Group Text')).toBeTruthy();
  });

  it('shows the companion code name and no mesh-decode error for a BLE row', () => {
    render(
      <PacketRow
        packet={pkt({ kind: 'companion', codeName: 'PUSH_ADVERT', payloadHex: 'deadbeef' })}
        selected={false}
        onSelect={() => {}}
      />,
    );
    expect(screen.getByText('PUSH ADVERT')).toBeTruthy();
    expect(screen.queryByText(/too short|invalid|error/i)).toBeNull();
  });

  it('calls onSelect when clicked', () => {
    const onSelect = vi.fn();
    render(<PacketRow packet={pkt()} selected={false} onSelect={onSelect} />);
    fireEvent.click(screen.getByTestId('packet-row'));
    expect(onSelect).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --project dom tests/component/packet-log-row.test.tsx`
Expected: FAIL — cannot resolve `@/components/PacketRow`.

- [ ] **Step 3: Write the implementation**

Create `src/renderer/components/PacketRow.tsx` by moving the current `Row`, `badge`, `rssiClass`, and `GRID` out of `PacketLog.tsx`. `GRID` is exported as `PACKET_GRID`:

```tsx
import { useMemo } from 'react';
import { summarizeBleFrame } from '../lib/bleFrameLayouts';
import { type PacketSummary, summarizePacket } from '../lib/decodePacket';
import { spaceWords } from '../lib/packetInspect';
import { type LivePacket, useStore } from '../lib/store';
import { fmtTimePrecise } from '../lib/time';

export const PACKET_GRID = 'grid-cols-[70px_112px_minmax(0,1fr)_92px_30px]';

function badge(packet: LivePacket, summary: PacketSummary | null): { letter: string; varName: string } {
  if (packet.kind === 'companion') return { letter: 'B', varName: '--cs-ble' };
  return summary?.routeName.includes('Direct')
    ? { letter: 'D', varName: '--cs-route-direct' }
    : { letter: 'F', varName: '--cs-route-flood' };
}

function rssiClass(rssi?: number): string {
  if (rssi == null) return 'text-cs-text-dim';
  if (rssi > -80) return 'text-cs-online';
  if (rssi > -96) return 'text-cs-text-muted';
  return 'text-cs-warn';
}

export function PacketRow({
  packet,
  selected,
  onSelect,
}: {
  packet: LivePacket;
  selected: boolean;
  onSelect: () => void;
}) {
  const timeFormat = useStore((s) => s.appSettings.timeFormat);
  // Only mesh packets decode as mesh frames; companion (BLE) frames are summarized
  // from their own companion-protocol layout instead (summary stays null for them).
  const summary: PacketSummary | null = useMemo(
    () => (packet.kind === 'companion' ? null : summarizePacket(packet.payloadHex)),
    [packet.payloadHex, packet.kind],
  );
  const b = badge(packet, summary);
  const typeName = summary ? spaceWords(summary.typeName) : (packet.codeName ?? 'BLE').replace(/_/g, ' ');
  const detail = summary ? (summary.detail ?? '') : summarizeBleFrame(packet.payloadHex, packet.codeName);
  const hop = summary ? String(summary.decoded?.pathLength ?? 0) : '—';
  return (
    <button
      type="button"
      data-testid="packet-row"
      onClick={onSelect}
      className={`grid ${PACKET_GRID} w-full items-center gap-2 border-l-2 px-3.5 py-1.5 text-left ${selected ? 'border-cs-accent bg-cs-bg-3' : 'border-transparent hover:bg-cs-bg-2'} cursor-pointer`}
    >
      <span className="truncate font-mono text-[11px] text-cs-text-dim">
        {fmtTimePrecise(packet.timestamp, timeFormat).replace(/\.\d+/, '')}
      </span>
      <span className="flex min-w-0 items-center gap-2">
        <span
          className="flex size-[18px] shrink-0 items-center justify-center rounded font-mono text-[11px] font-bold"
          style={{ background: `rgb(var(${b.varName}))`, color: 'rgb(var(--cs-bg))' }}
        >
          {b.letter}
        </span>
        <span className="truncate text-[12.5px] text-cs-text">{typeName}</span>
      </span>
      <span className="truncate text-[12.5px] text-cs-text-muted">{detail || '—'}</span>
      <span className={`truncate font-mono text-[11px] ${rssiClass(packet.rssi)}`}>
        {packet.rssi == null || packet.snr == null ? '—' : `${packet.rssi} / ${packet.snr}`}
      </span>
      <span className="text-right font-mono text-[11px] text-cs-text-muted">{hop}</span>
    </button>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run --project dom tests/component/packet-log-row.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Format + commit**

```bash
npx biome check --write src/renderer/components/PacketRow.tsx tests/component/packet-log-row.test.tsx
git add src/renderer/components/PacketRow.tsx tests/component/packet-log-row.test.tsx
git commit -m "feat(packetlog): extract standalone PacketRow component"
```

Note: `PacketLog.tsx` still defines its own `Row`/`GRID` at this point — Task 3 removes them and switches to the imports. `tsc` is run in Task 4 after the swap, so a transient unused-symbol state here is expected.

---

## Task 3: Swap `PacketLog` to `VirtuosoMessageList`

**Files:**
- Modify: `src/renderer/components/PacketLog.tsx`

**Interfaces:**
- Consumes: `PacketRow`, `PACKET_GRID` from `./PacketRow`; `filterPackets` from `../lib/packetLogFilter`; `scrollToBottomIfAtBottom`, `VirtuosoMessageList`, `VirtuosoMessageListLicense` from `@virtuoso.dev/message-list`; `VIRTUOSO_LICENSE_KEY` from `../lib/virtuosoLicense`.
- Produces: unchanged `PacketLog({ packets }: { packets: LivePacket[] })` export.

Replace the whole file. Removed vs. current: the `react-virtuoso` import, the local `Row`/`badge`/`rssiClass`/`GRID`, `INITIAL_RENDER_COUNT`, the `virtuosoRef`, and the mount-only `scrollToIndex` effect. Added: the message-list wiring with `initialLocation` and the `scrollToBottomIfAtBottom` scroll modifier. The toolbar header and column header are unchanged from the current file (including the `border-l-2 border-l-transparent` alignment on the column header).

```tsx
import { scrollToBottomIfAtBottom, VirtuosoMessageList, VirtuosoMessageListLicense } from '@virtuoso.dev/message-list';
import { Layers, Radio, Search, Waypoints } from 'lucide-react';
import { useMemo, useState } from 'react';
import { filterPackets } from '../lib/packetLogFilter';
import { type LivePacket, useStore } from '../lib/store';
import { VIRTUOSO_LICENSE_KEY } from '../lib/virtuosoLicense';
import { PACKET_GRID, PacketRow } from './PacketRow';

interface Props {
  packets: LivePacket[];
}

interface RowContext {
  selectedId: string | null;
  onSelect: (id: string) => void;
}

const SOURCES = [
  { k: 'both', label: 'Both', Icon: Layers },
  { k: 'rf', label: 'RF', Icon: Radio },
  { k: 'ble', label: 'BLE', Icon: Waypoints },
] as const;

const NoMatches = () => (
  <div className="py-12 text-center text-[12.5px] text-cs-text-dim">No packets match this filter.</div>
);

const ItemContent = ({ data, context }: { data: LivePacket; context: RowContext }) => (
  <PacketRow packet={data} selected={context.selectedId === data.id} onSelect={() => context.onSelect(data.id)} />
);

export function PacketLog({ packets }: Props) {
  const source = useStore((s) => s.ui.packetLogFilter.source);
  const setPacketLogFilter = useStore((s) => s.setPacketLogFilter);
  const selectedId = useStore((s) => s.selectedPacketId);
  const setSelectedPacket = useStore((s) => s.setSelectedPacket);
  const rightOpen = useStore((s) => s.ui.rightOpen);
  const toggleRightRail = useStore((s) => s.toggleRightRail);
  const [q, setQ] = useState('');

  const visible = useMemo(() => filterPackets(packets, { source, query: q }), [packets, source, q]);

  const onSelect = (id: string) => {
    setSelectedPacket(selectedId === id ? null : id);
    if (!rightOpen) toggleRightRail();
  };

  // Stick to the newest packet only when the viewport is already at the bottom;
  // a scrolled-up user (inspecting an older packet) keeps their position.
  const listData = useMemo(
    () => ({
      data: visible,
      scrollModifier: { type: 'auto-scroll-to-bottom' as const, autoScroll: scrollToBottomIfAtBottom },
    }),
    [visible],
  );

  const context: RowContext = { selectedId, onSelect };

  return (
    <section className="flex min-h-0 flex-1 flex-col">
      <header className="flex shrink-0 flex-wrap items-center gap-3 border-b border-cs-border bg-cs-bg-2 px-4 py-3">
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
            className="h-7 w-52 rounded border border-cs-border bg-cs-bg-2 pr-2.5 pl-7 text-[12px] text-cs-text outline-none focus:border-cs-accent"
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

      {/* The transparent left border mirrors the row's selection stripe so the column
          labels line up with the row text instead of sitting 2px left of it. */}
      <div
        className={`grid ${PACKET_GRID} shrink-0 gap-2 border-b border-l-2 border-cs-border border-l-transparent px-3.5 py-1.5 font-mono text-[9.5px] tracking-wide text-cs-text-dim`}
      >
        <span>TIME</span>
        <span>TYPE</span>
        <span>DETAILS</span>
        <span>RSSI/SNR</span>
        <span className="text-right">HOP</span>
      </div>

      <div className="min-h-0 flex-1">
        <VirtuosoMessageListLicense licenseKey={VIRTUOSO_LICENSE_KEY}>
          <VirtuosoMessageList<LivePacket, RowContext>
            data={listData}
            context={context}
            initialLocation={{ index: 'LAST', align: 'end' }}
            computeItemKey={({ data }) => data.id}
            ItemContent={ItemContent}
            EmptyPlaceholder={NoMatches}
            style={{ height: '100%' }}
          />
        </VirtuosoMessageListLicense>
      </div>
    </section>
  );
}
```

- [ ] **Step 1: Replace the file** with the contents above.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: PASS (no errors). In particular, `react-virtuoso` is no longer imported anywhere in `src`.

- [ ] **Step 3: Confirm no other `react-virtuoso` importers remain**

Run: `grep -rn "react-virtuoso" src tests`
Expected: no output.

- [ ] **Step 4: Format + commit**

```bash
npx biome check --write src/renderer/components/PacketLog.tsx
git add src/renderer/components/PacketLog.tsx
git commit -m "feat(packetlog): render with VirtuosoMessageList + scrollToBottomIfAtBottom"
```

---

## Task 4: Trim the superseded component tests

**Files:**
- Modify: `tests/component/packet-log-select.test.tsx`

The five tests in the `describe('PacketLog list', ...)` block render `PacketLog` and count `packet-row`s — they cannot survive the swap (VirtuosoMessageList renders one row under jsdom). Their coverage now lives in Task 1 (`filterPackets`) and Task 2 (`PacketRow`). Remove that block and the now-unused imports; keep the `describe('packet deselect-on-outside-click', ...)` block and its `Harness`, which don't render `PacketLog`.

- [ ] **Step 1: Edit the file** to this exact content:

```tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useStore } from '@/lib/store';
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

- [ ] **Step 2: Run the trimmed file**

Run: `npx vitest run --project dom tests/component/packet-log-select.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 3: Run the full renderer test suites** to confirm nothing else referenced the removed block:

Run: `npx vitest run --project unit --project dom`
Expected: PASS (all green; suite count drops by the 5 removed tests and rises by the 6 filter + 3 row tests added).

- [ ] **Step 4: Format + commit**

```bash
npx biome check --write tests/component/packet-log-select.test.tsx
git add tests/component/packet-log-select.test.tsx
git commit -m "test(packetlog): drop list-render tests superseded by filter+row units"
```

---

## Task 5: Extend the e2e spec to cover the real list

**Files:**
- Modify: `tests/e2e/packet-log.spec.ts`

The existing spec only asserts the toolbar header mounts. Add a test that the real virtualized list renders at least one row from the replay fixture and that clicking a row opens the byte-breakdown inspector in the right rail. The rail's selected-packet view renders the string **"Packet Byte Breakdown"** (`src/renderer/components/packet/PacketDetailsRail.tsx`); its empty state renders **"Select a packet to see its full byte-level breakdown."**

**Fixture check:** the default fixture (`tests/fixtures/frames/e2e-connect.json`) replays two frames as companion packets, which should yield rows. This is unverified today. Step 2 confirms it; if it yields zero rows, use the fallback in Step 3 before writing the assertion.

- [ ] **Step 1: Add the test** to `tests/e2e/packet-log.spec.ts` (append a second `test(...)`, reusing the existing `launchApp` import):

```ts
test('Packet Log lists live packets and opens the byte breakdown on row click', async () => {
  const { page, close } = await launchApp();
  try {
    await page.getByRole('button', { name: 'Packet Log' }).click();
    await expect(page.getByText('RAW PACKETS')).toBeVisible();

    // The replay fixture feeds packets onto the bus; at least one row renders.
    const rows = page.getByTestId('packet-row');
    await expect(rows.first()).toBeVisible();

    // Clicking a row selects it and opens the right-rail byte breakdown.
    await rows.first().click();
    await expect(page.getByText('Packet Byte Breakdown')).toBeVisible();
  } finally {
    await close();
  }
});
```

- [ ] **Step 2: Build, then run the e2e spec**

Run (Bash sandbox disabled — Electron writes to `~/Library/Caches`; quit any installed CoreSense first, it steals loopback :7654):
```bash
npx electron-forge package
npx playwright test tests/e2e/packet-log.spec.ts
```
Expected: both tests PASS.

- [ ] **Step 3: If the new test fails because no rows render** — the default fixture produced no packet rows. Create `tests/fixtures/frames/e2e-packets.json` with a mesh frame the decoder accepts, and pass it to `launchApp`:

```ts
// tests/fixtures/frames/e2e-packets.json
[{ "hex": "84001501782abbcc00112233" }]
```
```ts
const { page, close } = await launchApp({ fixture: 'tests/fixtures/frames/e2e-packets.json' });
```
Re-run Step 2. (`0x84` is the mesh RX_DATA frame prefix the replay path maps to a mesh packet; `1501782abbcc00112233` is the known-good GroupText payload already used in this spec. Adjust only if the replay transport rejects the frame — inspect its parser in `src/main` and match the expected prefix/length.)

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/packet-log.spec.ts
# include the fixture only if Step 3 was needed:
# git add tests/fixtures/frames/e2e-packets.json
git commit -m "test(packetlog): e2e list renders rows and opens byte breakdown"
```

---

## Task 6: Remove the `react-virtuoso` dependency

**Files:**
- Modify: `package.json`

**Interfaces:**
- Consumes: nothing. Precondition: Task 3 Step 3 already proved `src`/`tests` have no `react-virtuoso` importers.

- [ ] **Step 1: Confirm zero importers once more**

Run: `grep -rn "react-virtuoso" src tests`
Expected: no output.

- [ ] **Step 2: Remove the dependency line** from `package.json` (`"react-virtuoso": "^4.18.7",` under `dependencies`).

- [ ] **Step 3: Reinstall to update the lockfile**

Run (Bash sandbox disabled — network + `.gitmodules` writes; per worktree-vitest-ops, verify success by binary count, not exit code):
```bash
pnpm install
ls node_modules/.bin | wc -l   # expect ~63; if near-zero the install half-failed, re-run
```
Expected: `pnpm-lock.yaml` updated, `react-virtuoso` gone from it.

- [ ] **Step 4: Verify nothing broke**

Run:
```bash
npx tsc --noEmit -p tsconfig.json
npx vitest run --project unit --project dom
grep -rn "react-virtuoso" src tests pnpm-lock.yaml
```
Expected: typecheck PASS, tests PASS, `grep` shows no matches (including the lockfile).

- [ ] **Step 5: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "chore(packetlog): drop react-virtuoso, now unused"
```

---

## Task 7: Full verification

**Files:** none (verification only).

- [ ] **Step 1: Whole suite + typecheck + lint**

Run:
```bash
npx tsc --noEmit -p tsconfig.json
npx vitest run
npx biome check src tests
```
Expected: all PASS.

- [ ] **Step 2: Drive the real app** (Bash sandbox disabled; quit any installed CoreSense first)

Use the e2e launcher or a scratch Playwright script (`tests/e2e/support/launch.ts`, `launchApp`) to:
1. Open the Packet Log; confirm rows render and the newest is in view on open.
2. Scroll up a few rows; confirm arriving packets (the fixture keeps feeding) do **not** yank the viewport back to the bottom.
3. Scroll back to the bottom; confirm following resumes and new packets appear at the bottom.
4. Click a row; confirm the right-rail byte breakdown opens for it.

Screenshot the scrolled-up-with-new-arrivals state and the open breakdown as evidence.

- [ ] **Step 3: Invoke `superpowers:requesting-code-review`** on the branch before merge.

---

## Self-Review

**Spec coverage:**
- Scroll behavior (stick-at-bottom via `scrollToBottomIfAtBottom`, `initialLocation` for first paint) → Task 3.
- Component structure (`packetLogFilter.ts`, `PacketRow.tsx`, slimmed `PacketLog.tsx`, context-passed row props, deleted `initialItemCount`/`scrollToIndex`) → Tasks 1–3.
- Test strategy (filter unit, row component, trimmed select test, extended e2e) → Tasks 1, 2, 4, 5.
- Dependency removal → Task 6.
- Verification (drive the app, confirm no-yank) → Task 7.

**Placeholder scan:** No TBD/TODO; every code step has full content. The one conditional (Task 5 Step 3 fixture) has exact file content and a concrete trigger.

**Type consistency:** `filterPackets(packets, { source, query })` defined in Task 1 is consumed with that exact shape in Task 3. `PacketRow` props `{ packet, selected, onSelect }` and export `PACKET_GRID` defined in Task 2 match the `ItemContent` adapter and column-header className in Task 3. `RowContext` `{ selectedId, onSelect }` is internal to Task 3 and used consistently by `ItemContent` and the `context` prop. `scrollToBottomIfAtBottom` is imported from `@virtuoso.dev/message-list` (verified exported at runtime).
