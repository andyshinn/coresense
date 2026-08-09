# Repeater CLI — Phase 2 (UI) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the repeater CLI console UI on top of phase 1's pure logic — a ranked keyboard-driven suggestion palette, a native ghost-completing prompt, a queue-backed transcript with honest in-flight / error / truncation treatments, a hold-to-send confirm bar, bash-style reverse-i-search, and persisted reboot-pending state — and wire it into a thin `CliTab` that sends one command at a time over **today's** two-argument `repeaterCli(c, key, command)` transport. Ships useful without the `meshcore-ts` release: cancel of *queued* entries works; an in-flight fetch is orphaned on the deliberate repeater-switch remount; `expectReply` / `signal` / abort-in-flight are phase 3.

**Architecture:** Every decision that can be tested without a DOM already lives in phase 1's pure modules under `src/renderer/panels/repeater-admin/cli/lib/` and `src/shared/repeater-cli/catalog.ts`. Phase 2 adds only presentational components under `src/renderer/panels/repeater-admin/cli/`: `CliDetail`, `CliPalette`, `CliPrompt`, `CliReverseSearch`, `CliConfirmBar`, `CliTranscript` + `CliRow`, and `RebootPending`. `CliPrompt` owns the phase-1 `cliPromptReducer` and emits `submit` / `clearTranscript` effects to its parent. `CliTab` composes them, owns the phase-1 `queue.ts` FIFO and `persistence.ts` history/reboot rings, and drains against `api.repeaterCli`. Reboot-pending state is lifted to `repeater-admin/index.tsx` (above the `key={contact.key}` remount boundary) so its header chip and tab dot survive a repeater switch.

**Tech Stack:** Electron + React 19 + TypeScript, Tailwind v4 (`cs-*` tokens), zustand, shadcn/Radix primitives, Vitest (three projects: `unit` / `integration` / `dom`), Biome.

**Spec:** `docs/superpowers/specs/2026-07-28-repeater-cli-autocomplete-design.md`. Read it before starting — every section number referenced below points there. Phase 2's scope is §12's middle row; the canonical phase-1 interfaces it consumes are reproduced in each task's **Interfaces → Consumes** block.

## Global Constraints

- **Worktree:** `/Users/andy/GitHub/andyshinn/coresense/.claude/worktrees/cli-autocomplete`, branch `worktree-cli-autocomplete`. Run every command from there.
- **Run tooling via `npx`, not `pnpm <script>`** — `pnpm` scripts reflink-fail in worktrees. Use `npx vitest run --project unit|integration|dom`, `npx tsc --noEmit`, `npx biome check src tests`.
- **Lint scope is `src tests`.** Bare `npx biome check` fails on pre-existing `build/`, `dist/`, `out/` artifacts that are not ours.
- **Never use bare `git stash` / `git stash pop`** — the stash stack is shared across worktrees.
- **`@testing-library/jest-dom` is NOT installed.** Assert with `toBeTruthy()` / `toBeNull()` / attribute and `className` reads, never `toBeInTheDocument()`.
- **The vitest project split is by extension.** A `.tsx` under `tests/unit/` never runs: `unit` = `tests/unit/**/*.test.ts` (node env), `dom` = `tests/component/**/*.test.tsx` (jsdom + react plugin), `integration` = `tests/integration/**/*.test.ts`. Phase 2's component tests all go under `tests/component/`.
- **`tests/component/setup.ts` stubs `matchMedia`, `ResizeObserver`, and `Element.prototype.scrollIntoView`.** Never assert on `scrollIntoView`; assert on `aria-activedescendant` instead.
- **Commit after every task** with conventional-commit prefixes (`feat:` / `fix:` / `refactor:` / `test:` / `style:` / `docs:`).
- **End every commit message with the trailer:** `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`.

---

## Phase 1 handoff notes (from the Phase 1 whole-branch review)

Phase 1 (catalog + pure logic) is complete, reviewed, and merged. Four things the Phase 1
review surfaced that this phase must handle — read before Task 6 (CliConfirmBar) and Task 9
(CliTab):

1. **The danger-accept contract is a real seam.** `cliPromptReducer` intentionally has NO
   `confirm/accept` action — Enter on a `danger` command sets `confirmPending` and returns no
   effect; the accept is this phase's `CliConfirmBar` hold-to-send. Wire it one of two ways and
   state which in Task 6/9: (a) add a `confirm/accept` reducer action that returns
   `{ state: clearLine(confirm-cleared), effect: { kind: 'submit', text: confirmPending.text } }`,
   or (b) have `CliTab` read `state.confirmPending.text`, submit it, and dispatch `confirm/cancel`
   to clear. (a) keeps the single-submit-path invariant; prefer it.
2. **The confirm bar (and reverse-search line) must CAPTURE the keyboard.** While `confirmPending`
   is set, `isPaletteOpen` is false, so a stray `key/arrowUp`/`key/enter` reaching the reducer
   falls through to history-recall / submit and mutates `state.value` underneath the bar (inert in
   Phase 1 only because no UI routes keys there). `CliConfirmBar` and `CliReverseSearch` must
   intercept keydown so those actions never reach the reducer while they are mounted.
3. **Tab-completion UX papercut (optional polish).** `commonPrefix` runs over ALL non-serial
   matches (spec §2.2), so `Tab` on `set rad` won't complete to `set radio` — a loose subsequence
   match (`set allow.read.only`) collapses the prefix to `set `. If you want intuitive Tab
   completion, pass only the prefix/word-start-tier items into `commonPrefix` at the reducer's Tab
   call site (a small, additive change; leaves `match.commonPrefix` itself untouched).
4. **Perf for the live component:** memoize `suggest(value, caret, ctx)` per input — the reducer's
   derived helpers (`paletteItems`, `ghostSuffix`, `isPaletteOpen`, `reselect`) each call `suggest()`,
   so one keystroke drives several full 101-command scans. Harmless in unit tests; memoize in `CliTab`.

---

## File Structure

**Create**

| File | Responsibility |
|---|---|
| `src/renderer/panels/repeater-admin/cli/CliDetail.tsx` | Command / arg detail body (§4.6). Presentational. |
| `src/renderer/panels/repeater-admin/cli/CliPalette.tsx` | Radix Popover, hand-rolled `<button>` rows, best-score groups, chips, width fold, empty state, roving `aria-activedescendant` (§4). |
| `src/renderer/panels/repeater-admin/cli/CliPrompt.tsx` | Native `<input>`, ghost overlay, airtime readout, Run, guest banner; owns `cliPromptReducer` (§3, §8). |
| `src/renderer/panels/repeater-admin/cli/CliReverseSearch.tsx` | The `⌃R` line (§3.2). Presentational. |
| `src/renderer/panels/repeater-admin/cli/CliConfirmBar.tsx` | Hold-to-send, 900 ms (§Decisions; `cli-prompt.jsx:7-20`). |
| `src/renderer/panels/repeater-admin/cli/CliRow.tsx` | One transcript row: in-flight, completed, four error kinds, truncation hint, follow-ups (§5.2-5.5). Named to avoid colliding with the `CliEntry` type. |
| `src/renderer/panels/repeater-admin/cli/CliTranscript.tsx` | Scroller + empty state (§5.6). |
| `src/renderer/panels/repeater-admin/cli/RebootPending.tsx` | Tier-one strip + tier-two header chip + tab dot + pure arm/clear helpers (§6). |
| `tests/component/cli-detail.test.tsx` | Detail body: params, default, on-node value, round-trip, note. |
| `tests/component/cli-palette.test.tsx` | Open, apply, dismiss, best-score group order, zero-item empty state, `aria-activedescendant`. |
| `tests/component/cli-prompt-keys.test.tsx` | Tab, ghost casing, history — through a `flushSync` harness. |
| `tests/component/cli-guest-blocked.test.tsx` | All three §8 states; input stays focusable. |
| `tests/component/cli-reverse-search.test.tsx` | Query, highlight, status glyph, suppressed `n/total`, failing text. |
| `tests/component/cli-confirm.test.tsx` | Hold gesture, cancel on early release. |
| `tests/component/cli-transcript-states.test.tsx` | Four §5.4 error kinds, in-flight, truncation threshold, empty state. |
| `tests/component/cli-reboot-pending.test.tsx` | Arm on `ok` and `sent`, dedup, tier demotion, clear on `lastSeenMs` advance, undefined `lastSeenMs`. |
| `tests/component/cli-tab.test.tsx` | Composed guest-blocked and a successful send round-trip. |

**Modify**

| File | Change |
|---|---|
| `src/shared/shortcuts.ts` | Move `packetLog` off `mod+L`; register `reload` on a free chord; add `cliReverseSearch` (`ctrl+R`) and `cliClear` (`ctrl+L`) as `surface: 'contextual'`. |
| `src/main/menu.ts:139` | Replace `{ role: 'reload' }` with `{ role: 'reload', accelerator: accelFor('reload') }`. |
| `tests/unit/shared/shortcuts.test.ts` | Add a "no two SHORTCUTS entries share a chord on either platform" test. |
| `src/renderer/panels/repeater-admin/CliTab.tsx` | Thin rewrite over phase-1 reducer + queue against today's `repeaterCli`; `text-cs-error` → `text-cs-danger`. |
| `src/renderer/panels/repeater-admin/index.tsx` | Pass `session` / `sessionChecked` / `contact` to `CliTab`; lift reboot-pending state above the remount boundary; render tier-two chip + tab dot. |

**Delete:** nothing. The old `SUGGESTIONS`/`Entry` in `CliTab.tsx` are subsumed by the rewrite.

---

### Task 1: Shortcuts + menu — free `⌃L` / `⌃R`, guard the collision class

**Files:**
- Modify: `src/shared/shortcuts.ts` (`packetLog` entry ~line 110-118; append `reload`, `cliReverseSearch`, `cliClear`)
- Modify: `src/main/menu.ts:139`
- Modify: `tests/unit/shared/shortcuts.test.ts` (append one `describe`)

**Interfaces:**
- Consumes: `Shortcut`, `SHORTCUTS`, `accelFor(id)`, `byId(id)` from `src/shared/shortcuts.ts`; `Chord`, `Mod` from `src/shared/shortcuts-format.ts`.
- Produces: `SHORTCUTS` entries `reload` (`{ mods:['mod','shift'], key:'e' }`, `surface:'contextual'`), `cliReverseSearch` (`{ mods:['ctrl'], key:'r' }`, `surface:'contextual'`), `cliClear` (`{ mods:['ctrl'], key:'l' }`, `surface:'contextual'`); `packetLog` moved to `{ mods:['mod','shift'], key:'p' }`. `accelFor('reload') === 'CmdOrCtrl+Shift+E'`.

Chord choice is verified free against the registry: the only `mod+shift` chords in use are `l` (theme), `r` (reconnect), `m` (repeat), `a` (advert); menu-hardcoded accelerators are only `mod+N` / `mod+Shift+N`. `mod+shift+p` and `mod+shift+e` collide with none, and neither shadows the in-prompt `⌃R` / `⌃L` / `⌃G` / `⌃Space` (those are literal `ctrl`, distinct from `mod` even on non-mac because `mod+shift+*` ≠ `ctrl+*`).

- [ ] **Step 1: Add the two contextual CLI shortcuts (the change under test)**

Append to `SHORTCUTS` in `src/shared/shortcuts.ts`, inside the Radio block after `sendAdvert` (~line 206). `surface: 'contextual'` carries no `menuAction`, so the existing "forbids a menuAction on renderer/contextual shortcuts" invariant stays green; contextual entries are documentation-only and are **not** auto-bound by `shortcut-resolve.ts` (which filters `surface === 'renderer'`) — their behaviour lives inside `CliPrompt` (Task 4).

```ts
  {
    id: 'cliReverseSearch',
    category: 'Radio',
    name: 'CLI reverse search',
    desc: 'Reverse-i-search the repeater CLI history from the console prompt.',
    chords: [{ mods: ['ctrl'], key: 'r' }],
    surface: 'contextual',
  },
  {
    id: 'cliClear',
    category: 'Radio',
    name: 'CLI clear',
    desc: 'Clear the repeater CLI transcript from the console prompt.',
    chords: [{ mods: ['ctrl'], key: 'l' }],
    surface: 'contextual',
  },
```

