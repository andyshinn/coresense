# Message Relative Timestamps Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show Discord-style relative timestamps on conversation messages — today shows time only, yesterday shows "Yesterday at <time>", older shows a short date + time.

**Architecture:** Add one pure formatter `fmtMessageTime` to `src/renderer/lib/time.ts` (where all timestamp formatting already lives, reusing `fmtTime` so the 12/24h preference is honored) and call it from the two timestamp sites in `src/renderer/components/MessageItem.tsx`. The `now` argument is injectable for deterministic tests.

**Tech Stack:** TypeScript, React, Vitest, Biome, `Intl` (Electron full ICU — no date library).

## Global Constraints

- **Today** (same local calendar day as `now`): time only, e.g. `1:06 PM`.
- **Yesterday** (previous local calendar day): `Yesterday at 1:15 PM` (literal "Yesterday at ", capital Y, English).
- **Older**: short numeric date + time, e.g. `7/2/26, 1:15 PM` — `toLocaleDateString(undefined, { dateStyle: 'short' })` + `, ` + `fmtTime`.
- Time portion always via `fmtTime(ts, pref)` so the 12/24-hour preference is honored.
- Hover tooltip stays `fmtDateTime(message.ts, timeFormat)` (unchanged).
- Local-midnight day boundaries via `new Date(y, m, d)` / `new Date(y, m, d-1)` (DST-safe).
- Run Biome as `pnpm exec biome check src tests` (repo-wide `pnpm lint` trips on prebuilt `dist/out`).

---

### Task 1: `fmtMessageTime` helper

**Files:**
- Modify: `src/renderer/lib/time.ts` (append one function)
- Test: `tests/unit/renderer/lib/time.test.ts` (add one `describe` block; extend the import)

**Interfaces:**
- Consumes: existing `fmtTime(ts, pref)` and the `TimeFormatPref` type already imported in `time.ts`.
- Produces: `fmtMessageTime(ts: number, pref: TimeFormatPref, now?: number): string`.

- [ ] **Step 1: Write the failing tests**

In `tests/unit/renderer/lib/time.test.ts`, extend the existing import to add `fmtMessageTime` and `fmtTime`:

```ts
import { dayKey, fmtDate, fmtMessageTime, fmtRelative, fmtTime } from '../../../../src/renderer/lib/time';
```

Then append this block:

```ts
// now = 2026-07-08 12:00 local. Inputs use the local-time Date constructor so
// the today/yesterday/older buckets are stable regardless of the runner's TZ.
describe('fmtMessageTime', () => {
  const now = new Date(2026, 6, 8, 12, 0, 0).getTime();

  it('shows time only for a message earlier today (equals fmtTime)', () => {
    const ts = new Date(2026, 6, 8, 9, 30, 0).getTime();
    expect(fmtMessageTime(ts, 'auto', now)).toBe(fmtTime(ts, 'auto'));
  });

  it('prefixes "Yesterday at " for a message from the previous day', () => {
    const ts = new Date(2026, 6, 7, 13, 15, 0).getTime();
    const out = fmtMessageTime(ts, 'auto', now);
    expect(out.startsWith('Yesterday at ')).toBe(true);
    expect(out.endsWith(fmtTime(ts, 'auto'))).toBe(true);
  });

  it('shows a short date + time for a message older than yesterday', () => {
    const ts = new Date(2026, 6, 2, 13, 15, 0).getTime();
    const out = fmtMessageTime(ts, 'auto', now);
    expect(out.startsWith('Yesterday')).toBe(false);
    expect(out.includes(fmtTime(ts, 'auto'))).toBe(true);
    expect(out).not.toBe(fmtTime(ts, 'auto')); // carries a date prefix
  });

  it('treats local midnight today as "today" and one ms earlier as "Yesterday"', () => {
    const midnight = new Date(2026, 6, 8, 0, 0, 0).getTime();
    expect(fmtMessageTime(midnight, 'auto', now)).toBe(fmtTime(midnight, 'auto'));
    expect(fmtMessageTime(midnight - 1, 'auto', now).startsWith('Yesterday at ')).toBe(true);
  });

  it('honors the 24-hour preference in each tier', () => {
    const today = new Date(2026, 6, 8, 13, 15, 0).getTime();
    const yesterday = new Date(2026, 6, 7, 13, 15, 0).getTime();
    const older = new Date(2026, 6, 2, 13, 15, 0).getTime();
    expect(fmtMessageTime(today, '24h', now)).toContain('13:15');
    expect(fmtMessageTime(yesterday, '24h', now)).toContain('13:15');
    expect(fmtMessageTime(older, '24h', now)).toContain('13:15');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm exec vitest run --project unit tests/unit/renderer/lib/time.test.ts`
Expected: FAIL — `fmtMessageTime` is not exported (import/compile error).

- [ ] **Step 3: Implement the helper**

Append to `src/renderer/lib/time.ts` (after `fmtDate`):

