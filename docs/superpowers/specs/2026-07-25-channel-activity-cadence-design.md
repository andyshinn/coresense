# Channel Activity — Cadence

Redesign of the **Activity** section in the channel right rail.

Design handoff: `docs/design/channel-activity-cadence/` (`README.md` is the authoritative
visual spec; `Activity - Cadence.html` is the live reference; `Channel Activity.html` is the
five-concept option canvas, context only).

## Problem

`src/renderer/shell/rightrail/sections/ChannelActivity.tsx` is 32 lines and renders three
things, two of which are wrong:

1. `123 in 24h · 412 in 7d` — two raw totals with no baseline. A number without a comparison
   can't tell you whether a channel is busy or dying.
2. A 7-bar `Sparkline` with no axis, no labels, and no hover. Nothing on screen says the bars
   are days.
3. `First seen December 31, 1969 · 20649d · ~0.2/day` — a null timestamp coerced to the Unix
   epoch, with the age and per-day rate derived from it. All three values are garbage.

It also renders identically at every rail width, even though the rail is drag-resizable from
240px to 640px.

Two data inconsistencies are worth naming because the redesign resolves them:

- `count7d` is a **rolling 168-hour** count while `perDay` is **7 local calendar days**, so
  `sum(perDay) !== count7d` in general — the number and the chart beside it describe
  different periods.
- `getChannelStats` in `src/main/state/holder.ts:225` does not forward a `now` parameter, so
  `statsByKey`'s injectable clock (its testability seam) is unused in production.

## Goals

- Recreate the Cadence design in the existing React + CoreSense environment.
- Make the section width-aware: full at ≥304px rail width, collapsed below.
- Serve real 24h/7d/30d histograms, trend-vs-previous-period, and rhythm bands.
- Delete the epoch bug.

## Non-goals

- The other four concepts from the option canvas (Tempo heatmap, Reach hop-distance bars,
  the composite Overview). Cadence ships alone.
- Click-to-filter the message list by bucket. The handoff explicitly defers it.
- Changing `--font-mono` so JetBrains Mono actually wins on macOS (see Deviations).
- Deduplicating the two existing `/stats` fetches (Activity + People). Out of scope; noted
  under Risks.

---

## 1. Data layer

### 1.1 New endpoint

`GET /api/channels/:key/activity` — a new Hono route beside the existing stats route in
`src/main/api/routes.ts:443`, with the same `ch:` key guard and 400 response shape.

A dedicated endpoint rather than extending `ChannelStats`, because `ChannelStats` is also
fetched by the People section on every message push; widening it would make People's fetch
pay for a 60-day scan it never reads.

### 1.2 Shared type

New in `src/shared/types.ts`, beside `ChannelStats` (~line 229):

```ts
/** One window of the channel Activity chart. `total` is always the sum of `buckets`. */
export interface ActivityWindow {
  /** Bucket counts, oldest→newest. Length is 24 (hourly), 7 or 30 (daily). */
  buckets: number[];
  /** Sum of `buckets`. Never diverges from what the chart draws. */
  total: number;
  /** Same-length immediately-preceding period. 0 when there is no prior history. */
  prevTotal: number;
  /** Epoch ms of the first bucket's start edge — lets the renderer label the axis. */
  startMs: number;
}

/** Hour-of-day band, inclusive start, exclusive end, local time. `end` may wrap past 24. */
export interface ActivityBand {
  startHour: number;
  endHour: number;
}

export interface ChannelActivity {
  windows: { '24h': ActivityWindow; '7d': ActivityWindow; '30d': ActivityWindow };
  /** Busiest 3h band over the trailing 7 days. null when too sparse to name. */
  peakBand: ActivityBand | null;
  /** Calmest 4h band over the trailing 7 days. null when too sparse to name. */
  quietBand: ActivityBand | null;
  /** Epoch ms of the most recent message, or null for an empty channel. */
  lastTs: number | null;
}

export type ActivityWindowKey = '24h' | '7d' | '30d';
```

`startMs` is included so axis ticks and tooltip labels are computed from real bucket edges
rather than re-derived in the renderer from a possibly-drifted `Date.now()`.

### 1.3 Query

One new function in `src/main/storage/messages.ts`, following `statsByKey`'s conventions
(`openDb()` per call, `as unknown as` row casts, an injectable `now`, an empty-shaped struct
rather than null for unknown keys):