- [ ] **Step 2: Write the collision guard test (fails against Step 1's registry)**

Append to `tests/unit/shared/shortcuts.test.ts`. The signature resolves `mod`→Ctrl on non-mac and Cmd on mac, so `mod+L` (packetLog) and `ctrl+L` (cliClear) collide on `'other'` — exactly the class this guard exists to catch.

```ts
import type { Chord } from '../../../src/shared/shortcuts-format';

function chordSig(chord: Chord, platform: 'mac' | 'other'): string {
  const mods = new Set(chord.mods ?? []);
  const parts: string[] = [];
  if (mods.has('ctrl') || (mods.has('mod') && platform === 'other')) parts.push('Ctrl');
  if (mods.has('mod') && platform === 'mac') parts.push('Meta');
  if (mods.has('alt')) parts.push('Alt');
  if (mods.has('shift')) parts.push('Shift');
  return `${parts.sort().join('+')}|${chord.key.toLowerCase()}`;
}

describe('SHORTCUTS chord collisions', () => {
  it('no two entries share a chord on either platform', () => {
    for (const platform of ['mac', 'other'] as const) {
      const seen = new Map<string, string>();
      for (const s of SHORTCUTS) {
        for (const chord of s.chords) {
          const sig = chordSig(chord, platform);
          const prior = seen.get(sig);
          expect(prior, `${platform}: ${s.id} collides with ${prior} on ${sig}`).toBeUndefined();
          seen.set(sig, s.id);
        }
      }
    }
  });
});
```

- [ ] **Step 3: Run it — confirm RED**

Run: `npx vitest run --project unit tests/unit/shared/shortcuts.test.ts`
Expected: FAIL — `other: packetLog collides with cliClear on Ctrl|l` (packetLog is still on `mod+L`).

- [ ] **Step 4: Move `packetLog` and register `reload`**

Change the `packetLog` chord (~line 115) from `[{ mods: ['mod'], key: 'l' }]` to:

```ts
    chords: [{ mods: ['mod', 'shift'], key: 'p' }],
```

Append `reload` to the Radio block (after the two Step 1 entries). It is driven by Electron's built-in `role: 'reload'`; the registry entry exists only so `accelFor('reload')` is the single source of truth for its accelerator. `surface: 'contextual'` keeps it menuAction-free and un-auto-bound:

```ts
  {
    id: 'reload',
    category: 'General',
    name: 'Reload window',
    desc: 'Reload the app window (developer / recovery).',
    chords: [{ mods: ['mod', 'shift'], key: 'e' }],
    surface: 'contextual',
  },
```

- [ ] **Step 5: Run the guard + existing shortcut tests — confirm GREEN**

Run: `npx vitest run --project unit tests/unit/shared/shortcuts.test.ts`
Expected: PASS — the collision guard passes both platforms; `accelFor('toggleSidebar')` / `accelFor('sendAdvert')` assertions unchanged.

- [ ] **Step 6: Point the Reload menu item at the registry accelerator**

In `src/main/menu.ts` replace line 139 `{ role: 'reload' },` with:

```ts
      { role: 'reload', accelerator: accelFor('reload') },
```

`accelFor` is already imported (line 2). The `packetLog` menu item at `:128-131` already uses `accelFor('packetLog')`, so it picks up `Cmd/Ctrl+Shift+P` with no further edit.

- [ ] **Step 7: Full verification**

Run: `npx tsc --noEmit && npx vitest run --project unit && npx biome check src tests`
Expected: all clean. (`toAccelerator({mods:['mod','shift'],key:'e'})` → `CmdOrCtrl+Shift+E`, `key:'p'` → `CmdOrCtrl+Shift+P`.)

- [ ] **Step 8: Commit**

```bash
git add src/shared/shortcuts.ts src/main/menu.ts tests/unit/shared/shortcuts.test.ts
git commit -m "feat(shortcuts): free Ctrl+L / Ctrl+R for the repeater CLI console

Move Packet Log to Cmd/Ctrl+Shift+P and give Reload an explicit
Cmd/Ctrl+Shift+E so neither collides with the console's Ctrl+L (clear)
and Ctrl+R (reverse search) on non-mac, where mod resolves to Ctrl.
Register both console chords as contextual so the help overlay lists
them, and add a per-platform collision guard so this class of clash
cannot recur silently.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: `CliDetail.tsx` — the command / arg detail body (§4.6)

**Files:**
- Create: `src/renderer/panels/repeater-admin/cli/CliDetail.tsx`
- Create: `tests/component/cli-detail.test.tsx`

**Interfaces:**
- Consumes (phase 1, `src/shared/repeater-cli/catalog.ts`):
  ```ts
  interface CliArg { name: string; hint?: string; enum?: string[]; enumDesc?: Record<string,string>; range?: [number, number] }
  interface CliCommand { name: string; group: CliGroup; desc: string; spec?: string; args?: CliArg[]; presets?: CliPreset[]; key?: string; replyValue?: RegExp; def?: string; serialOnly?: true; noReply?: true; reboot?: true; danger?: true; fw?: string; deprecated?: string; experimental?: true; note?: string }
  ```
- Consumes (phase 1, `./lib/suggest`): `interface CliSuggestion { id; label; desc; kind: 'command'|'value'|'preset'|'current'; cmd?: CliCommand; group?: CliGroup; ranges?; meta?: string; insert; replaceFrom; replaceAll?; serialOnly?; recent? }`.
- Produces:
  ```ts
  export interface CliDetailProps { item: CliSuggestion; nodeValue?: string; roundTripLabel: string | null }
  export function CliDetail(props: CliDetailProps): JSX.Element
  ```
  `roundTripLabel` is the airtime label string (`'~2.9 s'`) or `null` (renders `—`). The `1↑ 1↓` / `1↑ · no reply` framing is composed here — commands and replies are single-frame (§0), so the leg counts are constant.

- [ ] **Step 1: Write the failing test**

Create `tests/component/cli-detail.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { CliCommand } from '../../src/shared/repeater-cli/catalog';
import type { CliSuggestion } from '@/panels/repeater-admin/cli/lib/suggest';
import { CliDetail } from '@/panels/repeater-admin/cli/CliDetail';

const radio: CliCommand = {
  name: 'set radio',
  group: 'Radio',
  desc: 'Set the LoRa radio parameters.',
  spec: '<freq>,<bw>,<sf>,<cr>',
  args: [{ name: 'freq', hint: 'MHz' }, { name: 'mode', enum: ['fast', 'slow'], enumDesc: { fast: 'SF7', slow: 'SF12' } }],
  key: 'radio',
  def: '869.525,250,11,5',
  reboot: true,
  note: 'Wrong values can strand the node off-frequency.',
};

const cmdItem = (over: Partial<CliSuggestion> = {}): CliSuggestion => ({
  id: 'c:set radio', label: 'set radio', desc: radio.desc, kind: 'command', cmd: radio,
  insert: 'set radio', replaceFrom: 0, ...over,
});

describe('CliDetail — command', () => {
  it('renders name, spec, description, params, default, on-node value, round trip and note', () => {
    render(<CliDetail item={cmdItem()} nodeValue="910.525,250,11,5" roundTripLabel="~2.9 s" />);
    expect(screen.getByText('set radio')).toBeTruthy();
    expect(screen.getByText('<freq>,<bw>,<sf>,<cr>')).toBeTruthy();
    expect(screen.getByText(radio.desc)).toBeTruthy();
    expect(screen.getByText('freq')).toBeTruthy();
    expect(screen.getByText('fast | slow')).toBeTruthy();
    expect(screen.getByText('869.525,250,11,5')).toBeTruthy();
    expect(screen.getByText('910.525,250,11,5')).toBeTruthy();
    expect(screen.getByText('1↑ 1↓ · ~2.9 s')).toBeTruthy();
    expect(screen.getByText(radio.note as string)).toBeTruthy();
  });

  it('renders the no-reply round trip and a dash when the estimate is unknown', () => {
    const noReply: CliCommand = { ...radio, noReply: true, note: undefined };
    render(<CliDetail item={cmdItem({ cmd: noReply })} roundTripLabel={null} />);
    expect(screen.getByText('1↑ · no reply')).toBeTruthy();
  });

  it('omits the on-node row when no value is known', () => {
    render(<CliDetail item={cmdItem()} roundTripLabel="~2.9 s" />);
    expect(screen.queryByText('On node')).toBeNull();
  });
});

describe('CliDetail — value item', () => {
  it('renders label, description and what it resolves to', () => {
    const item: CliSuggestion = {
      id: 'v:fast', label: 'fast', desc: 'SF7 — fastest, shortest range', kind: 'value',
      meta: 'SF7', insert: 'fast', replaceFrom: 9,
    };
    render(<CliDetail item={item} roundTripLabel={null} />);
    expect(screen.getByText('fast')).toBeTruthy();
    expect(screen.getByText('SF7 — fastest, shortest range')).toBeTruthy();
    expect(screen.getByText('SF7')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run --project dom tests/component/cli-detail.test.tsx`
Expected: FAIL — cannot resolve `@/panels/repeater-admin/cli/CliDetail`.

- [ ] **Step 3: Create `CliDetail.tsx`**

```tsx
import type { CliSuggestion } from './lib/suggest';

export interface CliDetailProps {
  item: CliSuggestion;
  /** The value currently on the node for this command's `key` (§2.3), if known. */
  nodeValue?: string;
  /** Airtime label such as '~2.9 s', or null when radioSettings is not yet loaded. */
  roundTripLabel: string | null;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-[11px]">
      <span className="text-[10px] uppercase tracking-wider text-cs-text-dim">{label}</span>
      <span className="truncate font-mono tabular-nums text-cs-text-muted">{children}</span>
    </div>
  );
}

export function CliDetail({ item, nodeValue, roundTripLabel }: CliDetailProps) {
  const cmd = item.cmd;

  // Argument-mode value: label, description, and what it resolves to (its meta).
  if (!cmd) {
    return (
      <div className="flex flex-col gap-2">
        <div className="font-mono text-[13px] text-cs-text">{item.label}</div>
        <p className="text-[12px] leading-snug text-cs-text-muted" style={{ textWrap: 'pretty' }}>
          {item.desc}
        </p>
        {item.meta ? (
          <div className="rounded border border-cs-border bg-cs-bg px-2 py-1.5">
            <div className="text-[10px] uppercase tracking-wider text-cs-text-dim">Resolves to</div>
            <div className="mt-0.5 break-all font-mono text-[12px] text-cs-accent">{item.meta}</div>
          </div>
        ) : null}
      </div>
    );
  }

  const roundTrip = cmd.noReply ? '1↑ · no reply' : `1↑ 1↓ · ${roundTripLabel ?? '—'}`;

  return (
    <div className="flex flex-col gap-2.5">
      <div>
        <div className="font-mono text-[13px] text-cs-text">
          {cmd.name}
          {cmd.spec ? <span className="text-cs-text-dim"> {cmd.spec}</span> : null}
        </div>
        <p className="mt-1 text-[12px] leading-snug text-cs-text-muted" style={{ textWrap: 'pretty' }}>
          {cmd.desc}
        </p>
      </div>

      {cmd.args && cmd.args.length > 0 ? (
        <div className="flex flex-col gap-1">
          <div className="text-[10px] uppercase tracking-wider text-cs-text-dim">Parameters</div>
          {cmd.args.map((a) => (
            <div key={a.name} className="flex items-baseline gap-2 text-[11px]">
              <span className="shrink-0 font-mono text-cs-text">{a.name}</span>
              <span className="text-cs-text-dim" style={{ textWrap: 'pretty' }}>
                {a.enum ? a.enum.join(' | ') : (a.hint ?? (a.range ? `${a.range[0]}–${a.range[1]}` : ''))}
              </span>
            </div>
          ))}
        </div>
      ) : null}

      {cmd.def ? <Field label="Default">{cmd.def}</Field> : null}
      {nodeValue && nodeValue.length > 0 ? (
        <div className="flex items-baseline justify-between gap-3 text-[11px]">
          <span className="text-[10px] uppercase tracking-wider text-cs-text-dim">On node</span>
          <span className="truncate font-mono tabular-nums text-cs-text">{nodeValue}</span>
        </div>
      ) : null}
      <Field label="Round trip">{roundTrip}</Field>

      {cmd.note ? (
        <p className="border-t border-cs-border pt-2 text-[11px] leading-snug text-cs-text-dim" style={{ textWrap: 'pretty' }}>
          {cmd.note}
        </p>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run --project dom tests/component/cli-detail.test.tsx`
Expected: PASS, 5 tests. (The "On node" label uses the same casing as `queryByText('On node')`.)

- [ ] **Step 5: Verify typecheck + lint**

Run: `npx tsc --noEmit && npx biome check src/renderer/panels/repeater-admin/cli tests/component/cli-detail.test.tsx`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/panels/repeater-admin/cli/CliDetail.tsx tests/component/cli-detail.test.tsx
git commit -m "feat(cli): detail pane body for the repeater CLI palette

Renders name+spec, description, parameters (enum values / hints / ranges),
firmware default, the value on the node now, a constant single-frame round
trip (1↑ 1↓ · ~2.9 s, or 1↑ · no reply), and the operational note. Arg-mode
value items show what they resolve to.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: `CliPalette.tsx` — hand-rolled ranked palette (§4)

**Files:**
- Create: `src/renderer/panels/repeater-admin/cli/CliPalette.tsx`
- Create: `tests/component/cli-palette.test.tsx`
- Reference (do not modify): `src/renderer/panels/macros/studio/MacroEditor.tsx:92-206` (Popover + `onOpenAutoFocus`/`onCloseAutoFocus` preventDefault `:178-179`, `onMouseDown`+preventDefault rows `:191-192`); `.design-ref/cli-autocomplete/cli-palette.jsx` (recreate, don't copy).

**Interfaces:**
- Consumes: `CliDetail` (Task 2) `{ item, nodeValue?, roundTripLabel }`; phase-1 `CliParse` (`{ mode:'command'; token; start:0 } | { mode:'arg'; cmd; argIndex; token; start }`), `CliSuggestion` (Task 2), `CliCommand`/`CliArg` (Task 2); phase-1 `cliRoundTrip(command, radio: RadioSettings | null | undefined, hops: number, noReply: boolean): { ms: number; label: string }` from `./lib/airtime`; `RadioSettings` from `src/shared/types.ts:661`.
- Produces:
  ```ts
  export interface CliPaletteProps {
    open: boolean;
    parse: CliParse;
    items: CliSuggestion[];        // already ranked/sorted by suggest()
    activeId: string;
    nodeValues: Record<string, string>;
    radioSettings: RadioSettings | null;
    hops: number;
    onApply: (item: CliSuggestion) => void;
  }
  export function CliPalette(props: CliPaletteProps): JSX.Element
  ```
  Renders its own zero-height top-anchored `PopoverAnchor` — mount it inside the prompt's `relative` container (Task 4). `onApply` fires on `onMouseDown`+preventDefault (never `onClick`, or the click blurs the prompt first).

- [ ] **Step 1: Write the failing test**

Create `tests/component/cli-palette.test.tsx`. It asserts `aria-activedescendant` (per setup.ts, `scrollIntoView` is stubbed and must not be asserted), best-score group order, apply on mousedown, and the zero-item empty state (which renders even though `items.length === 0`).

```tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { CliCommand } from '../../src/shared/repeater-cli/catalog';
import type { CliParse } from '@/panels/repeater-admin/cli/lib/parse';
import type { CliSuggestion } from '@/panels/repeater-admin/cli/lib/suggest';
import { CliPalette } from '@/panels/repeater-admin/cli/CliPalette';

const cmd = (name: string, group: CliCommand['group'], over: Partial<CliCommand> = {}): CliCommand => ({
  name, group, desc: `${name} desc`, ...over,
});

const item = (over: Partial<CliSuggestion>): CliSuggestion => ({
  id: `c:${over.label}`, label: over.label ?? 'x', desc: 'd', kind: 'command', insert: over.label ?? 'x', replaceFrom: 0, ...over,
});

const commandParse: CliParse = { mode: 'command', token: 's', start: 0 };

const radio = {
  frequencyHz: 910_525_000, bandwidthHz: 62_500, spreadingFactor: 7,
  codingRate: 5, txPowerDbm: 20, repeatMode: false, pathHashMode: 2 as const,
};

describe('CliPalette', () => {
  it('renders nothing when closed', () => {
    const { container } = render(
      <CliPalette open={false} parse={commandParse} items={[item({ label: 'set radio', cmd: cmd('set radio', 'Radio') })]}
        activeId="c:set radio" nodeValues={{}} radioSettings={radio} hops={1} onApply={() => {}} />,
    );
    expect(container.querySelector('[role="option"]')).toBeNull();
  });

  it('orders groups by their best member score (list order), not by CLI_GROUP_ORDER', () => {
    // items arrive already ranked: a Statistics hit outranks a Radio hit.
    const items = [
      item({ label: 'stats', cmd: cmd('stats', 'Statistics'), ranges: [[0, 4]] }),
      item({ label: 'set radio', cmd: cmd('set radio', 'Radio') }),
    ];
    render(<CliPalette open parse={commandParse} items={items} activeId="c:stats" nodeValues={{}} radioSettings={radio} hops={1} onApply={() => {}} />);
    const headings = Array.from(document.querySelectorAll('[data-group-heading]')).map((n) => n.textContent);
    expect(headings).toEqual(['Statistics', 'Radio']);
  });

  it('sinks serial-only commands into a trailing group', () => {
    const items = [
      item({ label: 'set radio', cmd: cmd('set radio', 'Radio') }),
      item({ label: 'erase', cmd: cmd('erase', 'System', { serialOnly: true }), serialOnly: true }),
    ];
    render(<CliPalette open parse={commandParse} items={items} activeId="c:set radio" nodeValues={{}} radioSettings={radio} hops={1} onApply={() => {}} />);
    const headings = Array.from(document.querySelectorAll('[data-group-heading]')).map((n) => n.textContent);
    expect(headings[headings.length - 1]).toBe('Not available over radio');
  });

  it('reflects the active item via aria-activedescendant', () => {
    const items = [item({ label: 'set radio', cmd: cmd('set radio', 'Radio') }), item({ label: 'set name', cmd: cmd('set name', 'System') })];
    const { rerender } = render(<CliPalette open parse={commandParse} items={items} activeId="c:set radio" nodeValues={{}} radioSettings={radio} hops={1} onApply={() => {}} />);
    const listbox = screen.getByRole('listbox');
    expect(listbox.getAttribute('aria-activedescendant')).toBe('c:set radio');
    rerender(<CliPalette open parse={commandParse} items={items} activeId="c:set name" nodeValues={{}} radioSettings={radio} hops={1} onApply={() => {}} />);
    expect(listbox.getAttribute('aria-activedescendant')).toBe('c:set name');
  });

  it('applies an item on mousedown', () => {
    const onApply = vi.fn();
    const it0 = item({ label: 'set radio', cmd: cmd('set radio', 'Radio') });
    render(<CliPalette open parse={commandParse} items={[it0]} activeId="c:set radio" nodeValues={{}} radioSettings={radio} hops={1} onApply={onApply} />);
    fireEvent.mouseDown(screen.getByRole('option'));
    expect(onApply).toHaveBeenCalledWith(it0);
  });

  it('renders the empty state when there are no items', () => {
    render(<CliPalette open parse={commandParse} items={[]} activeId="" nodeValues={{}} radioSettings={radio} hops={1} onApply={() => {}} />);
    expect(screen.getByText(/press ↵ to send it raw/)).toBeTruthy();
    expect(document.querySelector('[role="option"]')).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run --project dom tests/component/cli-palette.test.tsx`
Expected: FAIL — cannot resolve `@/panels/repeater-admin/cli/CliPalette`.

- [ ] **Step 3: Create the chip helper + `CliPalette.tsx`**

Chips are right-aligned, blockers first, with the concrete §4.5 tokens (no `admin` chip, no airtime chip). `no reply` and `v…+` share the `cs-bg-3` fill and are told apart by tone/italic because `--cs-accent` and `--cs-warn` are byte-identical (`index.css:27,30`).

```tsx
import { useLayoutEffect, useRef, useState } from 'react';
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover';
import { Kbd } from '@/components/ui/kbd';
import { cn } from '@/lib/utils';
import type { RadioSettings } from '../../../../shared/types';
import type { CliCommand } from '../../../../shared/repeater-cli/catalog';
import { cliRoundTrip } from './lib/airtime';
import type { CliParse } from './lib/parse';
import type { CliSuggestion } from './lib/suggest';
import { CliDetail } from './CliDetail';

const DETAIL_W = 250;
const DETAIL_MIN = 560; // below this the two-pane detail folds to inline
const LIST_MAX_H = 302;

export interface CliPaletteProps {
  open: boolean;
  parse: CliParse;
  items: CliSuggestion[];
  activeId: string;
  nodeValues: Record<string, string>;
  radioSettings: RadioSettings | null;
  hops: number;
  onApply: (item: CliSuggestion) => void;
}

interface Chip {
  key: string;
  label: string;
  title: string;
  className: string;
}

// The over-the-air facts, as chips. Order matters: blockers first. Tokens are
// the concrete §4.5 tints; contrast is measured against each chip's own fill.
function cmdChips(cmd: CliCommand | undefined): Chip[] {
  if (!cmd) return [];
  const out: Chip[] = [];
  if (cmd.serialOnly) out.push({ key: 'serial', label: 'serial only', title: 'Never answered over the air — wired console only', className: 'bg-cs-bg-3 text-cs-text-dim' });
  if (cmd.danger) out.push({ key: 'danger', label: 'destructive', title: 'Asks for confirmation before sending', className: 'bg-cs-danger/15 text-cs-danger' });
  if (cmd.noReply) out.push({ key: 'noreply', label: 'no reply', title: 'The node never answers this', className: 'bg-cs-bg-3 text-cs-text-muted' });
  if (cmd.reboot) out.push({ key: 'reboot', label: 'reboot', title: 'Takes effect only after a reboot', className: 'border border-cs-accent/30 bg-cs-accent-soft text-cs-accent' });
  if (cmd.fw) out.push({ key: 'fw', label: `v${cmd.fw}+`, title: `Needs firmware ${cmd.fw} or newer`, className: 'bg-cs-bg-3 italic text-cs-text-muted' });
  if (cmd.deprecated) out.push({ key: 'dep', label: 'deprecated', title: `Deprecated as of firmware ${cmd.deprecated}`, className: 'bg-cs-bg-3 text-cs-text-dim' });
  if (cmd.experimental) out.push({ key: 'exp', label: 'exp', title: 'Experimental', className: 'bg-cs-bg-3 text-cs-text-dim' });
  return out;
}

function Highlight({ text, ranges }: { text: string; ranges?: [number, number][] }) {
  if (!ranges || ranges.length === 0) return <>{text}</>;
  const out: React.ReactNode[] = [];
  let i = 0;
  ranges.forEach(([a, b], k) => {
    if (a > i) out.push(<span key={`p${k}`}>{text.slice(i, a)}</span>);
    out.push(<span key={`m${k}`} className="text-cs-accent">{text.slice(a, b)}</span>);
    i = b;
  });
  if (i < text.length) out.push(<span key="t">{text.slice(i)}</span>);
  return <>{out}</>;
}

interface Group { name: string | null; items: CliSuggestion[] }

// Command mode: Recent first, then catalog groups ordered by first appearance
// in the already-ranked list (== best member's score), then serial-only sunk
// into one trailing group. Argument mode is a single ungrouped list.
function groupItems(parse: CliParse, items: CliSuggestion[]): Group[] {
  if (parse.mode === 'arg') return [{ name: null, items }];
  const recent = items.filter((i) => i.recent);
  const rest = items.filter((i) => !i.recent);
  const avail = rest.filter((i) => !i.serialOnly);
  const serial = rest.filter((i) => i.serialOnly);
  const out: Group[] = [];
  if (recent.length) out.push({ name: 'Recent on this node', items: recent });
  const byGroup = new Map<string, CliSuggestion[]>();
  for (const i of avail) {
    const g = i.group ?? 'Info';
    const bucket = byGroup.get(g);
    if (bucket) bucket.push(i);
    else byGroup.set(g, [i]);
  }
  for (const [name, list] of byGroup) out.push({ name, items: list });
  if (serial.length) out.push({ name: 'Not available over radio', items: serial });
  return out;
}

function useWidth(anchor: React.RefObject<HTMLDivElement | null>): number {
  const [width, setWidth] = useState(420);
  useLayoutEffect(() => {
    const measure = () => {
      const el = anchor.current;
      if (!el) return;
      const available = window.innerWidth - el.getBoundingClientRect().left;
      setWidth(Math.max(380, Math.min(660, available - 20)));
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [anchor]);
  return width;
}

function Row({ item, selected, onApply }: { item: CliSuggestion; selected: boolean; onApply: (i: CliSuggestion) => void }) {
  const chips = cmdChips(item.cmd);
  return (
    <button
      type="button"
      role="option"
      id={item.id}
      aria-selected={selected}
      // onMouseDown + preventDefault: onClick would blur the prompt first.
      onMouseDown={(e) => {
        e.preventDefault();
        onApply(item);
      }}
      className={cn(
        'flex w-full cursor-pointer items-start gap-2 rounded-sm px-2 py-1.5 text-left',
        item.serialOnly && 'opacity-50',
        selected ? 'bg-cs-bg-3' : 'hover:bg-cs-bg-3',
      )}
    >
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-1.5">
          <span className="shrink-0 whitespace-nowrap font-mono text-[12.5px] text-cs-text">
            <Highlight text={item.label} ranges={item.ranges} />
          </span>
          {item.cmd?.spec ? <span className="truncate font-mono text-[11px] text-cs-text-dim">{item.cmd.spec}</span> : null}
        </span>
        {item.kind !== 'command' ? (
          <span className="mt-0.5 block truncate text-[11px] leading-snug text-cs-text-dim">{item.desc}</span>
        ) : null}
      </span>
      <span className="flex shrink-0 items-center gap-1">
        {item.meta && item.kind !== 'command' ? (
          <span className="rounded-sm bg-cs-bg-3 px-1 font-mono uppercase tracking-wider text-cs-text-muted" style={{ fontSize: 9, lineHeight: '15px' }}>{item.meta}</span>
        ) : null}
        {chips.map((c) => (
          <span key={c.key} title={c.title} className={cn('shrink-0 rounded-sm px-1 font-mono uppercase tracking-wider', c.className)} style={{ fontSize: 9, lineHeight: '15px' }}>
            {c.label}
          </span>
        ))}
      </span>
    </button>
  );
}

export function CliPalette({ open, parse, items, activeId, nodeValues, radioSettings, hops, onApply }: CliPaletteProps) {
  const anchorRef = useRef<HTMLDivElement | null>(null);
  const width = useWidth(anchorRef);
  const twopane = width >= DETAIL_MIN;
  const groups = groupItems(parse, items);
  const active = items.find((i) => i.id === activeId) ?? items[0] ?? null;
  const header = parse.mode === 'arg' ? 'Values' : 'Commands';
  const subhead = parse.mode === 'arg' ? parse.cmd.args?.[parse.argIndex]?.name : undefined;

  const activeCmd = active?.cmd;
  const rtLabel =
    activeCmd && radioSettings ? cliRoundTrip(active?.label ?? activeCmd.name, radioSettings, hops, !!activeCmd.noReply).label : null;
  const activeNodeValue = activeCmd?.key ? nodeValues[activeCmd.key] : undefined;

  return (
    <Popover open={open}>
      <PopoverAnchor asChild>
        <div ref={anchorRef} className="pointer-events-none absolute top-0" style={{ left: 8, right: 8, height: 1 }} />
      </PopoverAnchor>
      <PopoverContent
        side="top"
        align="start"
        sideOffset={8}
        avoidCollisions={false}
        onOpenAutoFocus={(e) => e.preventDefault()}
        onCloseAutoFocus={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
        onPointerDownOutside={(e) => e.preventDefault()}
        className="overflow-hidden border-cs-border-strong bg-cs-bg-2 p-0 shadow-2xl"
        style={{ width }}
      >
        <div className="flex items-center gap-2 border-b border-cs-border px-2.5 py-1.5">
          <span className="text-[10px] font-medium uppercase tracking-wider text-cs-text-dim">{header}</span>
          {subhead ? <span className="font-mono text-[10px] text-cs-accent">{subhead}</span> : null}
          <span className="font-mono text-[10px] tabular-nums text-cs-text-dim">{items.length}</span>
          <span className="flex-1" />
          <span className="flex items-center gap-2.5 text-[10px] text-cs-text-dim">
            <span><Kbd>↹</Kbd> complete</span>
            <span><Kbd>↑↓</Kbd> move</span>
            <span><Kbd>↵</Kbd> run</span>
            <span><Kbd>esc</Kbd> dismiss</span>
          </span>
        </div>
        <div className="flex">
          <div
            role="listbox"
            aria-label={header}
            aria-activedescendant={active?.id || undefined}
            className="min-w-0 flex-1 overflow-y-auto p-1"
            style={{ maxHeight: LIST_MAX_H }}
          >
            {items.length === 0 ? (
              <div className="px-3 py-6 text-center text-[12px] text-cs-text-dim">
                No command matches — press ↵ to send it raw.
              </div>
            ) : (
              groups.map((g, gi) => (
                <div key={g.name ?? `g${gi}`} role="group" aria-label={g.name ?? undefined}>
                  {g.name ? (
                    <div data-group-heading className="px-2 pb-0.5 pt-1.5 text-[10px] uppercase tracking-wider text-cs-text-dim">
                      {g.name}
                    </div>
                  ) : null}
                  {g.items.map((i) => (
                    <Row key={i.id} item={i} selected={!!active && active.id === i.id} onApply={onApply} />
                  ))}
                </div>
              ))
            )}
          </div>
          {twopane && active ? (
            <div className="shrink-0 overflow-y-auto border-l border-cs-border bg-cs-bg p-3" style={{ width: DETAIL_W, maxHeight: LIST_MAX_H }}>
              <CliDetail item={active} nodeValue={activeNodeValue} roundTripLabel={rtLabel} />
            </div>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run --project dom tests/component/cli-palette.test.tsx`
Expected: PASS, 6 tests. (jsdom's `innerWidth` defaults to 1024, so `twopane` is true and the detail pane renders; the group-order and activedescendant assertions are width-independent.)

- [ ] **Step 5: Verify typecheck + lint**

Run: `npx tsc --noEmit && npx biome check src/renderer/panels/repeater-admin/cli tests/component/cli-palette.test.tsx`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/panels/repeater-admin/cli/CliPalette.tsx tests/component/cli-palette.test.tsx
git commit -m "feat(cli): hand-rolled ranked suggestion palette

A Radix Popover anchored zero-height at the top of the prompt, with plain
<button role=option> rows (not cmdk). Groups order by best member score,
serial-only commands sink into a trailing 'Not available over radio' group,
chips carry the concrete §4.5 tints, the detail pane folds below 560px, and
selection is announced via aria-activedescendant with focus never leaving
the prompt. The zero-item state still renders 'press ↵ to send it raw'.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: `CliPrompt.tsx` — native input, ghost, airtime, Run, guest banner (§3, §8)

**Files:**
- Create: `src/renderer/panels/repeater-admin/cli/CliPrompt.tsx`
- Create: `tests/component/cli-prompt-keys.test.tsx`
- Create: `tests/component/cli-guest-blocked.test.tsx`

**Interfaces:**
- Consumes: `CliPalette` (Task 3); phase-1 `cliPromptReducer(s: CliPromptState, a: CliPromptAction): { state: CliPromptState; effect?: CliEffect }` from `./lib/promptReducer`, with
  ```ts
  interface CliPromptState { value; caret; history: CliHistoryEntry[]; histIndex; draft; manualOpen; dismissed; navigated; activeId; rsearch: { query; index; restore } | null; confirmPending: { text; cmd: CliCommand } | null; ctx: CliSuggestCtx }
  type CliEffect = { kind: 'submit'; text: string } | { kind: 'clearTranscript' }
  ```
  and the action union phase 1 exposes — a `kind`-discriminated union with granular per-key actions (names verbatim from spec §3):
  ```ts
  type CliPromptAction =
    | { kind: 'value/change'; value: string; caret: number }
    | { kind: 'caret/set'; caret: number }
    | { kind: 'key/ctrlSpace' }
    | { kind: 'key/arrowUp' }
    | { kind: 'key/arrowDown' }
    | { kind: 'key/tab' }
    | { kind: 'key/acceptGhost' }
    | { kind: 'key/enter' }
    | { kind: 'key/escape' }
    | { kind: 'key/ctrlR' }
    | { kind: 'key/ctrlG' }
    | { kind: 'key/ctrlL' }
    | { kind: 'item/apply'; id: string }
    | { kind: 'line/set'; text: string }
    | { kind: 'rsearch/setQuery'; query: string }
    | { kind: 'confirm/cancel' }
    | { kind: 'history/loaded'; history: CliHistoryEntry[] }
    | { kind: 'history/push'; entry: CliHistoryEntry }
    | { kind: 'history/patchStatus'; status: CliHistoryEntry['status'] }
    | { kind: 'ctx/setNodeValue'; key: string; value: string }
    | { kind: 'ctx/setRecent'; recent: string[] };
  ```
  (Names/shape are the phase-1 contract; if phase 1's `promptReducer.ts` diverges, adapt the dispatch calls, not the reducer.)
- Consumes: phase-1 `suggest(text, caret, ctx): { parse: CliParse; items: CliSuggestion[] }` from `./lib/suggest`; `CliSuggestCtx { recent: string[]; nodeValues: Record<string,string> }`; `CliHistoryEntry { text; status }` from `./lib/persistence`; `cliRoundTrip` (Task 3); `CLI_BY_NAME` from catalog; `RadioSettings`, `RepeaterAdminSession` from `src/shared/types`.
- Consumes: `CliReverseSearch` (Task 5), `CliConfirmBar` (Task 6) — imported but rendered only when `rsearch` / `confirmPending` are set; both files must exist before Task 4's test runs, so **Task 5 and Task 6 are implemented before this step's final `tsc`** or their imports are stubbed. To keep tasks independently green, this task creates `CliReverseSearch` and `CliConfirmBar` as **one-line placeholder modules first** (Step 3a) and Tasks 5/6 flesh them out; the placeholders compile and render nothing meaningful until then.
- Produces:
  ```ts
  export type CliGuest = 'checking' | 'guest' | 'admin';
  export interface CliPromptProps {
    history: CliHistoryEntry[];
    ctx: CliSuggestCtx;
    radioSettings: RadioSettings | null;
    hops: number;
    guest: CliGuest;
    queuedCount: number;
    onSubmit: (text: string) => void;
    onClearTranscript: () => void;
    onLoginAsAdmin: () => void;
    lineToSet?: { text: string; nonce: number } | null;   // follow-up prefill (§5.5)
  }
  export function CliPrompt(props: CliPromptProps): JSX.Element
  ```

- [ ] **Step 1: Write the failing key test (through a flushSync harness)**

Create `tests/component/cli-prompt-keys.test.tsx`. The harness holds the submit sink and wraps its own `onSubmit` in `flushSync`, mirroring `tests/component/deselect-on-outside-click.test.tsx`: React 19 under jsdom defers discrete-event commits, so without `flushSync` the caret-application layout effect and the submit-clear race do not reproduce browser timing. The production `CliPrompt` is untouched.

```tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { flushSync } from 'react-dom';
import { describe, expect, it } from 'vitest';
import type { CliSuggestCtx } from '@/panels/repeater-admin/cli/lib/suggest';
import { CliPrompt } from '@/panels/repeater-admin/cli/CliPrompt';

const ctx: CliSuggestCtx = { recent: [], nodeValues: {} };
const radio = { frequencyHz: 910_525_000, bandwidthHz: 62_500, spreadingFactor: 7, codingRate: 5, txPowerDbm: 20, repeatMode: false, pathHashMode: 2 as const };

function Harness() {
  const [sent, setSent] = useState<string[]>([]);
  return (
    <div>
      <div data-testid="sent">{sent.join('|')}</div>
      <CliPrompt
        history={[{ text: 'get radio', status: 'ok' }]}
        ctx={ctx}
        radioSettings={radio}
        hops={1}
        guest="admin"
        queuedCount={0}
        onSubmit={(t) => flushSync(() => setSent((s) => [...s, t]))}
        onClearTranscript={() => {}}
        onLoginAsAdmin={() => {}}
      />
    </div>
  );
}

function input() {
  return screen.getByRole('textbox') as HTMLInputElement;
}

describe('CliPrompt keys', () => {
  it('Tab completes to the top suggestion when the token prefix-matches', () => {
    render(<Harness />);
    const el = input();
    fireEvent.change(el, { target: { value: 'set r' } });
    fireEvent.keyDown(el, { key: 'Tab' });
    expect(el.value.startsWith('set r')).toBe(true);
    expect(el.value.length).toBeGreaterThan('set r'.length);
  });

  it('ArrowUp recalls the last history line', () => {
    render(<Harness />);
    const el = input();
    fireEvent.keyDown(el, { key: 'ArrowUp' });
    expect(el.value).toBe('get radio');
  });

  it('Enter submits the current line', () => {
    render(<Harness />);
    const el = input();
    fireEvent.change(el, { target: { value: 'reboot' } });
    fireEvent.keyDown(el, { key: 'Enter' });
    expect(screen.getByTestId('sent').textContent).toBe('reboot');
  });

  it('renders a ghost that preserves typed casing', () => {
    render(<Harness />);
    const el = input();
    fireEvent.change(el, { target: { value: 'SET r' } });
    // The ghost layer holds an invisible copy of the value plus the dim suffix.
    const ghost = document.querySelector('[data-testid="cli-ghost"]');
    expect(ghost?.textContent?.startsWith('SET r')).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run --project dom tests/component/cli-prompt-keys.test.tsx`
Expected: FAIL — cannot resolve `@/panels/repeater-admin/cli/CliPrompt`.

- [ ] **Step 3a: Create placeholder `CliReverseSearch.tsx` and `CliConfirmBar.tsx`**

So `CliPrompt` compiles now; Tasks 5 and 6 replace these bodies.

`src/renderer/panels/repeater-admin/cli/CliReverseSearch.tsx`:

```tsx
import type { CliHistoryEntry } from './lib/persistence';

export interface CliReverseSearchProps {
  query: string;
  match: CliHistoryEntry | null;
  index: number;
  total: number;
}

export function CliReverseSearch(_props: CliReverseSearchProps) {
  return null; // fleshed out in Task 5
}
```

`src/renderer/panels/repeater-admin/cli/CliConfirmBar.tsx`:

```tsx
import type { CliCommand } from '../../../../shared/repeater-cli/catalog';

export interface CliConfirmBarProps {
  text: string;
  cmd: CliCommand;
  onConfirm: () => void;
  onCancel: () => void;
}

export function CliConfirmBar(_props: CliConfirmBarProps) {
  return null; // fleshed out in Task 6
}
```

- [ ] **Step 3b: Create `CliPrompt.tsx`**

`CliPrompt` owns the reducer via `useState` + a manual `dispatch` (the reducer returns `{ state, effect? }`, so `useReducer` can't be used directly). The caret is applied imperatively in a `useLayoutEffect`. The input is **never** `disabled` (§8) — submission is gated at the `submit` effect and by greying Run.

```tsx
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Radio } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { RadioSettings } from '../../../../shared/types';
import { CLI_BY_NAME } from '../../../../shared/repeater-cli/catalog';
import { cliRoundTrip } from './lib/airtime';
import type { CliHistoryEntry } from './lib/persistence';
import { cliPromptReducer, type CliPromptState } from './lib/promptReducer';
import { suggest, type CliSuggestCtx } from './lib/suggest';
import { CliPalette } from './CliPalette';
import { CliReverseSearch } from './CliReverseSearch';
import { CliConfirmBar } from './CliConfirmBar';

export type CliGuest = 'checking' | 'guest' | 'admin';

export interface CliPromptProps {
  history: CliHistoryEntry[];
  ctx: CliSuggestCtx;
  radioSettings: RadioSettings | null;
  hops: number;
  guest: CliGuest;
  queuedCount: number;
  onSubmit: (text: string) => void;
  onClearTranscript: () => void;
  onLoginAsAdmin: () => void;
  lineToSet?: { text: string; nonce: number } | null;
}

function initialState(history: CliHistoryEntry[], ctx: CliSuggestCtx): CliPromptState {
  return {
    value: '', caret: 0, history, histIndex: -1, draft: '',
    manualOpen: false, dismissed: false, navigated: false, activeId: '',
    rsearch: null, confirmPending: null, ctx,
  };
}

function resolveCmd(value: string) {
  const trimmed = value.trim();
  return CLI_BY_NAME[trimmed] ?? null;
}

export function CliPrompt({
  history, ctx, radioSettings, hops, guest, queuedCount,
  onSubmit, onClearTranscript, onLoginAsAdmin, lineToSet,
}: CliPromptProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [state, setState] = useState<CliPromptState>(() => initialState(history, ctx));
  const stateRef = useRef(state);
  stateRef.current = state;

  // Effects the reducer emits act on the queue/transcript, which it does not own.
  const applyEffect = useCallback(
    (effect?: { kind: 'submit'; text: string } | { kind: 'clearTranscript' }) => {
      if (!effect) return;
      if (effect.kind === 'submit') {
        if (guest === 'checking' || guest === 'guest') return; // §8: submit is a no-op without admin
        onSubmit(effect.text);
      } else if (effect.kind === 'clearTranscript') {
        onClearTranscript();
      }
    },
    [guest, onSubmit, onClearTranscript],
  );

  const dispatch = useCallback(
    (action: Parameters<typeof cliPromptReducer>[1]) => {
      const { state: next, effect } = cliPromptReducer(stateRef.current, action);
      stateRef.current = next;
      setState(next);
      applyEffect(effect);
    },
    [applyEffect],
  );

  // Re-sync reducer-held history/ctx when the parent's persisted stores change.
  useEffect(() => dispatch({ kind: 'history/loaded', history }), [history, dispatch]);
  useEffect(() => dispatch({ kind: 'ctx/setRecent', recent: ctx.recent }), [ctx.recent, dispatch]);
  useEffect(() => {
    for (const [key, value] of Object.entries(ctx.nodeValues)) dispatch({ kind: 'ctx/setNodeValue', key, value });
  }, [ctx.nodeValues, dispatch]);

  // Follow-up chip prefill (§5.5): line/set, not a send.
  useEffect(() => {
    if (lineToSet) dispatch({ kind: 'line/set', text: lineToSet.text });
  }, [lineToSet, dispatch]);

  // Apply the caret imperatively after each commit — the value is controlled.
  useLayoutEffect(() => {
    const el = inputRef.current;
    if (el && el.selectionStart !== state.caret) el.setSelectionRange(state.caret, state.caret);
  }, [state.caret, state.value]);

  const { parse, items } = suggest(state.value, state.caret, state.ctx);
  const open =
    (state.manualOpen || (state.value.trim() !== '' && !state.dismissed)) && !state.rsearch && !state.confirmPending;

  // Ghost: only at end-of-line, when the top item's label prefix-matches the
  // token case-insensitively; the suffix preserves the user's typed casing.
  const top = items[0];
  const atEnd = state.caret === state.value.length;
  let ghost = '';
  if (open && top && atEnd) {
    const token = parse.token;
    if (top.label.toLowerCase().startsWith(token.toLowerCase()) && top.label.length > token.length) {
      ghost = top.label.slice(token.length);
    }
  }

  const cmd = parse.mode === 'arg' ? parse.cmd : resolveCmd(state.value);
  const airtime =
    state.value.trim() === '' ? '' : radioSettings ? cliRoundTrip(state.value.trim(), radioSettings, hops, !!cmd?.noReply).label : '—';

  const canSubmit = guest === 'admin' && state.value.trim() !== '';

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    // Map each key to a granular reducer action (§3.1). Reverse-search typing
    // routes to rsearch/setQuery; an end-of-line →/End with a live ghost accepts
    // it. Everything the reducer owns is preventDefault'd except the caret keys.
    const a = (() => {
      if (state.rsearch) {
        if (e.key === 'Backspace') return { kind: 'rsearch/setQuery', query: state.rsearch.query.slice(0, -1) } as const;
        if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) return { kind: 'rsearch/setQuery', query: state.rsearch.query + e.key } as const;
      }
      if ((e.ctrlKey || e.metaKey) && e.key === ' ') return { kind: 'key/ctrlSpace' } as const;
      if ((e.ctrlKey || e.metaKey) && e.key === 'r') return { kind: 'key/ctrlR' } as const;
      if ((e.ctrlKey || e.metaKey) && e.key === 'l') return { kind: 'key/ctrlL' } as const;
      if ((e.ctrlKey || e.metaKey) && e.key === 'g') return { kind: 'key/ctrlG' } as const;
      switch (e.key) {
        case 'Tab': return { kind: 'key/tab' } as const;
        case 'ArrowUp': return { kind: 'key/arrowUp' } as const;
        case 'ArrowDown': return { kind: 'key/arrowDown' } as const;
        case 'Enter': return { kind: 'key/enter' } as const;
        case 'Escape': return { kind: 'key/escape' } as const;
        case 'ArrowRight':
        case 'End':
          return state.caret === state.value.length && ghost ? ({ kind: 'key/acceptGhost' } as const) : null;
      }
      return null;
    })();
    if (a) {
      if (e.key !== 'ArrowRight' && e.key !== 'End') e.preventDefault();
      dispatch(a);
    }
  };

  const banner =
    guest === 'guest' ? (
      <div className="flex flex-wrap items-center gap-2 border-b border-cs-border bg-cs-warn/10 px-4 py-1.5 text-[11px] text-cs-text-muted">
        <span>This repeater only answers CLI from an admin session</span>
        <button type="button" onClick={onLoginAsAdmin} className="font-medium text-cs-accent underline-offset-2 hover:underline">
          Log in as admin →
        </button>
      </div>
    ) : null;

  return (
    <div className="shrink-0 border-t border-cs-border bg-cs-bg-2">
      {banner}
      {state.confirmPending ? (
        <CliConfirmBar
          text={state.confirmPending.text}
          cmd={state.confirmPending.cmd}
          onConfirm={() => {
            const text = state.confirmPending?.text;
            dispatch({ kind: 'confirm/cancel' });
            if (text && guest === 'admin') onSubmit(text);
          }}
          onCancel={() => dispatch({ kind: 'confirm/cancel' })}
        />
      ) : null}
      {state.rsearch ? (
        <CliReverseSearch
          query={state.rsearch.query}
          match={state.history[state.rsearch.index] ?? null}
          index={state.rsearch.index}
          total={state.history.filter((h) => h.text.toLowerCase().includes(state.rsearch?.query.toLowerCase() ?? '')).length}
        />
      ) : null}

      <div className="relative flex items-center gap-2 px-3 py-2">
        <span className="shrink-0 font-mono text-[13px] text-cs-text-muted">$</span>
        <div className="relative min-w-0 flex-1">
          <CliPalette
            open={open}
            parse={parse}
            items={items}
            activeId={state.activeId}
            nodeValues={state.ctx.nodeValues}
            radioSettings={radioSettings}
            hops={hops}
            onApply={(item) => dispatch({ kind: 'item/apply', id: item.id })}
          />
          <div aria-hidden="true" data-testid="cli-ghost" className="pointer-events-none absolute inset-0 flex items-center whitespace-pre font-mono text-[13px]">
            <span className="invisible">{state.value}</span>
            <span className="text-cs-text-dim">{ghost}</span>
          </div>
          <input
            ref={inputRef}
            role="textbox"
            aria-label="Repeater CLI command"
            value={state.value}
            spellCheck={false}
            autoComplete="off"
            maxLength={132}
            placeholder="repeater command"
            onChange={(e) => dispatch({ kind: 'value/change', value: e.target.value, caret: e.target.selectionStart ?? e.target.value.length })}
            onKeyUp={(e) => dispatch({ kind: 'caret/set', caret: e.currentTarget.selectionStart ?? 0 })}
            onClick={(e) => dispatch({ kind: 'caret/set', caret: e.currentTarget.selectionStart ?? 0 })}
            onKeyDown={onKeyDown}
            className="relative w-full bg-transparent font-mono text-[13px] text-cs-text caret-cs-accent outline-none placeholder:text-cs-text-dim"
          />
        </div>
        {airtime ? (
          <span className="flex shrink-0 items-center gap-1 font-mono text-[10px] tabular-nums text-cs-text-dim">
            <Radio size={10} aria-hidden="true" />
            {airtime}
          </span>
        ) : null}
        {queuedCount > 0 ? <span className="shrink-0 font-mono text-[10px] text-cs-text-dim">{queuedCount} queued</span> : null}
        <button
          type="button"
          disabled={!canSubmit}
          onClick={() => dispatch({ kind: 'key/enter' })}
          className={cn(
            'shrink-0 rounded border border-cs-border px-3 py-1 text-[12px]',
            canSubmit ? 'bg-cs-accent-soft/30 text-cs-text hover:bg-cs-accent-soft/50' : 'text-cs-text-dim opacity-50',
          )}
        >
          Run
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run the key test — verify it passes**

Run: `npx vitest run --project dom tests/component/cli-prompt-keys.test.tsx`
Expected: PASS, 4 tests. (`Tab` completes via the reducer's `commonPrefix`/top-item splice; `ArrowUp` recalls history; `Enter` submits through the effect; the ghost span keeps `SET r`.)

- [ ] **Step 5: Write the guest-state test**

Create `tests/component/cli-guest-blocked.test.tsx`. All three §8 states, asserting the input is never `disabled` (so it stays focusable / keyboard-live).

```tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import type { CliSuggestCtx } from '@/panels/repeater-admin/cli/lib/suggest';
import { CliPrompt, type CliGuest } from '@/panels/repeater-admin/cli/CliPrompt';

const ctx: CliSuggestCtx = { recent: [], nodeValues: {} };
const radio = { frequencyHz: 910_525_000, bandwidthHz: 62_500, spreadingFactor: 7, codingRate: 5, txPowerDbm: 20, repeatMode: false, pathHashMode: 2 as const };

function Harness({ guest }: { guest: CliGuest }) {
  const [sent, setSent] = useState<string[]>([]);
  return (
    <div>
      <div data-testid="sent">{sent.join('|')}</div>
      <CliPrompt history={[]} ctx={ctx} radioSettings={radio} hops={1} guest={guest} queuedCount={0}
        onSubmit={(t) => setSent((s) => [...s, t])} onClearTranscript={() => {}} onLoginAsAdmin={() => {}} />
    </div>
  );
}

const input = () => screen.getByRole('textbox') as HTMLInputElement;

describe('CliPrompt guest states', () => {
  it('checking: no banner, input enabled, submit is a no-op', () => {
    render(<Harness guest="checking" />);
    expect(input().disabled).toBe(false);
    expect(screen.queryByText(/only answers CLI from an admin session/)).toBeNull();
    fireEvent.change(input(), { target: { value: 'reboot' } });
    fireEvent.keyDown(input(), { key: 'Enter' });
    expect(screen.getByTestId('sent').textContent).toBe('');
  });

  it('guest: banner shown, input still enabled, submit blocked', () => {
    render(<Harness guest="guest" />);
    expect(screen.getByText(/only answers CLI from an admin session/)).toBeTruthy();
    expect(input().disabled).toBe(false);
    fireEvent.change(input(), { target: { value: 'reboot' } });
    fireEvent.keyDown(input(), { key: 'Enter' });
    expect(screen.getByTestId('sent').textContent).toBe('');
  });

  it('admin: no banner, submit works', () => {
    render(<Harness guest="admin" />);
    expect(screen.queryByText(/only answers CLI from an admin session/)).toBeNull();
    fireEvent.change(input(), { target: { value: 'reboot' } });
    fireEvent.keyDown(input(), { key: 'Enter' });
    expect(screen.getByTestId('sent').textContent).toBe('reboot');
  });
});
```

- [ ] **Step 6: Run the guest test + typecheck + lint**

Run: `npx vitest run --project dom tests/component/cli-guest-blocked.test.tsx && npx tsc --noEmit && npx biome check src/renderer/panels/repeater-admin/cli tests/component/cli-prompt-keys.test.tsx tests/component/cli-guest-blocked.test.tsx`
Expected: guest test PASS (3); typecheck clean; lint clean.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/panels/repeater-admin/cli/CliPrompt.tsx src/renderer/panels/repeater-admin/cli/CliReverseSearch.tsx src/renderer/panels/repeater-admin/cli/CliConfirmBar.tsx tests/component/cli-prompt-keys.test.tsx tests/component/cli-guest-blocked.test.tsx
git commit -m "feat(cli): native ghost-completing prompt over the phase-1 reducer

A bare <input> layered behind an aligned ghost span (its own mono tokens),
an airtime readout, and a Run button. Keys route to cliPromptReducer, whose
submit/clearTranscript effects the prompt forwards to the parent. The input
is never disabled: the three-way guest state gates submission at the effect
and greys Run instead, so ghost/Tab/history/⌃R stay live logged out.
CliReverseSearch and CliConfirmBar land as placeholders here and are filled
in by Tasks 5 and 6.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: `CliReverseSearch.tsx` — the `⌃R` line (§3.2)

**Files:**
- Modify: `src/renderer/panels/repeater-admin/cli/CliReverseSearch.tsx` (replace the Task 4 placeholder body)
- Create: `tests/component/cli-reverse-search.test.tsx`
- Reference: `.design-ref/cli-autocomplete/cli-prompt.jsx:43-70` (recreate).

**Interfaces:**
- Consumes: `CliHistoryEntry { text: string; status: 'ok'|'error'|'timeout'|'sent' }` from `./lib/persistence`.
- Produces (unchanged signature from Task 4's placeholder):
  ```ts
  export interface CliReverseSearchProps { query: string; match: CliHistoryEntry | null; index: number; total: number }
  export function CliReverseSearch(props: CliReverseSearchProps): JSX.Element | null
  ```

- [ ] **Step 1: Write the failing test**

Create `tests/component/cli-reverse-search.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CliReverseSearch } from '@/panels/repeater-admin/cli/CliReverseSearch';

describe('CliReverseSearch', () => {
  it('highlights the matched substring and shows the position counter', () => {
    render(<CliReverseSearch query="rad" match={{ text: 'get radio', status: 'ok' }} index={0} total={3} />);
    expect(screen.getByText('rad').className).toMatch(/text-cs-accent/);
    expect(screen.getByText('1/3')).toBeTruthy();
  });

  it('shows the status glyph for the matched entry', () => {
    render(<CliReverseSearch query="re" match={{ text: 'reboot', status: 'timeout' }} index={1} total={2} />);
    expect(screen.getByText('⧗')).toBeTruthy();
  });

  it('reads "failing reverse-i-search" and suppresses the counter when there is no match', () => {
    render(<CliReverseSearch query="zzz" match={null} index={0} total={0} />);
    expect(screen.getByText(/failing reverse-i-search/)).toBeTruthy();
    expect(screen.queryByText('0/0')).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run --project dom tests/component/cli-reverse-search.test.tsx`
Expected: FAIL — the placeholder returns `null`, so no text renders.

- [ ] **Step 3: Replace the `CliReverseSearch.tsx` body**

```tsx
import { Kbd } from '@/components/ui/kbd';
import type { CliHistoryEntry } from './lib/persistence';

export interface CliReverseSearchProps {
  query: string;
  match: CliHistoryEntry | null;
  index: number;
  total: number;
}

const GLYPH: Record<CliHistoryEntry['status'], [string, string]> = {
  ok: ['✓', 'text-cs-online'],
  error: ['✕', 'text-cs-danger'],
  timeout: ['⧗', 'text-cs-danger'],
  sent: ['·', 'text-cs-text-dim'],
};

export function CliReverseSearch({ query, match, index, total }: CliReverseSearchProps) {
  const at = match ? match.text.toLowerCase().indexOf(query.toLowerCase()) : -1;
  const glyph = match ? GLYPH[match.status] : GLYPH.ok;

  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 overflow-hidden border-t border-cs-border bg-cs-bg-3 px-4 py-2">
      <span className="shrink-0 font-mono text-[12.5px] text-cs-accent">
        (reverse-i-search)`<span className="text-cs-text">{query}</span>':
      </span>
      {match ? (
        <span className="truncate font-mono text-[12.5px] text-cs-text" style={{ flex: '1 1 140px', minWidth: 120 }}>
          {at >= 0 ? (
            <>
              {match.text.slice(0, at)}
              <span className="bg-cs-accent-soft text-cs-accent">{match.text.slice(at, at + query.length)}</span>
              {match.text.slice(at + query.length)}
            </>
          ) : (
            match.text
          )}
        </span>
      ) : (
        <span className="font-mono text-[12.5px] text-cs-danger" style={{ flex: '1 1 140px', minWidth: 120 }}>
          failing reverse-i-search
        </span>
      )}
      {match ? (
        <span className={`shrink-0 font-mono text-[12px] ${glyph[1]}`} title={match.status}>{glyph[0]}</span>
      ) : null}
      {total > 0 ? (
        <span className="shrink-0 font-mono text-[10px] tabular-nums text-cs-text-dim">{index + 1}/{total}</span>
      ) : null}
      <span className="flex min-w-0 shrink items-center gap-2 overflow-hidden text-[10px] text-cs-text-dim">
        <span className="whitespace-nowrap"><Kbd>⌃R</Kbd> older</span>
        <span className="whitespace-nowrap"><Kbd>↵</Kbd> run</span>
        <span className="whitespace-nowrap"><Kbd>→</Kbd> edit</span>
        <span className="whitespace-nowrap"><Kbd>⌃G</Kbd> abort</span>
      </span>
    </div>
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run --project dom tests/component/cli-reverse-search.test.tsx`
Expected: PASS, 3 tests.

- [ ] **Step 5: Typecheck + lint**

Run: `npx tsc --noEmit && npx biome check src/renderer/panels/repeater-admin/cli tests/component/cli-reverse-search.test.tsx`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/panels/repeater-admin/cli/CliReverseSearch.tsx tests/component/cli-reverse-search.test.tsx
git commit -m "feat(cli): bash-style reverse-i-search line

Renders the (reverse-i-search)\`query': prompt with the matched substring
highlighted, a per-entry status glyph, and an n/total counter that is
suppressed (not 0/0) when the search is failing, which instead reads
'failing reverse-i-search'.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: `CliConfirmBar.tsx` — hold-to-send (§Decisions)

**Files:**
- Modify: `src/renderer/panels/repeater-admin/cli/CliConfirmBar.tsx` (replace the Task 4 placeholder body)
- Create: `tests/component/cli-confirm.test.tsx`
- Reference: `.design-ref/cli-autocomplete/cli-prompt.jsx:7-40` (recreate). The mockup has no keyboard path — the gesture is pointer-only.

**Interfaces:**
- Consumes: `CliCommand` from catalog.
- Produces (unchanged from Task 4's placeholder):
  ```ts
  export interface CliConfirmBarProps { text: string; cmd: CliCommand; onConfirm: () => void; onCancel: () => void }
  export function CliConfirmBar(props: CliConfirmBarProps): JSX.Element
  ```

- [ ] **Step 1: Write the failing test**

Create `tests/component/cli-confirm.test.tsx`. Fake timers drive the 900 ms hold.

```tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CliCommand } from '../../src/shared/repeater-cli/catalog';
import { CliConfirmBar } from '@/panels/repeater-admin/cli/CliConfirmBar';

const cmd: CliCommand = { name: 'reboot', group: 'System', desc: 'Reboot the node.', danger: true, note: 'The node drops off the mesh briefly.' };

afterEach(() => vi.useRealTimers());

describe('CliConfirmBar', () => {
  it('fires onConfirm only after a full 900ms hold', () => {
    vi.useFakeTimers();
    const onConfirm = vi.fn();
    render(<CliConfirmBar text="reboot" cmd={cmd} onConfirm={onConfirm} onCancel={() => {}} />);
    const hold = screen.getByRole('button', { name: /hold to send/i });
    fireEvent.mouseDown(hold);
    vi.advanceTimersByTime(899);
    expect(onConfirm).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('cancels the hold when the pointer releases early', () => {
    vi.useFakeTimers();
    const onConfirm = vi.fn();
    render(<CliConfirmBar text="reboot" cmd={cmd} onConfirm={onConfirm} onCancel={() => {}} />);
    const hold = screen.getByRole('button', { name: /hold to send/i });
    fireEvent.mouseDown(hold);
    vi.advanceTimersByTime(400);
    fireEvent.mouseUp(hold);
    vi.advanceTimersByTime(1000);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('shows the command note and a Cancel control', () => {
    const onCancel = vi.fn();
    render(<CliConfirmBar text="reboot" cmd={cmd} onConfirm={() => {}} onCancel={onCancel} />);
    expect(screen.getByText(/drops off the mesh briefly/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run --project dom tests/component/cli-confirm.test.tsx`
Expected: FAIL — the placeholder returns `null`.

- [ ] **Step 3: Replace the `CliConfirmBar.tsx` body**

```tsx
import { useEffect, useRef, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import type { CliCommand } from '../../../../shared/repeater-cli/catalog';

export interface CliConfirmBarProps {
  text: string;
  cmd: CliCommand;
  onConfirm: () => void;
  onCancel: () => void;
}

function HoldToSend({ label, onComplete }: { label: string; onComplete: () => void }) {
  const [held, setHeld] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const start = () => {
    setHeld(true);
    timer.current = setTimeout(() => {
      setHeld(false);
      onComplete();
    }, 900);
  };
  const cancel = () => {
    setHeld(false);
    if (timer.current) clearTimeout(timer.current);
  };
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  return (
    <button
      type="button"
      onMouseDown={start}
      onMouseUp={cancel}
      onMouseLeave={cancel}
      onTouchStart={start}
      onTouchEnd={cancel}
      className="relative shrink-0 overflow-hidden rounded border border-cs-danger/30 bg-cs-danger/15 px-3 text-[12px] font-medium text-cs-danger"
      style={{ height: 28 }}
    >
      <span
        className="absolute inset-y-0 left-0 bg-cs-danger/30"
        style={{ width: held ? '100%' : '0%', transition: held ? 'width 900ms linear' : 'width 120ms ease-out' }}
      />
      <span className="relative">{label}</span>
    </button>
  );
}

export function CliConfirmBar({ text, cmd, onConfirm, onCancel }: CliConfirmBarProps) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-cs-danger/30 bg-cs-danger/10 px-4 py-2">
      <AlertTriangle size={14} aria-hidden="true" className="shrink-0 text-cs-danger" />
      <span className="text-[12px] leading-snug text-cs-text" style={{ textWrap: 'pretty', flex: '1 1 220px', minWidth: 0 }}>
        <span className="font-mono text-cs-danger">{text}</span>
        <span className="text-cs-text-muted"> — {cmd.note ?? 'This cannot be undone from here.'}</span>
        {cmd.noReply ? <span className="text-cs-text-dim"> The node will not confirm.</span> : null}
      </span>
      <span className="flex shrink-0 items-center gap-2">
        <HoldToSend label="Hold to send" onComplete={onConfirm} />
        <button type="button" onClick={onCancel} className="text-[12px] text-cs-text-muted" style={{ height: 28 }}>
          Cancel
        </button>
      </span>
    </div>
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run --project dom tests/component/cli-confirm.test.tsx`
Expected: PASS, 3 tests.

- [ ] **Step 5: Typecheck + lint**

Run: `npx tsc --noEmit && npx biome check src/renderer/panels/repeater-admin/cli tests/component/cli-confirm.test.tsx`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/panels/repeater-admin/cli/CliConfirmBar.tsx tests/component/cli-confirm.test.tsx
git commit -m "feat(cli): hold-to-send confirm bar for destructive commands

A pointer-held button fills over 900ms and fires only on completion,
cancelling on early release or pointer-leave. Shows the command's own note
(or a fallback) and, for no-reply commands, that the node will not confirm.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: `CliRow.tsx` + `CliTranscript.tsx` — the log (§5)

**Files:**
- Create: `src/renderer/panels/repeater-admin/cli/CliRow.tsx`
- Create: `src/renderer/panels/repeater-admin/cli/CliTranscript.tsx`
- Create: `tests/component/cli-transcript-states.test.tsx`
- Reference: `.design-ref/cli-autocomplete/cli-transcript.jsx` (recreate the `dim`/blinking-cursor/`MsCounter` treatment only; the other three in-flight treatments and streaming are deliberately not built — §5.2).

**Interfaces:**
- Consumes: phase-1 `queue.ts`:
  ```ts
  type CliEntryState = 'queued' | 'sending' | 'ok' | 'error' | 'timeout' | 'sent' | 'cancelled';
  interface CliEntry { id; text; cmd: CliCommand | null; state: CliEntryState; queuedAt; startedAt: number|null; endedAt: number|null; reply: string|null; error: { kind: 'refused'|'timeout'|'transport'|'superseded'; message: string } | null }
  ```
- Produces:
  ```ts
  export interface FollowUp { label: string; text: string }
  export interface CliRowProps {
    entry: CliEntry;
    timeoutMs: number;                 // 30_000 in phase 2 (hardcoded; §5.4)
    followUps: FollowUp[];
    onRetry: (entry: CliEntry) => void;
    onEdit: (text: string) => void;    // edit-and-resend / follow-up prefill
    onCancel: (id: string) => void;    // × on a queued entry
  }
  export function CliRow(props: CliRowProps): JSX.Element

  export interface CliTranscriptProps {
    entries: CliEntry[];
    timeoutMs: number;
    followUpsFor: (entry: CliEntry) => FollowUp[];
    onRetry: (entry: CliEntry) => void;
    onEdit: (text: string) => void;
    onCancel: (id: string) => void;
  }
  export function CliTranscript(props: CliTranscriptProps): JSX.Element
  ```

- [ ] **Step 1: Write the failing test**

Create `tests/component/cli-transcript-states.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { CliEntry } from '@/panels/repeater-admin/cli/lib/queue';
import { CliRow } from '@/panels/repeater-admin/cli/CliRow';
import { CliTranscript } from '@/panels/repeater-admin/cli/CliTranscript';

const base: CliEntry = {
  id: 'e1', text: 'get radio', cmd: null, state: 'ok',
  queuedAt: 0, startedAt: 100, endedAt: 1600, reply: '869.525,250,11,5', error: null,
};
const noop = () => {};
const row = (over: Partial<CliEntry>) => (
  <CliRow entry={{ ...base, ...over }} timeoutMs={30_000} followUps={[]} onRetry={noop} onEdit={noop} onCancel={noop} />
);

describe('CliRow error kinds', () => {
  it('refused: renders the Err reply in danger and offers no Retry', () => {
    render(row({ state: 'error', reply: 'Err - unknown command', error: { kind: 'refused', message: 'Err - unknown command' } }));
    expect(screen.getByText(/Err - unknown command/).className).toMatch(/text-cs-danger/);
    expect(screen.queryByRole('button', { name: /retry/i })).toBeNull();
  });

  it('timeout: explains the 30s wait and offers Retry + edit-and-resend', () => {
    render(row({ state: 'timeout', reply: null, error: { kind: 'timeout', message: 'no reply' } }));
    expect(screen.getByText(/no reply after 30 s/)).toBeTruthy();
    expect(screen.getByRole('button', { name: /retry/i })).toBeTruthy();
    expect(screen.getByText(/edit and resend/)).toBeTruthy();
  });

  it('timeout on a serial-only command adds the serial hint', () => {
    render(row({ state: 'timeout', cmd: { name: 'erase', group: 'System', desc: 'x', serialOnly: true }, error: { kind: 'timeout', message: 'no reply' } }));
    expect(screen.getByText(/serial-console only/)).toBeTruthy();
  });

  it('superseded: reads as another client taking over', () => {
    render(row({ state: 'error', error: { kind: 'superseded', message: 'superseded by newer CLI command' } }));
    expect(screen.getByText(/another client sent a command/)).toBeTruthy();
  });

  it('transport: shows the server message and Retry', () => {
    render(row({ state: 'error', error: { kind: 'transport', message: 'radio disconnected' } }));
    expect(screen.getByText(/radio disconnected/)).toBeTruthy();
    expect(screen.getByRole('button', { name: /retry/i })).toBeTruthy();
  });
});

describe('CliRow reply states', () => {
  it('in-flight: dims the echo and shows a blinking cursor', () => {
    const { container } = render(row({ state: 'sending', startedAt: Date.now(), endedAt: null, reply: null }));
    expect(container.querySelector('[data-testid="cli-echo"]')?.className).toMatch(/opacity-50/);
    expect(container.querySelector('[data-testid="cli-cursor"]')).toBeTruthy();
  });

  it('adds a truncation hint when the reply is at least 156 bytes', () => {
    render(row({ reply: 'x'.repeat(156) }));
    expect(screen.getByText(/may be truncated by firmware/)).toBeTruthy();
  });

  it('omits the truncation hint below 156 bytes', () => {
    render(row({ reply: 'x'.repeat(155) }));
    expect(screen.queryByText(/may be truncated by firmware/)).toBeNull();
  });

  it('renders follow-up chips', () => {
    render(
      <CliRow entry={base} timeoutMs={30_000} followUps={[{ label: 'Change this value', text: 'set radio 869.525,250,11,5' }]}
        onRetry={noop} onEdit={noop} onCancel={noop} />,
    );
    expect(screen.getByText('set radio 869.525,250,11,5')).toBeTruthy();
  });
});

describe('CliTranscript', () => {
  it('renders the empty state legend when there are no entries', () => {
    render(<CliTranscript entries={[]} timeoutMs={30_000} followUpsFor={() => []} onRetry={noop} onEdit={noop} onCancel={noop} />);
    expect(screen.getByText(/reverse search/)).toBeTruthy();
  });

  it('offers a cancel × on a queued entry', () => {
    render(
      <CliTranscript entries={[{ ...base, state: 'queued', reply: null, endedAt: null, startedAt: null }]}
        timeoutMs={30_000} followUpsFor={() => []} onRetry={noop} onEdit={noop} onCancel={noop} />,
    );
    expect(screen.getByRole('button', { name: /cancel queued/i })).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run --project dom tests/component/cli-transcript-states.test.tsx`
Expected: FAIL — cannot resolve `@/panels/repeater-admin/cli/CliRow`.

- [ ] **Step 3: Create `CliRow.tsx`**

```tsx
import { useEffect, useState } from 'react';
import { RefreshCw, X } from 'lucide-react';
import type { CliEntry } from './lib/queue';

export interface FollowUp {
  label: string;
  text: string;
}

export interface CliRowProps {
  entry: CliEntry;
  timeoutMs: number;
  followUps: FollowUp[];
  onRetry: (entry: CliEntry) => void;
  onEdit: (text: string) => void;
  onCancel: (id: string) => void;
}

function byteLength(s: string): number {
  return new TextEncoder().encode(s).length;
}

// A 47ms tick, live only while active. Drives the in-flight elapsed counter.
function useTick(active: boolean) {
  const [, force] = useState(0);
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => force((n) => n + 1), 47);
    return () => clearInterval(t);
  }, [active]);
}

function MsCounter({ from, done }: { from: number; done: number | null }) {
  useTick(done == null);
  const ms = (done ?? Date.now()) - from;
  return <span className="font-mono text-[11px] tabular-nums text-cs-text-dim">{ms.toLocaleString('en-US')} ms</span>;
}

export function CliRow({ entry, timeoutMs, followUps, onRetry, onEdit, onCancel }: CliRowProps) {
  const inFlight = entry.state === 'sending';
  const failed = entry.state === 'timeout' || (entry.state === 'error' && entry.error?.kind !== 'refused');
  const isTimeout = entry.state === 'timeout' || entry.error?.kind === 'timeout';
  const isSuperseded = entry.error?.kind === 'superseded';
  const isTransport = entry.error?.kind === 'transport';
  const truncated = entry.reply != null && byteLength(entry.reply) >= 156;

  return (
    <div className={`px-4 py-1.5 ${inFlight ? 'opacity-50' : ''}`}>
      <div className="flex items-baseline gap-2">
        <span className={`shrink-0 font-mono text-[12.5px] ${failed ? 'text-cs-danger' : 'text-cs-accent'}`}>$</span>
        <span data-testid="cli-echo" className={`min-w-0 flex-1 break-all font-mono text-[12.5px] ${failed ? 'text-cs-danger' : 'text-cs-text'} ${inFlight ? 'opacity-50' : ''}`}>
          {entry.text}
        </span>
        {inFlight ? (
          <span className="flex shrink-0 items-center gap-2">
            <span data-testid="cli-cursor" className="inline-block animate-pulse bg-cs-accent" style={{ width: 7, height: 12 }} />
            <MsCounter from={entry.startedAt ?? Date.now()} done={null} />
          </span>
        ) : entry.state === 'sent' ? (
          <span className="shrink-0 font-mono text-[10px] uppercase tracking-wider text-cs-text-dim">sent · no reply expected</span>
        ) : entry.state === 'queued' ? (
          <button type="button" aria-label="Cancel queued command" onClick={() => onCancel(entry.id)} className="shrink-0 text-cs-text-dim hover:text-cs-danger">
            <X size={12} aria-hidden="true" />
          </button>
        ) : entry.startedAt != null && entry.endedAt != null ? (
          <MsCounter from={entry.startedAt} done={entry.endedAt} />
        ) : null}
      </div>

      {entry.reply != null && entry.reply.length > 0 ? (
        <div className="pl-4 pt-0.5">
          {entry.reply.split('\n').map((line, i) => (
            <div key={i} className={`whitespace-pre-wrap break-all font-mono text-[12.5px] leading-snug ${/^err/i.test(line) ? 'text-cs-danger' : 'text-cs-text-muted'}`}>
              {line}
            </div>
          ))}
          {truncated ? <div className="pt-0.5 text-[10px] text-cs-text-dim">may be truncated by firmware</div> : null}
        </div>
      ) : null}

      {isSuperseded ? (
        <div className="pl-4 pt-1 text-[11px] text-cs-danger">cancelled — another client sent a command to this repeater</div>
      ) : null}

      {isTimeout ? (
        <div className="flex flex-wrap items-center gap-2 pl-4 pt-1">
          <span className="font-mono text-[11px] text-cs-danger">no reply after {(timeoutMs / 1000).toFixed(0)} s</span>
          {entry.cmd?.serialOnly ? <span className="text-[11px] text-cs-text-dim">— this command is serial-console only</span> : null}
          <button type="button" onClick={() => onRetry(entry)} className="flex items-center gap-1 rounded border border-cs-danger/30 bg-cs-danger/15 px-1.5 py-0.5 text-[10px] text-cs-danger">
            <RefreshCw size={10} aria-hidden="true" />
            Retry
          </button>
          <button type="button" onClick={() => onEdit(entry.text)} className="text-[10px] text-cs-text-dim underline-offset-2 hover:text-cs-text-muted hover:underline">
            edit and resend
          </button>
        </div>
      ) : null}

      {isTransport ? (
        <div className="flex flex-wrap items-center gap-2 pl-4 pt-1">
          <span className="font-mono text-[11px] text-cs-danger">{entry.error?.message}</span>
          <button type="button" onClick={() => onRetry(entry)} className="flex items-center gap-1 rounded border border-cs-danger/30 bg-cs-danger/15 px-1.5 py-0.5 text-[10px] text-cs-danger">
            <RefreshCw size={10} aria-hidden="true" />
            Retry
          </button>
        </div>
      ) : null}

      {followUps.length > 0 ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 pl-4 pt-1.5">
          {followUps.map((f) => (
            <span key={f.text} className="flex items-center gap-1.5">
              <span className="text-[10px] uppercase tracking-wider text-cs-text-dim">{f.label}</span>
              <button type="button" onClick={() => onEdit(f.text)} className="rounded border border-cs-border bg-cs-bg-3 px-1.5 py-0.5 font-mono text-[11px] text-cs-text-muted hover:border-cs-accent/40 hover:text-cs-accent">
                {f.text}
              </button>
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 4: Create `CliTranscript.tsx`**

```tsx
import { useEffect, useRef } from 'react';
import { Kbd } from '@/components/ui/kbd';
import type { CliEntry } from './lib/queue';
import { CliRow, type FollowUp } from './CliRow';

export interface CliTranscriptProps {
  entries: CliEntry[];
  timeoutMs: number;
  followUpsFor: (entry: CliEntry) => FollowUp[];
  onRetry: (entry: CliEntry) => void;
  onEdit: (text: string) => void;
  onCancel: (id: string) => void;
}

function TranscriptEmpty() {
  return (
    <div className="px-4 py-4">
      <p className="text-[13px] text-cs-text-dim" style={{ textWrap: 'pretty' }}>
        Type a repeater CLI command (e.g. <code className="rounded bg-cs-bg-3 px-1 py-0.5 font-mono text-[12px] text-cs-text-muted">get radio</code>,{' '}
        <code className="rounded bg-cs-bg-3 px-1 py-0.5 font-mono text-[12px] text-cs-text-muted">discover.neighbors</code>).
      </p>
      <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] text-cs-text-dim">
        <span><Kbd>⌃Space</Kbd> suggestions</span>
        <span><Kbd>↹</Kbd> complete</span>
        <span><Kbd>↑</Kbd> previous</span>
        <span><Kbd>⌃R</Kbd> reverse search</span>
        <span><Kbd>⌃L</Kbd> clear</span>
      </div>
    </div>
  );
}

export function CliTranscript({ entries, timeoutMs, followUpsFor, onRetry, onEdit, onCancel }: CliTranscriptProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [entries]);
  return (
    <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto py-2">
      {entries.length === 0 ? <TranscriptEmpty /> : null}
      {entries.map((e) => (
        <CliRow key={e.id} entry={e} timeoutMs={timeoutMs} followUps={followUpsFor(e)} onRetry={onRetry} onEdit={onEdit} onCancel={onCancel} />
      ))}
    </div>
  );
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `npx vitest run --project dom tests/component/cli-transcript-states.test.tsx`
Expected: PASS, 10 tests.

- [ ] **Step 6: Typecheck + lint**

Run: `npx tsc --noEmit && npx biome check src/renderer/panels/repeater-admin/cli tests/component/cli-transcript-states.test.tsx`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/panels/repeater-admin/cli/CliRow.tsx src/renderer/panels/repeater-admin/cli/CliTranscript.tsx tests/component/cli-transcript-states.test.tsx
git commit -m "feat(cli): transcript scroller with honest in-flight and error states

One row per queued/in-flight/settled command: a dimmed echo, blinking
cursor and live elapsed ms while sending; monospace wrapped replies with
Err-lines in danger and a 'may be truncated by firmware' hint at >=156
bytes; and the four §5.4 failure treatments (refused as a reply, timeout
with Retry + edit-and-resend + serial hint, superseded, transport). Queued
rows get a cancel ×; the empty state carries the key legend.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: `RebootPending.tsx` — unsaved-changes state (§6), tier two in `index.tsx`

**Files:**
- Create: `src/renderer/panels/repeater-admin/cli/RebootPending.tsx`
- Create: `tests/component/cli-reboot-pending.test.tsx`
- Modify: `src/renderer/panels/repeater-admin/index.tsx` (lift reboot-pending state above the `key={contact.key}` boundary; render tier-two chip + tab dot)

**Interfaces:**
- Consumes: phase-1 `RebootPending` type: `{ settings: { label: string; verify: string | null }[]; dismissed: boolean; rebootSentAtMs: number | null }`; `loadPendingReboot(pubkeyHex, storage?)`, `savePendingReboot(pubkeyHex, p, storage?)` from `./lib/persistence`; `CLI_BY_NAME`, `CliCommand` from catalog; `Contact` from `src/shared/types` (`publicKeyHex`, optional `lastSeenMs` at `:100`).
- Produces:
  ```ts
  export type RebootPendingState = RebootPending;   // one shape — phase 1's exported RebootPending (from ./lib/persistence)
  export const EMPTY_REBOOT: RebootPendingState;
  export function armReboot(prev: RebootPendingState, cmd: CliCommand): RebootPendingState;   // §6 derive+dedup, clears dismissed
  export function markRebootSent(prev: RebootPendingState, atMs: number): RebootPendingState;  // on reboot/clkreboot settle
  export function clearIfHeard(prev: RebootPendingState, lastSeenMs: number | undefined): RebootPendingState;

  export interface RebootStripProps { pending: RebootPendingState; onRunVerify: (verify: string) => void; onRebootNow: () => void; onDismiss: () => void }
  export function RebootStrip(props: RebootStripProps): JSX.Element | null;   // tier one, rendered in CliTab

  export function RebootHeaderChip(props: { count: number; onClick: () => void }): JSX.Element;   // tier two, index.tsx
  export function RebootTabDot(): JSX.Element;                                                     // tier two, index.tsx
  ```

- [ ] **Step 1: Write the failing test**

Create `tests/component/cli-reboot-pending.test.tsx`. Covers the pure helpers (arm/dedup/clear) plus the tier-one render.

```tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { CliCommand } from '../../src/shared/repeater-cli/catalog';
import {
  armReboot, clearIfHeard, EMPTY_REBOOT, markRebootSent, RebootStrip, type RebootPendingState,
} from '@/panels/repeater-admin/cli/RebootPending';

const setRadio: CliCommand = { name: 'set radio', group: 'Radio', desc: 'x', key: 'radio', reboot: true };

describe('reboot-pending helpers', () => {
  it('arms a settings entry, deriving the verify get-command and label', () => {
    const p = armReboot(EMPTY_REBOOT, setRadio);
    expect(p.settings).toHaveLength(1);
    expect(p.settings[0].label).toBe('radio');
    // verify is the get-command sharing this key; if the catalog has `get radio`
    // it resolves to that, else null. Assert the shape, not a catalog value:
    expect(['get radio', null]).toContain(p.settings[0].verify);
  });

  it('dedups on key and clears dismissed on a re-write', () => {
    const once = armReboot(EMPTY_REBOOT, setRadio);
    const dismissed = { ...once, dismissed: true };
    const twice = armReboot(dismissed, setRadio);
    expect(twice.settings).toHaveLength(1);
    expect(twice.dismissed).toBe(false);
  });

  it('markRebootSent records the timestamp (rebooting is derived)', () => {
    const p = markRebootSent(armReboot(EMPTY_REBOOT, setRadio), 5000);
    expect(p.rebootSentAtMs).toBe(5000);
  });

  it('clears once the node is heard after the reboot was sent', () => {
    const sent = markRebootSent(armReboot(EMPTY_REBOOT, setRadio), 5000);
    expect(clearIfHeard(sent, 4000)).toBe(sent);            // heard before → unchanged
    expect(clearIfHeard(sent, 6000)).toEqual(EMPTY_REBOOT); // heard after → cleared
    expect(clearIfHeard(sent, undefined)).toBe(sent);       // never heard → unchanged
  });
});

describe('RebootStrip', () => {
  const pending: RebootPendingState = { settings: [{ label: 'radio', verify: 'get radio' }], dismissed: false, rebootSentAtMs: null };

  it('renders nothing when dismissed', () => {
    const { container } = render(<RebootStrip pending={{ ...pending, dismissed: true }} onRunVerify={() => {}} onRebootNow={() => {}} onDismiss={() => {}} />);
    expect(container.firstChild).toBeNull();
  });

  it('runs a setting verify, reboots, and dismisses', () => {
    const onRunVerify = vi.fn();
    const onRebootNow = vi.fn();
    const onDismiss = vi.fn();
    render(<RebootStrip pending={pending} onRunVerify={onRunVerify} onRebootNow={onRebootNow} onDismiss={onDismiss} />);
    fireEvent.click(screen.getByRole('button', { name: 'radio' }));
    expect(onRunVerify).toHaveBeenCalledWith('get radio');
    fireEvent.click(screen.getByRole('button', { name: /reboot now/i }));
    expect(onRebootNow).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /dismiss/i }));
    expect(onDismiss).toHaveBeenCalled();
  });

  it('shows a rebooting form (manual dismiss only) while a reboot has been sent', () => {
    render(<RebootStrip pending={{ ...pending, rebootSentAtMs: 1000 }} onRunVerify={() => {}} onRebootNow={() => {}} onDismiss={() => {}} />);
    expect(screen.getByText(/rebooting/i)).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run --project dom tests/component/cli-reboot-pending.test.tsx`
Expected: FAIL — cannot resolve `@/panels/repeater-admin/cli/RebootPending`.

- [ ] **Step 3: Create `RebootPending.tsx`**

```tsx
import { RotateCcw, TriangleAlert, X } from 'lucide-react';
import { CLI_BY_NAME, type CliCommand } from '../../../../shared/repeater-cli/catalog';
import type { RebootPending } from './lib/persistence';

// One shape: phase 1 owns the persisted RebootPending; this is just its alias.
export type RebootPendingState = RebootPending;

export const EMPTY_REBOOT: RebootPendingState = { settings: [], dismissed: false, rebootSentAtMs: null };

// Derive a settings entry from the command that armed it (§6): verify is the
// get-command sharing this key, else null; label is the name minus 'set '.
function deriveRebootEntry(cmd: CliCommand): { label: string; verify: string | null } {
  const label = cmd.name.startsWith('set ') ? cmd.name.slice(4) : cmd.name;
  let verify: string | null = null;
  if (cmd.key) {
    for (const c of Object.values(CLI_BY_NAME)) {
      if (c.key === cmd.key && c.name.startsWith('get ')) {
        verify = c.name;
        break;
      }
    }
  }
  return { label, verify };
}

export function armReboot(prev: RebootPendingState, cmd: CliCommand): RebootPendingState {
  const entry = deriveRebootEntry(cmd);
  // Dedup on the command's key, falling back to the label — never string
  // surgery on the name, which breaks for reboot-required commands not shaped
  // 'set <x>'.
  const dedupKey = cmd.key ?? entry.label;
  const existing = prev.settings.find((s) => (cmd.key ? s.label === entry.label && s.verify === entry.verify : s.label === dedupKey));
  const settings = existing ? prev.settings : [...prev.settings, entry];
  return { ...prev, settings, dismissed: false };
}

export function markRebootSent(prev: RebootPendingState, atMs: number): RebootPendingState {
  return { ...prev, rebootSentAtMs: atMs };
}

export function clearIfHeard(prev: RebootPendingState, lastSeenMs: number | undefined): RebootPendingState {
  if (prev.rebootSentAtMs == null) return prev;
  if (lastSeenMs != null && lastSeenMs > prev.rebootSentAtMs) return EMPTY_REBOOT;
  return prev;
}

export interface RebootStripProps {
  pending: RebootPendingState;
  onRunVerify: (verify: string) => void;
  onRebootNow: () => void;
  onDismiss: () => void;
}

export function RebootStrip({ pending, onRunVerify, onRebootNow, onDismiss }: RebootStripProps) {
  if (pending.settings.length === 0 || pending.dismissed) return null;
  const rebooting = pending.rebootSentAtMs != null;

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-cs-warn/30 bg-cs-warn/10 px-4 py-2 text-[11px]">
      <TriangleAlert size={13} aria-hidden="true" className="shrink-0 text-cs-warn" />
      {rebooting ? (
        <span className="text-cs-text-muted">Rebooting — waiting for the node to be heard again.</span>
      ) : (
        <>
          <span className="text-cs-text-muted">
            {pending.settings.length} setting{pending.settings.length > 1 ? 's' : ''} written but not yet live
          </span>
          <span className="flex flex-wrap items-center gap-1.5">
            {pending.settings.map((s) => (
              <button
                key={s.label}
                type="button"
                disabled={!s.verify}
                onClick={() => s.verify && onRunVerify(s.verify)}
                className="rounded border border-cs-border bg-cs-bg-3 px-1.5 py-0.5 font-mono text-[11px] text-cs-text-muted enabled:hover:text-cs-accent disabled:opacity-50"
              >
                {s.label}
              </button>
            ))}
          </span>
          <button type="button" onClick={onRebootNow} className="flex items-center gap-1 rounded border border-cs-accent/30 bg-cs-accent-soft px-2 py-0.5 text-[11px] text-cs-accent">
            <RotateCcw size={11} aria-hidden="true" />
            Reboot now
          </button>
        </>
      )}
      <button type="button" aria-label="Dismiss" onClick={onDismiss} className="ml-auto shrink-0 text-cs-text-dim hover:text-cs-text-muted">
        <X size={13} aria-hidden="true" />
      </button>
    </div>
  );
}

export function RebootHeaderChip({ count, onClick }: { count: number; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-1 rounded border border-cs-warn/30 bg-cs-warn/10 px-2 py-0.5 text-[11px] text-cs-warn"
    >
      <TriangleAlert size={11} aria-hidden="true" />
      reboot pending · {count}
    </button>
  );
}

export function RebootTabDot() {
  return <span aria-hidden="true" className="ml-1 inline-block size-1.5 rounded-full bg-cs-warn" />;
}
```

- [ ] **Step 4: Run the component test — verify it passes**

Run: `npx vitest run --project dom tests/component/cli-reboot-pending.test.tsx`
Expected: PASS, 8 tests.

- [ ] **Step 5: Lift reboot-pending state into `index.tsx` (tier two)**

In `src/renderer/panels/repeater-admin/index.tsx`, above the `key={contact.key}` remount boundary. Add imports and state; the persisted store is keyed by `contact.publicKeyHex` (§2.6) so it survives the remount that keys on `contact.key`.

Add to the import block:

```tsx
import { loadPendingReboot, savePendingReboot } from './cli/lib/persistence';
import { clearIfHeard, EMPTY_REBOOT, RebootHeaderChip, RebootTabDot, type RebootPendingState } from './cli/RebootPending';
```

After the `session` state (~line 55), add:

```tsx
  const [sessionChecked, setSessionChecked] = useState(false);
  const [pending, setPendingState] = useState<RebootPendingState>(EMPTY_REBOOT);

  // Load per-repeater reboot-pending on mount / contact change, and clear it if
  // the node has been heard since the reboot was sent (the only real evidence).
  useEffect(() => {
    const loaded = clearIfHeard(loadPendingReboot(contact.publicKeyHex), contact.lastSeenMs);
    setPendingState(loaded);
    savePendingReboot(contact.publicKeyHex, loaded);
  }, [contact.publicKeyHex, contact.lastSeenMs]);

  const setPending = useCallback(
    (next: RebootPendingState) => {
      setPendingState(next);
      savePendingReboot(contact.publicKeyHex, next);
    },
    [contact.publicKeyHex],
  );
```

Import `useCallback` from React (extend the existing `import { useEffect, useState }` on line 2). Set `sessionChecked` in the session effect's async body — after `setSession(res.session)` and in the `catch`, add `if (!cancelled) setSessionChecked(true);` (and reset it to `false` at the top of the effect when `client` becomes available).

- [ ] **Step 6: Render the tier-two chip + tab dot, and clear-on-enter**

In the header (after the RSSI chip, ~line 102), show the chip only once dismissed:

```tsx
        {pending.settings.length > 0 && pending.dismissed ? (
          <RebootHeaderChip
            count={pending.settings.length}
            onClick={() => {
              setTab('cli');
              setPending({ ...pending, dismissed: false });
            }}
          />
        ) : null}
```

In the tab nav map (the CLI tab button, ~line 133), append the dot inside the button when pending is dismissed:

```tsx
              {t.id === 'cli' && pending.settings.length > 0 && pending.dismissed ? <RebootTabDot /> : null}
```

Add an effect so entering the CLI tab clears `dismissed` (tier one re-appears):

```tsx
  useEffect(() => {
    if (tab === 'cli' && pending.dismissed && pending.settings.length > 0) {
      setPending({ ...pending, dismissed: false });
    }
  }, [tab, pending, setPending]);
```

Pending is **not** yet passed to `CliTab` — the old `CliTab` doesn't accept it. Task 9's rewrite adds the `pending` / `onPending` props and renders tier one. For now `pending` only stays empty in normal flow (nothing arms it until Task 9), so the tier-two UI is inert but compiles and is green.

- [ ] **Step 7: Verify the panel still builds and its tests pass**

Run: `npx tsc --noEmit && npx vitest run --project dom tests/component/repeater-admin-contact-switch.test.tsx tests/component/cli-reboot-pending.test.tsx && npx biome check src/renderer/panels/repeater-admin`
Expected: typecheck clean; both component tests pass; lint clean. (`repeater-admin-contact-switch.test.tsx` exercises the remount and must stay green.)

- [ ] **Step 8: Commit**

```bash
git add src/renderer/panels/repeater-admin/cli/RebootPending.tsx src/renderer/panels/repeater-admin/index.tsx tests/component/cli-reboot-pending.test.tsx
git commit -m "feat(cli): reboot-pending as persisted unsaved-changes state

A reboot-required set that reaches ok/sent leaves config written but not
live. The tier-one strip (in CliTab, Task 9) lets you verify each setting or
reboot now; once dismissed it demotes to a header chip + CLI-tab warn dot in
index.tsx, above the remount boundary, so a repeater switch does not strand
it. State is keyed by publicKeyHex and clears only when the node is heard
after the reboot was sent; an undefined lastSeenMs keeps the rebooting form
with a manual dismiss so it is never unclearable.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: `CliTab.tsx` thin rewrite + `index.tsx` wiring

**Files:**
- Modify: `src/renderer/panels/repeater-admin/CliTab.tsx` (full rewrite — thin composition)
- Modify: `src/renderer/panels/repeater-admin/index.tsx` (pass `session` / `sessionChecked` / `contact` / `pending` / `onPending` to `CliTab`)
- Create: `tests/component/cli-tab.test.tsx`

**Interfaces:**
- Consumes: everything from Tasks 2-8, plus phase-1 `queue.ts` (`enqueue`, `beginNext`, `settle`, `cancel`, `abortAll`, `CliQueueState`, `CliEntry`, `CliEntryState`); `persistence.ts` (`loadHistory`, `saveHistory`, `CliHistoryEntry`); `suggest.ts` (`CliSuggestCtx`); `parseCliLine` from `./lib/parse`; `CLI_BY_NAME`, `CliCommand` from catalog; `api.repeaterCli(c, key, command): Promise<{ ok: true; reply: string }>` from `@/lib/api` (today's two-arg transport — no `expectReply`/`signal`); `RepeaterAdminSession`, `Contact`, `RadioSettings` from `src/shared/types`; `useStore` (`radioSettings`, `setRepeaterAdminTab`).
- Consumes: `RebootPendingState`, `armReboot`, `markRebootSent`, `RebootStrip` (Task 8).
- Produces:
  ```ts
  interface CliTabProps {
    contact: Contact;
    client: ApiClient | null;
    session: RepeaterAdminSession | null;
    sessionChecked: boolean;
    pending: RebootPendingState;
    onPending: (next: RebootPendingState) => void;
  }
  export function CliTab(props: CliTabProps): JSX.Element
  ```

- [ ] **Step 1: Write the failing composed test**

Create `tests/component/cli-tab.test.tsx`. Mocks `@/lib/api` and seeds `radioSettings` in the store.

```tsx
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Contact } from '../../src/shared/types';
import { DEFAULT_RADIO_SETTINGS } from '../../src/shared/types';
import { useStore } from '@/lib/store';
import { CliTab } from '@/panels/repeater-admin/CliTab';
import { EMPTY_REBOOT } from '@/panels/repeater-admin/cli/RebootPending';

const repeaterCli = vi.fn();
vi.mock('@/lib/api', () => ({
  api: { repeaterCli: (...a: unknown[]) => repeaterCli(...a) },
}));

const contact: Contact = { key: 'c:abc', publicKeyHex: 'abc123', name: 'Repeater A', kind: 'repeater' } as Contact;

function renderTab(over: Partial<React.ComponentProps<typeof CliTab>> = {}) {
  return render(
    <CliTab contact={contact} client={{} as never} session={{ role: 'admin', mode: 'x' } as never} sessionChecked pending={EMPTY_REBOOT} onPending={() => {}} {...over} />,
  );
}

beforeEach(() => {
  repeaterCli.mockReset();
  useStore.setState({ radioSettings: DEFAULT_RADIO_SETTINGS });
  localStorage.clear();
});

const input = () => screen.getByRole('textbox') as HTMLInputElement;

describe('CliTab', () => {
  it('sends a command and shows the reply', async () => {
    repeaterCli.mockResolvedValue({ ok: true, reply: '869.525,250,11,5' });
    renderTab();
    fireEvent.change(input(), { target: { value: 'get radio' } });
    fireEvent.keyDown(input(), { key: 'Enter' });
    await waitFor(() => expect(repeaterCli).toHaveBeenCalledWith(expect.anything(), 'c:abc', 'get radio'));
    expect(await screen.findByText('869.525,250,11,5')).toBeTruthy();
  });

  it('blocks the send and shows the banner when not an admin session', () => {
    renderTab({ session: null, sessionChecked: true });
    expect(screen.getByText(/only answers CLI from an admin session/)).toBeTruthy();
    fireEvent.change(input(), { target: { value: 'get radio' } });
    fireEvent.keyDown(input(), { key: 'Enter' });
    expect(repeaterCli).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run --project dom tests/component/cli-tab.test.tsx`
Expected: FAIL — the current `CliTab` has no admin banner and takes no `session` prop (typecheck/prop error).

- [ ] **Step 3: Rewrite `CliTab.tsx`**

The AbortController is not in queue state (§2.5); phase 2's two-arg transport has no `signal`, so an in-flight fetch is simply orphaned on remount and `abortAll` runs on unmount to keep the FIFO from wedging.

```tsx
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Contact, RepeaterAdminSession } from '../../../shared/types';
import { CLI_BY_NAME, type CliCommand } from '../../../shared/repeater-cli/catalog';
import { type ApiClient, api } from '../../lib/api';
import { useStore } from '../../lib/store';
import { parseCliLine } from './cli/lib/parse';
import { abortAll, beginNext, cancel, type CliEntry, type CliQueueState, enqueue, settle } from './cli/lib/queue';
import { type CliHistoryEntry, loadHistory, saveHistory } from './cli/lib/persistence';
import { deriveRecent, extractNodeValue, type CliSuggestCtx } from './cli/lib/suggest';
import { CliPrompt, type CliGuest } from './cli/CliPrompt';
import { CliTranscript, type FollowUp } from './cli/CliTranscript';
import { armReboot, markRebootSent, type RebootPendingState, RebootStrip } from './cli/RebootPending';

interface Props {
  contact: Contact;
  client: ApiClient | null;
  session: RepeaterAdminSession | null;
  sessionChecked: boolean;
  pending: RebootPendingState;
  onPending: (next: RebootPendingState) => void;
}

const CLI_TIMEOUT_MS = 30_000;
let seq = 0;
const newId = () => `cli-${Date.now().toString(36)}-${(seq++).toString(36)}`;

// Phase 2 best-effort classification (phase 3 replaces this with server codes).
function classify(err: Error): CliEntry['error'] {
  const msg = err.message;
  if (/superseded by newer CLI command/i.test(msg)) return { kind: 'superseded', message: msg };
  if (/timeout|no reply|timed out/i.test(msg)) return { kind: 'timeout', message: msg };
  return { kind: 'transport', message: msg };
}

export function CliTab({ contact, client, session, sessionChecked, pending, onPending }: Props) {
  const radioSettings = useStore((s) => s.radioSettings);
  const setRepeaterAdminTab = useStore((s) => s.setRepeaterAdminTab);
  const hops = Math.max(1, contact.hops ?? 1);

  const [queue, setQueue] = useState<CliQueueState>({ entries: [] });
  const [history, setHistory] = useState<CliHistoryEntry[]>(() => loadHistory(contact.publicKeyHex));
  const [nodeValues, setNodeValues] = useState<Record<string, string>>({});
  const [lineToSet, setLineToSet] = useState<{ text: string; nonce: number } | null>(null);
  const sendingRef = useRef(false);

  const guest: CliGuest = !sessionChecked ? 'checking' : session?.role === 'admin' ? 'admin' : 'guest';
  const ctx: CliSuggestCtx = useMemo(() => ({ recent: deriveRecent(history), nodeValues }), [history, nodeValues]);
  const queuedCount = queue.entries.filter((e) => e.state === 'queued').length;

  const persistHistory = useCallback(
    (next: CliHistoryEntry[]) => {
      setHistory(next);
      saveHistory(contact.publicKeyHex, next);
    },
    [contact.publicKeyHex],
  );

  const patchStatus = useCallback(
    (text: string, status: CliHistoryEntry['status']) => {
      setHistory((h) => {
        const idx = [...h].reverse().findIndex((e) => e.text === text);
        if (idx === -1) return h;
        const at = h.length - 1 - idx;
        const next = h.map((e, i) => (i === at ? { ...e, status } : e));
        saveHistory(contact.publicKeyHex, next);
        return next;
      });
    },
    [contact.publicKeyHex],
  );

  const submit = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (trimmed === '') return;
      const cmd = CLI_BY_NAME[trimmed] ?? (parseCliLine(trimmed, trimmed.length).mode === 'arg' ? (parseCliLine(trimmed, trimmed.length) as { cmd: CliCommand }).cmd : null);
      // History is pushed on submit (so ↑ recalls immediately); status patched at settle.
      setHistory((h) => {
        if (h[h.length - 1]?.text === trimmed) return h; // collapse consecutive dupes
        const next = [...h, { text: trimmed, status: 'sent' as const }].slice(-200);
        saveHistory(contact.publicKeyHex, next);
        return next;
      });
      const entry: CliEntry = {
        id: newId(), text: trimmed, cmd, state: 'queued',
        queuedAt: Date.now(), startedAt: null, endedAt: null, reply: null, error: null,
      };
      setQueue((q) => enqueue(q, entry));
    },
    [contact.publicKeyHex],
  );

  // Drain: start the next entry whenever nothing is sending.
  useEffect(() => {
    if (sendingRef.current || !client) return;
    const { state, next } = beginNext(queue);
    if (!next) return;
    sendingRef.current = true;
    setQueue(state);
    void (async () => {
      try {
        const res = await api.repeaterCli(client, contact.key, next.text);
        const refused = /^err/i.test(res.reply.trim());
        setQueue((q) => settle(q, next.id, {
          state: refused ? 'error' : 'ok',
          reply: res.reply,
          endedAt: Date.now(),
          error: refused ? { kind: 'refused', message: res.reply } : null,
        }));
        patchStatus(next.text, refused ? 'error' : 'ok');
        if (!refused && next.cmd?.key && next.cmd.name.startsWith('get ')) {
          const v = extractNodeValue(next.cmd, res.reply);
          if (v != null) setNodeValues((nv) => ({ ...nv, [next.cmd?.key as string]: v }));
        }
        // Reboot-pending: arm on a reboot-required set reaching ok; mark sent
        // when the reboot command itself settles. NOTE §6 also arms on `sent`,
        // but the `sent` terminal (reboot+noReply commands) only exists once
        // phase 3's drain lands (phase-3 Task 5); wire arm-on-`sent` there so a
        // reboot+noReply command is not silently lost.
        if (!refused && next.cmd?.reboot && next.cmd.name.startsWith('set ')) onPending(armReboot(pending, next.cmd));
        if (!refused && (next.text === 'reboot' || next.text === 'clkreboot')) onPending(markRebootSent(pending, Date.now()));
      } catch (err) {
        const error = classify(err as Error);
        setQueue((q) => settle(q, next.id, { state: error?.kind === 'timeout' ? 'timeout' : 'error', endedAt: Date.now(), error }));
        patchStatus(next.text, error?.kind === 'timeout' ? 'timeout' : 'error');
      } finally {
        sendingRef.current = false;
      }
    })();
  }, [queue, client, contact.key, patchStatus, onPending, pending]);

  // Abort the queue on unmount / repeater switch: move every non-terminal entry
  // (including a sending one) to cancelled so beginNext can never wedge. The
  // in-flight fetch itself is orphaned — no signal on today's transport (§2.5).
  useEffect(() => () => setQueue((q) => abortAll(q)), []);

  const onClear = useCallback(() => setQueue({ entries: [] }), []);
  const onCancel = useCallback((id: string) => setQueue((q) => cancel(q, id)), []);
  const onRetry = useCallback((entry: CliEntry) => submit(entry.text), [submit]);
  const onEdit = useCallback((text: string) => setLineToSet({ text, nonce: Date.now() }), []);

  const followUpsFor = useCallback(
    (entry: CliEntry): FollowUp[] => {
      const out: FollowUp[] = [];
      const cmd = entry.cmd;
      if (entry.state === 'ok' && cmd?.key && cmd.name.startsWith('get ')) {
        const setName = Object.values(CLI_BY_NAME).find((c) => c.key === cmd.key && c.name.startsWith('set '))?.name;
        const value = nodeValues[cmd.key];
        if (setName && value) out.push({ label: 'Change this value', text: `${setName} ${value}` });
      }
      if (entry.state === 'ok' && cmd?.reboot && cmd.name.startsWith('set ')) out.push({ label: 'Apply with', text: 'reboot' });
      return out;
    },
    [nodeValues],
  );

  return (
    <div className="flex h-full flex-col">
      <RebootStrip
        pending={pending}
        onRunVerify={(verify) => submit(verify)}
        onRebootNow={() => submit('reboot')}
        onDismiss={() => onPending({ ...pending, dismissed: true })}
      />
      <CliTranscript entries={queue.entries} timeoutMs={CLI_TIMEOUT_MS} followUpsFor={followUpsFor} onRetry={onRetry} onEdit={onEdit} onCancel={onCancel} />
      <CliPrompt
        history={history}
        ctx={ctx}
        radioSettings={radioSettings}
        hops={hops}
        guest={guest}
        queuedCount={queuedCount}
        onSubmit={submit}
        onClearTranscript={onClear}
        onLoginAsAdmin={() => setRepeaterAdminTab('login')}
        lineToSet={lineToSet}
      />
    </div>
  );
}
```

- [ ] **Step 4: Wire `CliTab` in `index.tsx`**

At the CLI tab render (~line 151), pass the new props. `session`, `sessionChecked`, `pending`, and `setPending` all already exist above the boundary from Task 8:

```tsx
        {tab === 'cli' && (
          <CliTab
            contact={contact}
            client={client}
            session={session}
            sessionChecked={sessionChecked}
            pending={pending}
            onPending={setPending}
          />
        )}
```

- [ ] **Step 5: Run the composed test — verify it passes**

Run: `npx vitest run --project dom tests/component/cli-tab.test.tsx`
Expected: PASS, 2 tests. (The successful send resolves the mocked `repeaterCli` and the reply renders; the guest case shows the banner and never calls `repeaterCli`.)

- [ ] **Step 6: Full suite + typecheck + lint**

Run: `npx tsc --noEmit && npx biome check src tests && npx vitest run --project unit && npx vitest run --project dom`
Expected: all green. `repeater-admin-contact-switch.test.tsx` still passes (the remount still drops transcript state; history/reboot persist).

- [ ] **Step 7: Commit**

```bash
git add src/renderer/panels/repeater-admin/CliTab.tsx src/renderer/panels/repeater-admin/index.tsx tests/component/cli-tab.test.tsx
git commit -m "feat(cli): thin CliTab composing the console over today's transport

CliTab now composes CliPrompt/CliPalette/CliTranscript/RebootPending over
the phase-1 reducer, FIFO queue and persistence, draining one command at a
time against today's two-arg repeaterCli. Refused (Err-) replies, timeouts
and transport failures are classified best-effort (phase 3 swaps in server
codes); get-replies feed nodeValues and follow-ups; reboot-required sets arm
reboot-pending. Cancel of queued entries works; the in-flight fetch is
orphaned on the deliberate remount, with abortAll unwedging the queue.
index.tsx now hands CliTab the session, sessionChecked and lifted pending
state, and the old text-cs-error is gone with the rewrite.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Notes for the implementer

- **The spec is the authority.** Where this plan and `docs/superpowers/specs/2026-07-28-repeater-cli-autocomplete-design.md` disagree, the spec wins — and tell the reviewer, because it means the plan has a bug.
- **Line numbers drift.** Every `file.ts:NNN` here was accurate at the branch tip when written. Locate by symbol name, not by line.
- **Phase-1 action shape is a contract, not a discovery.** Task 4 declares the `CliPromptAction` union it dispatches (`value/change`, `caret/set`, the granular `key/*` actions, `item/apply`, `line/set`, `rsearch/setQuery`, `history/loaded`, `history/push`, `history/patchStatus`, `ctx/setRecent`, `ctx/setNodeValue`, `confirm/cancel`). If phase 1's `promptReducer.ts` names an action or field differently, adapt the *dispatch calls in CliPrompt*, never the reducer — the reducer is the tested source of the key map.
- **Two components land as placeholders in Task 4** (`CliReverseSearch`, `CliConfirmBar`) so `CliPrompt` compiles; Tasks 5 and 6 replace their bodies. Do not skip re-running Task 4's tests after those tasks — they exercise the real bars through the prompt only indirectly, but the imports must stay stable.
- **No transport changes here.** `expectReply`, `signal`, `routes.ts` error codes, and `sessionAdapter.ts` are phase 3. Phase 2's classification of timeout/transport is deliberately string-matched and will be replaced by `code: 'cli_timeout'` / `'transport'` from the route.
- **Never assert on `scrollIntoView`** (setup.ts stubs it) — assert `aria-activedescendant`, as `cli-palette.test.tsx` does.
