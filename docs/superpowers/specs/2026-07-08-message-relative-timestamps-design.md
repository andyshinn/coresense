# Message Relative Timestamps — Design

- **Date:** 2026-07-08
- **Status:** Approved (design); pending implementation plan
- **Branch:** `feat/date-separators` (amends the conversation date-separators work)

## Goal

Show Discord-style relative timestamps on conversation messages. Today, a
message shows only its time; once it is no longer today it shows "Yesterday at
<time>"; older than that it shows a short date plus the time.

## Decisions

Settled during brainstorming:

- **Today** (same local calendar day as now): time only — e.g. `1:06 PM`.
- **Yesterday** (the previous local calendar day): `Yesterday at 1:15 PM`.
- **Older**: short numeric date + time — e.g. `7/2/26, 1:15 PM`.
- The **hover tooltip** keeps the full date+time (`fmtDateTime`), unchanged.
- The user's **12/24-hour preference** is honored for the time portion (via the
  existing `fmtTime`).
- "Yesterday" / "at" are English literals, consistent with the app's English UI.

## Non-goals

- No "Today at …" prefix for today (today is time-only, per the decision).
- No self-updating timer to flip Today→Yesterday at midnight while a row sits on
  screen; the label is computed at render time (messages re-render on scroll and
  on new activity). A per-row minute timer across the virtualized list is
  rejected as wasteful (YAGNI).
- No change to the system-event rows (e.g. contact "just landed"), which use a
  separate formatter.
- No change to `RelativeTime` / `fmtRelative` ("2 minutes ago"), used elsewhere.
- No localization of the "Yesterday"/"at" literals.

## Approach

Add one pure formatter to
[`src/renderer/lib/time.ts`](../../../src/renderer/lib/time.ts) and call it from
[`src/renderer/components/MessageItem.tsx`](../../../src/renderer/components/MessageItem.tsx).
All timestamp formatting already lives in `time.ts` (`fmtTime`, `fmtDateTime`,
`fmtRelative`, `dayKey`); this follows that pattern and reuses `fmtTime` so the
time portion matches every other timestamp in the app.

### `time.ts` — `fmtMessageTime`

```ts
fmtMessageTime(ts: number, pref: TimeFormatPref, now: number = Date.now()): string
```

Compute the local day boundaries from `now` and bucket `ts`:

- `startOfToday   = new Date(n.getFullYear(), n.getMonth(), n.getDate()).getTime()`
- `startOfYesterday = new Date(n.getFullYear(), n.getMonth(), n.getDate() - 1).getTime()`
  (`new Date(y, m, d-1)` normalizes month/year rollover and lands on local
  midnight, so it is correct across DST transitions.)

Return:

- `ts >= startOfToday` → `fmtTime(ts, pref)` (also covers future timestamps).
- `ts >= startOfYesterday` → `` `Yesterday at ${fmtTime(ts, pref)}` ``.
- else → `` `${new Date(ts).toLocaleDateString(undefined, { dateStyle: 'short' })}, ${fmtTime(ts, pref)}` ``.

`now` is injectable so the buckets are deterministic under test.

### `MessageItem.tsx`

Both timestamp sites currently render `fmtTime(message.ts, timeFormat)`:

- compact layout (the leading `shrink-0 tabular-nums` span)
- rich layout (the meta row span, alongside the state chip / path stats)

Replace both with `fmtMessageTime(message.ts, timeFormat)`. Keep
`title={fmtDateTime(message.ts, timeFormat)}` on both. Update the import from
`../lib/time` to bring in `fmtMessageTime` (and drop `fmtTime` if it is no longer
referenced in this file). No structural/JSX changes; the compact timestamp
column simply widens (`shrink-0`) for the longer "Yesterday at …" / dated
strings, matching Discord.

Because `MessageItem` is shared, the Unreads triage previews inherit the same
formatting — intended and desirable.

## Edge cases

| Case | Behavior |
|------|----------|
| ts earlier today | time only |
| ts at exactly local midnight today | time only ("today") |
| ts one ms before local midnight today | `Yesterday at …` |
| ts anytime yesterday | `Yesterday at …` |
| ts two+ days ago | `<short date>, <time>` |
| ts in the future (clock skew) | time only |
| across a DST boundary | correct (local-midnight day starts) |

## Testing (TDD)

Unit tests for `fmtMessageTime` with a fixed injected `now` and local-`Date`
inputs (TZ/locale-stable):

- today → equals `fmtTime(ts, pref)` exactly (no prefix, no date).
- yesterday → starts with `"Yesterday at "` and ends with `fmtTime(ts, pref)`.
- older → not prefixed with "Yesterday", contains `fmtTime(ts, pref)`, and is
  longer than the bare time (carries a date).
- boundary → local midnight today is "today"; one ms earlier is "Yesterday".
- honors `pref`: `'24h'` yields a 24-hour time in each tier.

No `MessageItem` render test (its timestamp uses `Date.now()` and the structure
is unchanged); coverage lives in the formatter tests.

## Files touched

- **Edit:** `src/renderer/lib/time.ts` (add `fmtMessageTime`)
- **Edit:** `src/renderer/components/MessageItem.tsx` (two call sites + import)
- **New tests:** `tests/unit/renderer/lib/time.test.ts` (add `fmtMessageTime` block)