```ts
activityByKey(key: string, now: number = Date.now()): ChannelActivity
```

A single read — `SELECT ts FROM messages WHERE key = ? AND ts >= ?` with the cutoff at
**60 days** (30d window + its 30d previous period), bucketed in JS. Covered by the existing
`messages_by_key_ts` index and reads only `ts`, so it stays cheap. History is de facto
unbounded (`trimPerKey` exists but is never called from production), so 30+ days genuinely
exist for any long-running channel.

Expose via a thin passthrough `getChannelActivity(key)` on `src/main/state/holder.ts`,
matching `getChannelStats` at line 225.

### 1.4 Bucketing rules

| window | buckets | edges |
|---|---|---|
| `24h` | 24 hourly | **Trailing.** Last bucket is the current partial hour; bucket 0 starts 23 hours before the current hour's start. |
| `7d` | 7 local calendar days | Last bucket is today (partial). Same semantics as today's `perDay`. |
| `30d` | 30 local calendar days | Last bucket is today (partial). |

24h is trailing, not midnight-anchored, so the chart is always full. A calendar-day-anchored
24h window would render 14 empty bars at 9am.

Calendar-day bucketing uses `setHours(0, 0, 0, 0)` on a `Date` seeded from `now`, matching
`statsByKey:123-125`, so DST transitions and local timezone are handled the same way they
already are.

`prevTotal` is counted from the same fetched `ts` rows — no second query — over the
immediately preceding period of equal length: the 24 hours before the 24h window's `startMs`,
the 7 calendar days before the 7d window's first day, the 30 calendar days before the 30d
window's first day.

**`total` is always `sum(buckets)`.** This is the deliberate fix for the `count7d` vs
`perDay` divergence: the lead number describes exactly the bars underneath it. The
consequence — that the 7d window is 6 full days plus today's partial, not a rolling 168h —
is correct and intended.

### 1.5 Rhythm bands

Computed from a **24-slot hour-of-day histogram over the trailing 168 hours** (a rolling
window — calendar alignment is irrelevant when the output is an hour-of-day band), and
independent of the selected window. The bands describe the channel's habitual rhythm ("when is this channel
usually busy"), not a statistic of whatever tab is active, which is why they don't change on
tab click. This matches how the reference renders them — the same `Peak 7–10 PM · quiet
2–6 AM` appears under all three window states.

- `peakBand` — the contiguous **3-hour** window with the highest total, searched circularly
  so a band may wrap midnight (e.g. `23`→`2`).
- `quietBand` — the contiguous **4-hour** window with the lowest total, same circular search.
- Ties break toward the **earlier** start hour, so the result is deterministic and testable.

**Sparsity guard:** both bands are `null` when that same trailing-168h histogram sums to
`< 8` (roughly one message per day). Naming a "peak" from three messages is noise dressed as
insight. When `peakBand` is null the footer degrades to just the last-message clause. Note
this threshold is checked against the 168h histogram total, **not** against
`windows['7d'].total`, which is calendar-bucketed and will differ slightly.

### 1.6 Edge cases

| condition | behaviour |
|---|---|
| `total === 0` | Render `0`. Every bar falls to the `max(3%, …)` floor — with the 2px `min-height`, that draws as a flat baseline. |
| `prevTotal === 0` | **Hide the trend chip.** No percentage is computable. Never `NaN%` / `Infinity%` / `∞`. |
| `total === 0 && prevTotal > 0` | Trend chip shows `▼ 100%`. |
| trailing-7d total `< 8` | `peakBand` and `quietBand` both null; footer shows only `last msg …`. |
| `lastTs === null` | The channel has never had a message. Render the existing `Placeholder` (`no activity yet`) instead of the chart — this is the only case that short-circuits the whole body. A channel with history but a quiet window still renders the full `0` + flat-baseline treatment above. |
| `activity === null` | Still loading, or the fetch failed. `Placeholder label="loading…"` while `loading`, otherwise the error line (see §5). |
| fetch error | Render the error, not a permanent "no activity yet" (see §5). |

`trendPct = Math.round((total - prevTotal) / prevTotal * 100)`, guarded on `prevTotal > 0`.

### 1.7 Renderer client + hook

- `src/renderer/lib/api.ts` — one line beside `getChannelStats` at line 152:
  `getChannelActivity: (c, key) => request<ChannelActivity>(c, \`/api/channels/${encodeURIComponent(key)}/activity\`)`