```ts
// Discord-style message timestamp: today → time only; yesterday → "Yesterday
// at <time>"; older → short numeric date + time. The time portion goes through
// fmtTime so the 12/24-hour preference is honored; the full date+time stays
// available via fmtDateTime on hover. `now` is injectable for deterministic
// tests. Day boundaries use local midnight (new Date(y, m, d)) so they are
// correct across DST transitions.
export function fmtMessageTime(ts: number, pref: TimeFormatPref, now: number = Date.now()): string {
  const n = new Date(now);
  const startOfToday = new Date(n.getFullYear(), n.getMonth(), n.getDate()).getTime();
  const startOfYesterday = new Date(n.getFullYear(), n.getMonth(), n.getDate() - 1).getTime();
  if (ts >= startOfToday) return fmtTime(ts, pref);
  if (ts >= startOfYesterday) return `Yesterday at ${fmtTime(ts, pref)}`;
  const date = new Date(ts).toLocaleDateString(undefined, { dateStyle: 'short' });
  return `${date}, ${fmtTime(ts, pref)}`;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm exec vitest run --project unit tests/unit/renderer/lib/time.test.ts`
Expected: PASS (all `fmtRelative`, `dayKey`, `fmtDate`, `fmtMessageTime` tests).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/lib/time.ts tests/unit/renderer/lib/time.test.ts
git commit -m "feat: add fmtMessageTime for Discord-style message timestamps"
```

---

### Task 2: Wire `fmtMessageTime` into `MessageItem`

**Files:**
- Modify: `src/renderer/components/MessageItem.tsx` (import + two call sites)

**Interfaces:**
- Consumes: `fmtMessageTime` (Task 1).
- Produces: no new exports; the message timestamp now renders relative.

This is a wiring change verified by typecheck + the full suite (`MessageItem`'s timestamp uses `Date.now()` and the JSX structure is unchanged, so there is no new failing-test-first; Task 1's unit tests cover the behavior).

- [ ] **Step 1: Update the import**

In `src/renderer/components/MessageItem.tsx`, change line 4:

```tsx
import { fmtDateTime, fmtTime } from '../lib/time';
```

to:

```tsx
import { fmtDateTime, fmtMessageTime } from '../lib/time';
```

(`fmtTime` has no other use in this file after Step 2; removing it keeps the import clean and avoids a Biome unused-import error.)

- [ ] **Step 2: Swap the compact-layout timestamp**

Replace the compact-layout timestamp (inside the `title={fmtDateTime(...)}` span):

```tsx
          {fmtTime(message.ts, timeFormat)}
```

with:

```tsx
          {fmtMessageTime(message.ts, timeFormat)}
```

- [ ] **Step 3: Swap the rich-layout timestamp**

Replace the rich-layout meta-row span:

```tsx
            <span title={fmtDateTime(message.ts, timeFormat)}>{fmtTime(message.ts, timeFormat)}</span>
```

with:

```tsx
            <span title={fmtDateTime(message.ts, timeFormat)}>{fmtMessageTime(message.ts, timeFormat)}</span>
```

- [ ] **Step 4: Typecheck**

Run: `pnpm typecheck`
Expected: PASS (no errors; in particular no "fmtTime is declared but never read" — confirm both call sites were swapped and the import updated).

- [ ] **Step 5: Lint**

Run: `pnpm exec biome check src tests`
Expected: PASS. Run `pnpm format` if only formatting differs.

- [ ] **Step 6: Run the full test suite**

Run: `pnpm test`
Expected: PASS — the prior baseline plus Task 1's new tests, 0 failures.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/components/MessageItem.tsx
git commit -m "feat: render relative timestamps on conversation messages"
```

---

### Task 3: End-to-end verification

**Files:** none.

- [ ] **Step 1: Verify in the real app**

REQUIRED SUB-SKILL: use the `verify` skill (see the project's e2e-renderer-verification recipe: `pnpm package`, then Playwright + Electron with a seeded multi-day `messages.db`). Confirm in a channel spanning several days that: a message from today shows only its time; a message from yesterday shows `Yesterday at <time>`; an older message shows `<short date>, <time>`; and the hover tooltip still shows the full date+time.

- [ ] **Step 2: Finish the work**

The branch `feat/date-separators` already has an open PR (#13). Push the new commits to update it.

## Self-Review

**Spec coverage:** today→time-only, yesterday→"Yesterday at", older→short date+time (Task 1 `fmtMessageTime` + tests); 12/24h honored (Task 1 uses `fmtTime`, tested in the `'24h'` case); hover unchanged (Task 2 keeps `title={fmtDateTime}`); DST-safe local-midnight buckets (Task 1 implementation + boundary test); both call sites (Task 2 Steps 2-3); Unreads previews inherit via the shared component (no extra work — noted in spec). All spec sections map to a task.

**Placeholder scan:** no TBD/TODO; every code step shows complete code; every command states its expected result.

**Type consistency:** `fmtMessageTime(ts: number, pref: TimeFormatPref, now?: number): string` is defined in Task 1 and consumed with exactly that signature (2-arg call, default `now`) in Task 2. Import identifiers (`fmtDateTime`, `fmtMessageTime`, `fmtTime`) match between the test, `time.ts`, and `MessageItem.tsx`.