- `src/renderer/hooks/useChannelActivity.ts` — mirrors `useChannelStats`: local `useState`,
  `cancelled` flag in the effect cleanup, and `useStore((s) => s.messagesByKey[key])` as the
  refetch trigger (the WS `messages` push replaces that array's identity). Returns
  `{ activity, loading, error }`.
- **Plus a 5-minute interval refetch while mounted.** Nothing in the app invalidates on
  wall-clock rollover today, so an idle channel's trailing-24h window and "3m ago" label
  drift stale indefinitely. Five minutes is coarse enough to be free and fine enough that
  the hour buckets stay honest.

The hook only runs when the section is expanded — `Collapsible` renders
`{open && <div>{children}</div>}` (`src/renderer/components/Collapsible.tsx:38`) and
`rail.channel.activity` has `defaultOpen: false` — so a collapsed rail costs nothing.

---

## 2. Renderer components

`ChannelActivity.tsx` becomes a folder,
`src/renderer/shell/rightrail/sections/channel-activity/`:

| file | contents |
|---|---|
| `index.tsx` | `ChannelActivitySection` (wrapper, calls the hook) + `ActivityBody` (presentational — what DOM tests render) |
| `WindowTabs.tsx` | the 24h/7d/30d `ToggleGroup` |
| `VolumeChart.tsx` | flex-div bars, axis ticks, per-bar tooltips |
| `TrendChip.tsx` | the ▲/▼ percentage chip |
| `RhythmFooter.tsx` | the peak · quiet · last-msg line |
| `activity.ts` | pure helpers: `trendPct`, `axisTicks`, `bucketLabel`, `fmtBand`, `chartAriaLabel` |

Moving the file changes its import path, so `sectionsFor.tsx:189` (the
`rail.channel.activity` entry's `body` thunk) and the DOM test's `@/shell/rightrail/sections/
ChannelActivity` import both need updating. The section's registered `id`, `label` and
`defaultOpen: false` are unchanged, so persisted `openRailSections` state survives.

Splitting the presentational body from the fetching wrapper follows the existing
`ChannelActivityBody` / `ChannelActivitySection` pattern, so component tests keep rendering
the body with a literal payload and never mock the API. Pure helpers in `activity.ts` get
node unit tests, following the `SignalBars.tsx` precedent (exported helpers + thin
component).

### 2.1 Window tabs

The existing `ToggleGroup` (`src/renderer/components/ui/toggle-group.tsx`, `type="single"`),
className-overridden to the spec's compact form. Radix gives arrow-key roving focus, which a
hand-rolled `PillTabs`-style control would not.

Its shadcn defaults all need overriding via `cn()`:

| default | needed |
|---|---|
| `size="sm"` → `h-8 px-1.5` | `px-[9px] py-1`, auto height |
| `rounded-none first:rounded-l-md last:rounded-r-md` | `rounded-[5px]` on every item |
| `data-[state=on]:bg-accent` (→ `cs-bg-3`, no accent tint) | `data-[state=on]:bg-cs-bg data-[state=on]:text-cs-accent` |
| `min-w-0 flex-1 shrink-0` | compact `inline-flex`, not full-width |

Container: `inline-flex gap-0.5 rounded-[7px] border border-cs-border bg-cs-bg-3 p-0.5`,
`mb-3`. Item text: `font-mono text-[10.5px] font-medium text-cs-text-muted
hover:text-cs-text`. Selected item also gets the faint bottom shadow from the reference.

Each item needs an explicit `aria-label` (`Last 24 hours` / `Last 7 days` / `Last 30 days`)
— `24h` alone is not a comprehensible label read aloud.

### 2.2 Lead number, unit, trend chip

One baseline row: `flex items-baseline gap-2`.

- Number: `font-mono font-semibold tabular-nums tracking-[-0.01em] text-cs-text`, `text-[30px]`
  full / `text-[21px]` collapsed.
- Unit: `text-cs-text-muted`, `text-[12.5px]` full reading `in 24h` / `in 7d` / `in 30d`;
  `text-[11.5px]` collapsed reading `msgs · 24h`.
- Trend chip: `ml-auto inline-flex items-center gap-[3px] rounded-[5px] px-1.5 py-0.5
  font-mono text-[11px] font-semibold whitespace-nowrap`, with a leading lucide
  `ArrowUp`/`ArrowDown` at `size-2.5`. Trailing `vs prev` in a nested
  `font-normal opacity-70` span — **omitted in collapsed mode**.

### 2.3 Volume chart

Plain flex `div` bars. No charting library — the handoff explicitly keeps this off the
component-dependency list.

- Plot row: `flex items-end gap-0.5`, height `74px` full / `30px` collapsed.
- Cell: `flex-1 flex items-end`, `hover:bg-cs-accent/9`, `rounded-t-[2px]`.
- Bar: `w-full bg-cs-accent rounded-t-[2px] min-h-[2px]`, inline
  `height: max(3%, value / windowMax * 100%)`, `transition-[height] duration-[180ms]
  ease-out motion-reduce:transition-none`.
- `windowMax = Math.max(1, ...buckets)` so an all-zero window renders a flat baseline
  instead of dividing by zero (same guard `Sparkline.tsx:14` already uses).

**Axis ticks** — `flex gap-0.5 mt-1.5`, each cell `flex-1 text-center font-mono
text-[8.5px] text-cs-text-dim`. Computed from each bucket's real start edge, not hardcoded:

| window | rule |
|---|---|
| `24h` | label buckets whose local hour is 0/6/12/18 as `12a`/`6a`/`12p`/`6p`; the final bucket is always `now` and wins any collision |
| `7d` | first letter of each day's local weekday name — all 7 labelled |
| `30d` | `30d` at index 0, `20d` at 10, `10d` at 20, `now` at 29 |

Hardcoding `M T W T F S S` would be wrong on any day that isn't Sunday.

**Hidden in collapsed mode.**

**Tooltips** — the existing `Tooltip` on each cell, showing `«count» msg(s) · «bucket label»`
(`14 msgs · 6 PM`, `78 msgs · Mon`, `72 msgs · 8d ago`, and `today` for the last 30d bucket).
`TooltipProvider` is already mounted via `SidebarProvider` in `AppShell.tsx:58`, so the rail
is covered and no new provider is needed; DOM tests must wrap in their own.
**Full mode only** — no tooltips in collapsed mode, per the handoff.

**Accessibility.** Bars and cells are `aria-hidden`. The plot gets `role="img"` with a
generated `aria-label` summarizing the window, e.g.
`Message volume by hour, last 24 hours. 123 messages, busiest 14 at 6 PM.` This matches how
`Sparkline.tsx:21` and `SignalBars.tsx` already expose SVG gauges. Hover read-outs stay a
pointer-only enhancement, exactly as the handoff frames them — making 30 bars focusable
would add 30 tab stops to the rail for no gain.

### 2.4 Rhythm footer

`mt-[13px] text-[11px] text-cs-text-muted`, values in `font-semibold text-cs-text`,
`·` separators in `text-cs-text-dim`.

- Full: `Peak «7–10 PM» · quiet «2–6 AM» · last msg «3m ago»`
- Collapsed: `Peak «7–10 PM» · last msg «3m ago»`
- Bands null: `last msg «3m ago»` only.

Band formatting collapses whole hours to a 12-hour clock with a shared meridiem where
possible (`7–10 PM`, `2–6 AM`), falling back to both (`11 PM–2 AM`) when the band wraps.

### 2.5 Window state and persistence

The handoff says to persist the selected window "if the app already persists rail
preferences" — it does, so we persist. **Global, not per-channel:** the window is a reading
habit ("I care about the last week"), not a property of a channel, and a per-channel map
would grow unbounded in `ui-state.json` with one entry per channel ever opened.

Four touchpoints, following the `packetLogFilter` precedent exactly:

| file | change |
|---|---|
| `src/shared/types.ts` (~:788) | `channelActivityWindow: ActivityWindowKey;` on `UiState` |
| `src/shared/types.ts` (~:842) | `channelActivityWindow: '24h',` in `DEFAULT_UI_STATE` |
| `src/renderer/lib/store.ts` (~:421) | `setChannelActivityWindow: (w: ActivityWindowKey) => void;` |
| `src/renderer/lib/store.ts` (~:889) | the `set((s) => ({ ui: { ...s.ui, channelActivityWindow: w } }))` impl |

Nothing else is needed: the debounced effect in `App.tsx:187-198` persists the whole `ui`
object, and `mergeDefaults` (`src/main/storage/settings.ts:174-190`) is recursive, so
existing installs pick up the `'24h'` default automatically.

Like `rightWidth` and `packetLogFilter`, this stays **write-through only** — it is
deliberately *not* added to the synced subset in `applyUiState`
(`src/renderer/lib/store.ts:762-769`). It is restored at next launch but not echoed back
into a live session, which also avoids the PUT-echo loop that syncing would require an
equality check to prevent.

Collapsed mode pins the window to `24h` for display without writing to the store, so widening
the rail restores whatever tab the user had chosen.

---

## 3. Width mode

```ts
const mode = useStore((s) => s.ui.rightWidth) < 304 ? 'collapsed' : 'full';
```

No `ResizeObserver` and no container query: the rail's px width already lives in the zustand
store (`ui.rightWidth`, `src/shared/types.ts:778`) and is set by the drag handler in
`ResizeHandle.tsx`. Every descendant can read it with the same one-liner the rail itself uses
at `rightrail/index.tsx:20`. This would be the codebase's first width-aware component —
there are currently zero `ResizeObserver` or `@container` usages in `src/renderer`.

Rail bounds are **min 240 / default 320 / max 640** (`ResizeHandle.tsx:3-4`,
`types.ts:831`). The 304 threshold sits 16px below the default, so a user at the default
width is close to the collapse point and a small leftward drag flips the mode. That is the
design's own number and the 240–640 range straddles it deliberately — keeping it.

`ui.rightWidth` is the rail's **outer** width, which is what the reference measured (its
mock rails are 280px and 460px wide). No padding subtraction.

---

## 4. Design tokens

The handoff's palette is dark-only. Measured against the trend chip's **own 13% fill**
composited over the rail surface — not against the page, which overstates by ~1 point and is
the exact mistake the `:root:not(.dark)` comment at `index.css:52-57` was written to prevent:

| chip colour | dark worst | light worst |
|---|---|---|
| design up `#84CC16` | **6.71** ✓ | 2.08 ✗ |
| design down `#E5695F` | 4.43 ✗ | 2.14 ✗ |
| app `--cs-danger` `#DC2626` | 3.20 ✗ | 3.94 ✗ |

Worst-case across `cs-bg`, `cs-bg-2` (the rail's actual surface, `rightrail/index.tsx:87`)
and `cs-bg-3`. Reusing `--cs-online` / `--cs-danger` fails AA in dark, and `--cs-danger` is
additionally the same red as the destructive Delete buttons — which contradicts the
handoff's "trend is a sign, not a verdict."

**Two new tokens**, following the `--cs-hash-*` precedent exactly: dark values in `:root`
(`index.css:17-44`), light overrides in `:root:not(.dark)` (`index.css:58-62`), and named
Tailwind registrations in the `@theme` block (`index.css:89-108`). These are CSS-only and are
deliberately **not** added to the `Palette` in `lib/theme.ts` — the hash tints establish that
tints which need per-theme tuning live in CSS, since `applyTheme()` only writes Palette keys.

| token | dark | worst | light | worst |
|---|---|---|---|---|
| `--cs-trend-up` | `132 204 22` `#84CC16` | 6.71 | `54 83 20` `#365314` | 5.37 |
| `--cs-trend-down` | `232 117 107` `#E8756B` | 4.81 | `139 37 32` `#8B2520` | 5.33 |

Dark up keeps the design's exact value. Dark down nudges the design's coral one step lighter
(`#E5695F` → `#E8756B`) to clear 4.5 on `bg-3`; visually near-identical, and lighter is the
correct direction on a dark substrate. Light down is a warm coral-leaning red, deliberately
distinct from the light `--cs-danger` (`#B91C1C`).

Usage: `text-cs-trend-up bg-cs-trend-up/13` and `text-cs-trend-down bg-cs-trend-down/13`.
Arbitrary slash-opacity on `cs-*` tokens is verified working in this Tailwind v4 setup —
`@theme` registration compiles `bg-cs-accent/9` to a `color-mix` over the live
`rgb(var(--cs-*))` triplet, so it tracks the runtime theme.

Bars, the active tab, and hover cells use the existing `--cs-accent` (`#F59E0B`, 6.23 worst
in dark — comfortable).

---

## 5. Removals and fixes

- **Delete the "first seen" line.** Per the handoff: show nothing. If a real join/first-heard
  date ever becomes available, render it plainly as a `KeyValueRow` with `unknown` for null —
  never the epoch.
- **Delete `src/renderer/components/Sparkline.tsx` and `tests/component/sparkline.test.tsx`.**
  This section is its only consumer; Cadence's chart is flex divs, not SVG.
- **Add `fmtAgoShort(ts, now = Date.now())` to `src/renderer/lib/time.ts`** with a node unit
  test. `fmtRelative` only produces the long `3 minutes ago`; the footer needs `3m ago`.
  Retire `DMView.tsx:140`'s private `fmtAgo` in favour of it rather than creating a third
  copy. `NeighbourList.tsx:26`'s `fmtSecsAgo` takes seconds, not ms — leave it alone.
- **Surface fetch errors.** `ChannelActivitySection` currently discards the hook's `error`,
  so a failed request renders as a permanent "no activity yet". The new section renders a
  short error line instead.

---

## 6. Testing

**Integration** (`tests/integration/storage/channel-activity.test.ts`) — real SQLite in a
temp userData dir, seeded via `messagesStore.insert`, with `now` pinned to local noon so
day-bucketing is DST- and timezone-stable (the pattern `channel-stats.test.ts` already uses).
Covers: bucket lengths per window; `total === sum(buckets)`; `prevTotal` boundary correctness
(a message one ms either side of an edge); trailing-24h alignment; the empty channel's
zero-shaped struct; the sparsity guard nulling both bands; peak/quiet band selection
including a midnight-wrapping band and the earlier-start tie-break.

**Route** (`tests/integration/api/routes.test.ts`) — 200 shape, and 400 for a non-`ch:` key.

**Unit** (`tests/unit/renderer/…`) — `activity.ts` helpers: `trendPct` including the
`prevTotal === 0` guard and the `total === 0` case; `axisTicks` for all three windows,
asserting 7d weekday initials are derived from the seeded date rather than hardcoded;
`bucketLabel`; `fmtBand` wrapping; `chartAriaLabel`. Plus `fmtAgoShort` in
`tests/unit/renderer/lib/time.test.ts`.

**DOM** (`tests/component/channel-activity-section.test.tsx`, rewritten) — the existing test
asserts the literal string `'12 in 24h · 47 in 7d'` and `container.querySelectorAll('rect')`
having length 7, both of which this change deletes. New coverage: full mode renders tabs +
24 bars + axis + three-clause footer; collapsed mode renders no tabs, no axis, 21px number,
two-clause footer; clicking `7d` re-renders 7 bars and the `in 7d` unit; trend chip absent
when `prevTotal === 0`; zero-total renders `0` with flat bars; error state renders the error.
Tests wrap in their own `TooltipProvider` (per `message-quick-bar.test.tsx:22`) and use plain
`expect(...).toBeTruthy()` — `@testing-library/jest-dom` is not installed.

Also: clicking a tab writes `ui.channelActivityWindow` to the store, and a body mounted with
a non-default stored window opens on that tab. Drive the store directly with
`useStore.setState(...)` inside `act`, per `tests/component/use-channel-stats.test.tsx`.

**Verification** — `npx tsc --noEmit`, `npx biome check src tests`, `npx vitest run`. Run
tooling via `npx`, not `pnpm <script>`, in this worktree.

---

## 7. Deliberate deviations from the handoff

- **Section padding stays the rail's existing `px-3`**, not the spec's `13px 14px 15px`.
  Activity would otherwise be inset differently from Channel info and Share this channel
  directly above and below it. Vertical rhythm inside the block follows the spec.
- **Trend colours** use the two new tokens above rather than the handoff's literal hexes, for
  the contrast reasons in §4.
- **JetBrains Mono will not actually render on macOS.** `--font-mono` is
  `ui-monospace, "JetBrains Mono", …` (`index.css:107`) and no font files ship with the app,
  so `ui-monospace` (SF Mono) wins on macOS. Pre-existing and repo-wide; not changed here.
- **Axis tick labels are computed, not hardcoded**, unlike the reference's static index→label
  maps.

## 8. Risks

- **Fetch fan-out.** Activity and People both call `useChannelStats`, and Activity now adds a
  third request on the same trigger. All three are gated behind `defaultOpen: false`
  collapsibles, so the cost is opt-in, but an expanded rail on a chatty channel will issue
  three requests per message push. Consolidating them is a reasonable follow-up.
- **Refetch chattiness.** The `messagesByKey[key]` trigger fires on message *state* changes
  too (delivery receipts, path-heard updates), not just new messages, so refetches are more
  frequent than "one per message".
- **Mode flip near the default width.** 304 sits 16px below the 320 default; users at the
  default will cross it with a small drag. Accepted (§3).
