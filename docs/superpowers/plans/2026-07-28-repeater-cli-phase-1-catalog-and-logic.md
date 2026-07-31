# Repeater CLI — Phase 1: Catalog & Pure Logic Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the data-and-logic foundation for the repeater CLI console — a firmware-reconciled command catalog in `src/shared/repeater-cli/catalog.ts`, and seven pure modules (`parse`, `match`, `suggest`, `airtime`, `queue`, `promptReducer`, `persistence`) under `src/renderer/panels/repeater-admin/cli/lib/` — each exhaustively unit-tested with no DOM and no transport. Phase 2 (UI) and Phase 3 (queue wiring + no-reply transport) build on top; nothing here imports React or the network.

**Architecture:** The catalog is pure data + types, mirroring `src/shared/macros/manifest.ts`. Every keyboard and ranking decision lives in a pure function so the bug-prone surface (the prompt state machine, the ranking, the queue transitions) is testable at the boundaries without a jsdom mount. `parse` turns a line+caret into a discriminated `command` / `arg` union; `match` scores a command; `suggest` ranks the whole catalog and produces splice-ready suggestions; `airtime` wraps the shipped `loraAirtimeMs`; `queue` is a serialisable FIFO with a one-outstanding invariant; `persistence` is a per-pubkey ring over an injectable `Storage`; `promptReducer` is a pure reducer returning `{ state, effect? }` that calls `suggest` itself.

**Tech Stack:** Electron + React 19 + TypeScript, Tailwind v4 (`cs-*` tokens), zustand, Radix, Vitest (three projects: `unit` / `integration` / `dom`), Biome. Phase 1 touches only the `unit` project (`environment: 'node'`, no `setupFiles`).

**Spec:** `docs/superpowers/specs/2026-07-28-repeater-cli-autocomplete-design.md`. Read it before starting — every section number referenced below (§1–§3, §6, §11) points there. It is the source of truth; where this plan and the spec disagree, the spec wins and you should flag it, because it means the plan has a bug.

## Global Constraints

- **Worktree:** `/Users/andy/GitHub/andyshinn/coresense/.claude/worktrees/cli-autocomplete`, branch `worktree-cli-autocomplete`. Run every command from there.
- **Run tooling via `npx`, not `pnpm <script>`** — `pnpm` scripts reflink-fail in worktrees. Use `npx vitest run --project unit`, `npx tsc --noEmit`, `npx biome check src tests`.
- **Lint scope is `src tests`** — bare `npx biome check` fails on pre-existing `build/`, `dist/`, `out/` artifacts that are not ours.
- **Never use bare `git stash` / `git stash pop`** — the stash stack is shared across worktrees and sessions.
- **`@testing-library/jest-dom` is NOT installed** — assert with `toBeTruthy()` / `toBeNull()` / attribute and `className` reads, never `toBeInTheDocument()`. (No component tests in Phase 1, but the rule stands for any future edit.)
- **A `.tsx` under `tests/unit/` never runs** — the vitest project split is by extension: `unit` = `tests/unit/**/*.test.ts` (node env), `dom` = `tests/component/**/*.test.tsx`, `integration` = `tests/integration/**/*.test.ts`. Every Phase 1 test is a `.ts` file under `tests/unit/`.
- **Commit after every task** with conventional-commit prefixes (`feat:` / `fix:` / `refactor:` / `test:` / `style:` / `docs:`).
- **End every commit message with the trailer:** `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`.
- **Line numbers drift.** Every `file:NNN` here was accurate at the head of `worktree-cli-autocomplete` (`2d7c9d8`). Locate firmware handlers by symbol/guard, not by line, and update the reconciliation note if a cited line moved.
- **The firmware is the catalog authority.** `docs/firmware/CommonCLI.cpp` (the shared dispatcher) and `docs/firmware/MyMeshRepeater.cpp` (three repeater-local handlers) are vendored and pinned. `.design-ref/cli-autocomplete/cli-data.js` is the *port source*, distilled from docs, and is wrong in several places — reconcile against firmware, never trust the mockup where they conflict.
- **The `serialOnly` mechanical test (§1.2):** a handler guarded by `sender_timestamp == 0` is serial-console-only, because a mesh sender's timestamp is its RTC clock and the one zero case is caught earlier as a retry. Every `serialOnly` entry must point at such a guard; `erase` at `CommonCLI.cpp:302` is the worked example.

---

## File Structure

**Create**

| File | Responsibility |
|---|---|
| `src/shared/repeater-cli/catalog.ts` | Command catalog + all types. Pure data; no React, no renderer imports. |
| `src/renderer/panels/repeater-admin/cli/lib/parse.ts` | Line + caret → `command` / `arg` parse; longest-name resolution. |
| `src/renderer/panels/repeater-admin/cli/lib/match.ts` | `matchCommand` scoring + `commonPrefix`. |
| `src/renderer/panels/repeater-admin/cli/lib/suggest.ts` | Ranked suggestions, apply/splice, node-value extraction, recent derivation. |
| `src/renderer/panels/repeater-admin/cli/lib/airtime.ts` | `cliRoundTrip` wrapping `loraAirtimeMs`. |
| `src/renderer/panels/repeater-admin/cli/lib/queue.ts` | `CliEntry` + FIFO transitions. |
| `src/renderer/panels/repeater-admin/cli/lib/persistence.ts` | History ring + reboot-pending over an injectable `Storage`. |
| `src/renderer/panels/repeater-admin/cli/lib/promptReducer.ts` | Keyboard state machine returning `{ state, effect? }`. |
| `tests/unit/shared/repeater-cli/catalog.test.ts` | Structural invariants + serialOnly/noReply by name. |
| `tests/unit/renderer/panels/repeater-admin/cli/parse.test.ts` | Parse modes, longest-match, caret, trailing space, empty. |
| `tests/unit/renderer/panels/repeater-admin/cli/match.test.ts` | Six scoring rows, tie-break, stability, merged ranges, commonPrefix. |
| `tests/unit/renderer/panels/repeater-admin/cli/suggest.test.ts` | Ranking, arg order, extraction, recent, apply. |
| `tests/unit/renderer/panels/repeater-admin/cli/airtime.test.ts` | Overhead, hops floor, noReply, absent radio, label boundary. |
| `tests/unit/renderer/panels/repeater-admin/cli/queue.test.ts` | FIFO, one-at-a-time, cancel, abortAll, history exclusion. |
| `tests/unit/renderer/panels/repeater-admin/cli/persistence.test.ts` | Ring, cap, dup-collapse, injected + throwing storage. |
| `tests/unit/renderer/panels/repeater-admin/cli/promptReducer.test.ts` | Every §3.1 key row + every §3 non-key action + reverse-search. |

**Import path conventions** (verify once, reuse everywhere):
- Renderer modules under test import via the `@` alias (`@` → `src/renderer`, aliased in every vitest project). Example from a test: `import { parseCliLine } from '@/panels/repeater-admin/cli/lib/parse';`.
- The catalog lives in `src/shared`, outside `@`. From a `cli/lib/*.ts` module it is `'../../../../../shared/repeater-cli/catalog'` (five `../` up from `lib/` to `src/`). From a test under `tests/unit/renderer/panels/repeater-admin/cli/` it is `'../../../../../../src/shared/repeater-cli/catalog'` (six `../`).
- The catalog test imports the catalog relatively: from `tests/unit/shared/repeater-cli/` it is `'../../../../src/shared/repeater-cli/catalog'` (four `../`).
- `cli/lib/airtime.ts` imports `loraAirtimeMs` from `'../../../../lib/airtime'` (four `../` to `renderer/`) and `RadioSettings` from `'../../../../../shared/types'` (five `../`).

---

### Task 1: Catalog scaffold — types, group order, by-name index, structural test

**Files:**
- Create: `src/shared/repeater-cli/catalog.ts`
- Create: `tests/unit/shared/repeater-cli/catalog.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces (verbatim from §1):
  ```ts
  type CliGroup = 'Operational'|'Neighbors'|'Statistics'|'Logging'|'Info'|'Radio'|'System'|'Routing'|'ACL'|'Region'|'GPS';
  interface CliArg { name: string; hint?: string; enum?: string[]; enumDesc?: Record<string,string>; range?: [number,number] }
  interface CliPreset { value: string; label: string; note?: string }
  interface CliCommand { name; group; desc; spec?; args?; presets?; key?; replyValue?; def?; serialOnly?; noReply?; reboot?; danger?; fw?; deprecated?; experimental?; note? }
  const CLI_COMMANDS: readonly CliCommand[];        // empty in this task
  const CLI_GROUP_ORDER: readonly CliGroup[];
  const CLI_BY_NAME: Readonly<Record<string, CliCommand>>;
  const GET_VALUE: RegExp;                           // shared replyValue for `get` commands
  const onOff: CliArg[];                             // shared [{ name:'state', enum:['on','off'] }]
  ```

- [ ] **Step 1: Write the structural invariant test**

Create `tests/unit/shared/repeater-cli/catalog.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { CLI_BY_NAME, CLI_COMMANDS, CLI_GROUP_ORDER } from '../../../../src/shared/repeater-cli/catalog';
import type { CliGroup } from '../../../../src/shared/repeater-cli/catalog';

const EXPECTED_GROUPS: CliGroup[] = [
  'Operational', 'Neighbors', 'Statistics', 'Logging', 'Info',
  'Radio', 'System', 'Routing', 'ACL', 'Region', 'GPS',
];

describe('CLI catalog invariants', () => {
  it('lists every CliGroup in CLI_GROUP_ORDER exactly once', () => {
    expect([...CLI_GROUP_ORDER]).toEqual(EXPECTED_GROUPS);
  });

  it('has unique command names', () => {
    const names = CLI_COMMANDS.map((c) => c.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('places every command in a known group', () => {
    for (const c of CLI_COMMANDS) {
      expect(EXPECTED_GROUPS).toContain(c.group);
    }
  });

  it('exposes every command through CLI_BY_NAME', () => {
    expect(Object.keys(CLI_BY_NAME).length).toBe(CLI_COMMANDS.length);
    for (const c of CLI_COMMANDS) {
      expect(CLI_BY_NAME[c.name]).toBe(c);
    }
  });

  it('every enumDesc key is a member of that arg enum', () => {
    for (const c of CLI_COMMANDS) {
      for (const arg of c.args ?? []) {
        if (!arg.enumDesc) continue;
        for (const k of Object.keys(arg.enumDesc)) {
          expect(arg.enum ?? []).toContain(k);
        }
      }
    }
  });

  it('a get/set pair shares a key (serial-only pairs are exempt)', () => {
    // prv.key is the exempt case: `get prv.key` is serial-gated, so prefilling
    // `set prv.key` with the current private key is neither possible nor wanted.
    for (const set of CLI_COMMANDS) {
      if (!set.name.startsWith('set ')) continue;
      const get = CLI_BY_NAME[`get ${set.name.slice(4)}`];
      if (!get) continue;
      if (set.serialOnly || get.serialOnly) continue;
      expect(get.key, `${get.name} needs a key`).toBeTruthy();
      expect(set.key).toBe(get.key);
    }
  });
});
```

- [ ] **Step 2: Run the test — expect failure**

Run: `npx vitest run --project unit tests/unit/shared/repeater-cli/catalog.test.ts`
Expected: FAIL — `Cannot find module '../../../../src/shared/repeater-cli/catalog'`.

- [ ] **Step 3: Create `src/shared/repeater-cli/catalog.ts`**

```ts
// MeshCore repeater CLI catalog — pure data + types, no React, no renderer
// imports. Mirrors src/shared/macros/manifest.ts.
//
// Each entry carries the metadata that matters over LoRa: group, description,
// argument shapes, enums with per-value descriptions, presets, get/set pairing
// (`key`), firmware floor (annotation only), and the serial-only / no-reply /
// reboot-required / destructive flags that decide whether a user waits 30
// seconds for silence.
//
// AUTHORITY: docs/firmware/CommonCLI.cpp (shared dispatcher) and
// docs/firmware/MyMeshRepeater.cpp (three repeater-local handlers). The mockup
// at .design-ref/cli-autocomplete/cli-data.js is the port source, distilled
// from docs and wrong in places; every entry is reconciled against firmware.
// Dropped from the mockup: `admin` (firmware gates ALL mesh CLI on admin — a
// tab condition, §0), `rx` (replies are always one packet), `alias` (unused).

export type CliGroup =
  | 'Operational' | 'Neighbors' | 'Statistics' | 'Logging' | 'Info'
  | 'Radio' | 'System' | 'Routing' | 'ACL' | 'Region' | 'GPS';

export interface CliArg {
  name: string;
  hint?: string;                    // '5–12', 'MHz', 'companion public key'
  enum?: string[];
  enumDesc?: Record<string, string>;
  range?: [number, number];         // rendered in the detail pane; NOT validated
}

export interface CliPreset {
  value: string;
  label: string;
  note?: string;
}

export interface CliCommand {
  name: string;                     // 'set radio' — longest match wins over 'set'
  group: CliGroup;
  desc: string;
  spec?: string;                    // '<freq>,<bw>,<sf>,<cr>' — ghost + detail hint
  args?: CliArg[];
  presets?: CliPreset[];
  key?: string;                     // pairs get/set, drives "on node now"
  replyValue?: RegExp;              // extracts the bare value from a get reply (§2.3)
  def?: string;
  serialOnly?: true;
  noReply?: true;
  reboot?: true;
  danger?: true;
  fw?: string;                      // annotation only, never gates
  deprecated?: string;
  experimental?: true;
  note?: string;
}

/** Firmware `get` replies are uniformly prefixed with "> " (CommonCLI.cpp
 *  handleGetCmd). Capture group 1 is the bare value. */
export const GET_VALUE = /^>\s*([\s\S]+?)\s*$/;

/** Shared on/off argument. The mockup put the get/set `key` on the arg; our
 *  CliArg has no key field — the command carries `key`, the arg carries enum. */
export const onOff: CliArg[] = [{ name: 'state', enum: ['on', 'off'] }];

export const CLI_GROUP_ORDER: readonly CliGroup[] = [
  'Operational', 'Neighbors', 'Statistics', 'Logging', 'Info',
  'Radio', 'System', 'Routing', 'ACL', 'Region', 'GPS',
];

// Populated group-by-group across Tasks 2–5. Empty until then.
export const CLI_COMMANDS: readonly CliCommand[] = [];

export const CLI_BY_NAME: Readonly<Record<string, CliCommand>> = Object.freeze(
  Object.fromEntries(CLI_COMMANDS.map((c) => [c.name, c])),
);
```

- [ ] **Step 4: Run the test — expect pass**

Run: `npx vitest run --project unit tests/unit/shared/repeater-cli/catalog.test.ts`
Expected: PASS, 6 tests (all vacuous/near-vacuous over the empty array except the group-order row).

- [ ] **Step 5: Typecheck and lint**

Run: `npx tsc --noEmit && npx biome check src/shared/repeater-cli tests/unit/shared`
Expected: both clean.

- [ ] **Step 6: Commit**

```bash
git add src/shared/repeater-cli/catalog.ts tests/unit/shared/repeater-cli/catalog.test.ts
git commit -m "feat(cli): catalog types, group order, and structural invariant test

Pure data + types mirroring src/shared/macros/manifest.ts. CLI_COMMANDS is
empty; Tasks 2-5 fill it group-by-group, reconciled against the vendored
CommonCLI.cpp / MyMeshRepeater.cpp. The test pins the invariants that a
per-group reconciliation must never break: unique names, enumDesc keys as a
subset of the enum, every group in CLI_GROUP_ORDER, and get/set key pairing
(serial-only pairs exempt).

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Catalog — Operational, Neighbors, Statistics, Logging, Info

**Files:**
- Modify: `src/shared/repeater-cli/catalog.ts` (add five group consts; extend `CLI_COMMANDS` at the `= []` line)
- Modify: `tests/unit/shared/repeater-cli/catalog.test.ts` (add serialOnly/noReply by-name assertions)

**Interfaces:**
- Consumes: `CliCommand`, `GET_VALUE` (Task 1).
- Produces: `OPERATIONAL`, `NEIGHBORS`, `STATISTICS`, `LOGGING`, `INFO` command arrays folded into `CLI_COMMANDS`.

**Reconciliation notes for this group** (firmware-verified; encode in the entry `note`s and this commit body):
- `poweroff`/`reboot`/`clkreboot` call board functions that never return, so no `reply` is written — `noReply: true` (`CommonCLI.cpp:216,218,220`). `shutdown` is a firmware alias of `poweroff`; the mockup's `alias` field is dropped.
- `erase` is `serialOnly` (guarded `sender_timestamp == 0`, `CommonCLI.cpp:302`) — **but not `noReply`**: on its only reachable path (serial) it *does* write `"File system erase: OK"`. The mockup's `noReply` on `erase` is wrong. Over the air it falls through to `"Unknown command"`.
- `log` (`:467`), `stats-packets` (`:470`), `stats-radio` (`:472`), `stats-core` (`:474`) are all `serialOnly`.
- **Omitted (out of repeater-config scope, firmware-present):** `sensor get`/`sensor set`/`sensor list` (`:309–352`, companion-sensor custom vars), and the `get bridge.type`/`get bootloader.ver`/`get pwrmgt.*` diagnostics (`:856–928`, bridge and NRF52 power-management). These are not repeater configuration; note the decision, do not add them.

- [ ] **Step 1: Extend the test with by-name serialOnly / noReply assertions**

Append inside the `describe('CLI catalog invariants', …)` block in `tests/unit/shared/repeater-cli/catalog.test.ts`:

```ts
  it('marks the Operational/Statistics/Logging serial-only commands by name', () => {
    for (const name of ['erase', 'log', 'stats-packets', 'stats-radio', 'stats-core']) {
      expect(CLI_BY_NAME[name]?.serialOnly, `${name} should be serialOnly`).toBe(true);
    }
  });

  it('marks the no-reply reboot/power commands by name', () => {
    for (const name of ['reboot', 'poweroff', 'clkreboot']) {
      expect(CLI_BY_NAME[name]?.noReply, `${name} should be noReply`).toBe(true);
    }
    // erase writes a serial reply, so it is serial-only but NOT noReply.
    expect(CLI_BY_NAME.erase?.noReply).toBeUndefined();
  });
```

- [ ] **Step 2: Run the test — expect failure**

Run: `npx vitest run --project unit tests/unit/shared/repeater-cli/catalog.test.ts`
Expected: FAIL — `CLI_BY_NAME.erase` is `undefined` (catalog still empty).

- [ ] **Step 3: Add the five group arrays and fold them into `CLI_COMMANDS`**

In `catalog.ts`, insert these consts immediately above `export const CLI_COMMANDS`:

```ts
const OPERATIONAL: CliCommand[] = [
  { name: 'reboot', group: 'Operational', desc: 'Restart the node', noReply: true },
  { name: 'poweroff', group: 'Operational', desc: 'Power the node down', noReply: true, danger: true,
    note: 'The node goes dark and cannot be woken over the air — someone must power-cycle it in person. `shutdown` is a firmware alias (CommonCLI.cpp:216).' },
  { name: 'clkreboot', group: 'Operational', desc: 'Reset the clock and reboot', noReply: true },
  { name: 'clock', group: 'Operational', desc: 'Display current time in UTC' },
  { name: 'clock sync', group: 'Operational', desc: 'Sync the clock with this device' },
  { name: 'time', group: 'Operational', desc: 'Set the time to a specific timestamp',
    spec: '<epoch_seconds>', args: [{ name: 'epoch_seconds', hint: 'Unix epoch time' }] },
  { name: 'advert', group: 'Operational', desc: 'Send a flood advert' },
  { name: 'advert.zerohop', group: 'Operational', desc: 'Send a zero-hop advert' },
  { name: 'start ota', group: 'Operational', desc: 'Begin an over-the-air firmware update' },
  { name: 'erase', group: 'Operational', desc: 'Factory reset — wipes all settings and keys',
    serialOnly: true, danger: true,
    note: 'Wipes settings, ACL and node identity. Serial console only — guarded by sender_timestamp == 0 (CommonCLI.cpp:302); over the air it returns "Unknown command".' },
];

const NEIGHBORS: CliCommand[] = [
  { name: 'neighbors', group: 'Neighbors', desc: 'List nearby neighbors',
    note: 'Limited to the 8 most recent adverts; each line is {pubkey-prefix}:{timestamp}:{snr*4}. The reply is one ≤160-byte packet and overflows/truncates (§0).' },
  { name: 'neighbor.remove', group: 'Neighbors', desc: 'Remove a neighbor from the list', danger: true,
    spec: '<pubkey_prefix>', args: [{ name: 'pubkey_prefix', hint: 'short prefix or full key' }],
    note: 'A single space as the prefix removes every neighbor.' },
  { name: 'discover.neighbors', group: 'Neighbors', desc: 'Probe for zero-hop neighbors' },
];

const STATISTICS: CliCommand[] = [
  { name: 'clear stats', group: 'Statistics', desc: 'Reset all counters' },
  { name: 'stats-core', group: 'Statistics', desc: 'Battery, uptime, queue length, debug flags',
    serialOnly: true, note: 'Serial only — guarded by sender_timestamp == 0 (CommonCLI.cpp:474).' },
  { name: 'stats-radio', group: 'Statistics', desc: 'Noise floor, last RSSI/SNR, airtime, rx errors',
    serialOnly: true, note: 'Serial only — guarded by sender_timestamp == 0 (CommonCLI.cpp:472).' },
  { name: 'stats-packets', group: 'Statistics', desc: 'Packet counters — received and sent',
    serialOnly: true, note: 'Serial only — guarded by sender_timestamp == 0 (CommonCLI.cpp:470).' },
];

const LOGGING: CliCommand[] = [
  { name: 'log start', group: 'Logging', desc: 'Begin capturing the rx log to node storage' },
  { name: 'log stop', group: 'Logging', desc: 'Stop capturing the rx log' },
  { name: 'log erase', group: 'Logging', desc: 'Erase the captured log', danger: true,
    note: 'Deletes the captured rx log from node storage. Download it first if you still need it.' },
  { name: 'log', group: 'Logging', desc: 'Print the captured log to serial',
    serialOnly: true, note: 'Serial only — guarded by sender_timestamp == 0 (CommonCLI.cpp:467).' },
];

const INFO: CliCommand[] = [
  { name: 'ver', group: 'Info', desc: 'Firmware version' },
  { name: 'board', group: 'Info', desc: 'Hardware name' },
  { name: 'get role', group: 'Info', desc: 'Configured role', key: 'role', replyValue: GET_VALUE },
  { name: 'get public.key', group: 'Info', desc: "This node's public key", key: 'public.key', replyValue: GET_VALUE },
];
```

Then replace the `CLI_COMMANDS` declaration line:

```ts
export const CLI_COMMANDS: readonly CliCommand[] = [
  ...OPERATIONAL, ...NEIGHBORS, ...STATISTICS, ...LOGGING, ...INFO,
];
```

- [ ] **Step 4: Run the test — expect pass**

Run: `npx vitest run --project unit tests/unit/shared/repeater-cli/catalog.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Typecheck and lint**

Run: `npx tsc --noEmit && npx biome check src/shared/repeater-cli tests/unit/shared`
Expected: both clean.

- [ ] **Step 6: Commit**

```bash
git add src/shared/repeater-cli/catalog.ts tests/unit/shared/repeater-cli/catalog.test.ts
git commit -m "feat(cli): catalog Operational/Neighbors/Statistics/Logging/Info groups

Ported from cli-data.js and reconciled against CommonCLI.cpp: reboot/
poweroff/clkreboot are noReply (board calls never return); erase/log/
stats-* are serialOnly by the sender_timestamp==0 test; erase loses the
mockup's bogus noReply (it writes a serial reply). sensor.* and the bridge/
pwrmgt get diagnostics are firmware-present but out of repeater-config scope
and intentionally omitted.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Catalog — Radio, System

**Files:**
- Modify: `src/shared/repeater-cli/catalog.ts` (add `RADIO`, `SYSTEM`; extend `CLI_COMMANDS`)
- Modify: `tests/unit/shared/repeater-cli/catalog.test.ts` (add Radio/System serialOnly assertions)

**Interfaces:**
- Consumes: `CliCommand`, `CliArg`, `GET_VALUE`, `onOff` (Task 1).
- Produces: `RADIO`, `SYSTEM` arrays folded into `CLI_COMMANDS`.

**Reconciliation notes:**
- `set freq` is `serialOnly` (guarded `sender_timestamp == 0`, `CommonCLI.cpp:696`) and `reboot`. `get freq` is over-the-air readable (not guarded), so the pair is exempt from the key rule but both carry `key: 'freq'`.
- `get prv.key` is `serialOnly` (guarded, `CommonCLI.cpp:791`) and `danger`; it has **no key** (prefilling `set prv.key` with the live private key is neither possible nor wanted). `set prv.key` is over-the-air reachable, `danger`, `reboot`.
- **Added, firmware-present but absent from the mockup:** `get`/`set int.thresh` (`:499` / `:777`), `get`/`set agc.reset.interval` (`:503` / `:779`; firmware rounds the value to a multiple of 4). Placed in Radio (interference threshold and AGC reset are PHY settings).
- `set tx` — the catalog `range` is advisory only; firmware clamps to `-9..30` (`loadPrefs`), while `1–22` is the practical/lawful band. Keep the `1–22` hint, note the firmware clamp.
- `set radio.rxgain` is board-conditional (SX126x/LR1110), not firmware-floor gated; keep the mockup's `fw: '1.14.1'` as annotation.

- [ ] **Step 1: Extend the test**

Append inside the `describe`:

```ts
  it('marks the Radio/System serial-only commands by name', () => {
    expect(CLI_BY_NAME['set freq']?.serialOnly).toBe(true);
    expect(CLI_BY_NAME['get prv.key']?.serialOnly).toBe(true);
  });

  it('reboot-required set commands are flagged by name', () => {
    for (const name of ['set radio', 'set freq', 'set prv.key']) {
      expect(CLI_BY_NAME[name]?.reboot, `${name} should be reboot`).toBe(true);
    }
  });
```

- [ ] **Step 2: Run the test — expect failure**

Run: `npx vitest run --project unit tests/unit/shared/repeater-cli/catalog.test.ts`
Expected: FAIL — `CLI_BY_NAME['set freq']` is `undefined`.

- [ ] **Step 3: Add the Radio and System arrays and extend `CLI_COMMANDS`**

Insert above `export const CLI_COMMANDS`:

```ts
const RADIO: CliCommand[] = [
  { name: 'get radio', group: 'Radio', desc: 'Radio parameters — freq, bw, sf, cr', key: 'radio', replyValue: GET_VALUE },
  { name: 'set radio', group: 'Radio', desc: 'Change radio parameters', reboot: true, key: 'radio',
    spec: '<freq>,<bw>,<sf>,<cr>', def: '869.525,250,11,5',
    args: [
      { name: 'freq', hint: 'MHz' },
      { name: 'bw', hint: 'kHz' },
      { name: 'sf', hint: '5–12', range: [5, 12] },
      { name: 'cr', hint: '5–8', range: [5, 8] },
    ],
    presets: [
      { value: '869.525,250,11,5', label: 'EU 868 default', note: 'firmware default' },
      { value: '910.525,250,11,5', label: 'US 915', note: 'US/ANZ common' },
      { value: '869.525,250,10,5', label: 'Faster SF10', note: '≈2× throughput, less range' },
    ] },
  { name: 'get tx', group: 'Radio', desc: 'Transmit power', key: 'tx', replyValue: GET_VALUE },
  { name: 'set tx', group: 'Radio', desc: 'Change transmit power', key: 'tx', spec: '<dbm>',
    args: [{ name: 'dbm', hint: '1–22', range: [1, 22] }],
    note: 'Controls the LoRa chip only; boards with a PA output more. Firmware clamps to -9..30 dBm. Too high may be unlawful in your region.',
    presets: [{ value: '22', label: '22 dBm', note: 'max' }, { value: '17', label: '17 dBm' }, { value: '14', label: '14 dBm', note: 'EU limit w/ antenna gain' }] },
  { name: 'tempradio', group: 'Radio', desc: 'Change radio parameters temporarily',
    spec: '<freq>,<bw>,<sf>,<cr>,<timeout_mins>',
    note: 'Not saved — clears on reboot. Your escape hatch if a `set radio` locks you out.',
    presets: [{ value: '869.525,250,10,5,10', label: 'SF10 for 10 min' }] },
  { name: 'get freq', group: 'Radio', desc: 'Operating frequency', key: 'freq', replyValue: GET_VALUE },
  { name: 'set freq', group: 'Radio', desc: 'Change the operating frequency', serialOnly: true, reboot: true, key: 'freq',
    spec: '<frequency>', note: 'Serial only — guarded by sender_timestamp == 0 (CommonCLI.cpp:696).' },
  { name: 'get radio.rxgain', group: 'Radio', desc: 'Rx boosted gain mode', key: 'radio.rxgain', replyValue: GET_VALUE, fw: '1.14.1' },
  { name: 'set radio.rxgain', group: 'Radio', desc: 'Toggle rx boosted gain', key: 'radio.rxgain', fw: '1.14.1', args: onOff },
  { name: 'get int.thresh', group: 'Radio', desc: 'Interference threshold', key: 'int.thresh', replyValue: GET_VALUE },
  { name: 'set int.thresh', group: 'Radio', desc: 'Change the interference threshold', key: 'int.thresh',
    spec: '<value>', args: [{ name: 'value', hint: 'threshold' }],
    note: 'Added in reconciliation — present in CommonCLI.cpp (set :499 / get :777), absent from the mockup.' },
  { name: 'get agc.reset.interval', group: 'Radio', desc: 'AGC reset interval', key: 'agc.reset.interval', replyValue: GET_VALUE },
  { name: 'set agc.reset.interval', group: 'Radio', desc: 'Change the AGC reset interval', key: 'agc.reset.interval',
    spec: '<seconds>', args: [{ name: 'seconds', hint: 'rounded to a multiple of 4' }],
    note: 'Firmware divides by 4 on store and rounds the echo (CommonCLI.cpp:503).' },
];

const SYSTEM: CliCommand[] = [
  { name: 'get name', group: 'System', desc: 'Node name', key: 'name', replyValue: GET_VALUE },
  { name: 'set name', group: 'System', desc: 'Rename this node', key: 'name', spec: '<name>',
    note: 'Max 24 bytes when a location is set, 32 otherwise. Emoji cost several bytes each.' },
  { name: 'get lat', group: 'System', desc: 'Latitude', key: 'lat', replyValue: GET_VALUE },
  { name: 'set lat', group: 'System', desc: 'Set latitude', key: 'lat', spec: '<degrees>' },
  { name: 'get lon', group: 'System', desc: 'Longitude', key: 'lon', replyValue: GET_VALUE },
  { name: 'set lon', group: 'System', desc: 'Set longitude', key: 'lon', spec: '<degrees>' },
  { name: 'get prv.key', group: 'System', desc: 'Private key', serialOnly: true, danger: true,
    note: 'Serial only — guarded by sender_timestamp == 0 (CommonCLI.cpp:791).' },
  { name: 'set prv.key', group: 'System', desc: "Replace this node's identity", danger: true, reboot: true,
    spec: '<private_key>', note: 'Replacing the identity orphans every contact that knows this repeater.' },
  { name: 'password', group: 'System', desc: 'Change the admin password', danger: true, spec: '<new_password>',
    note: 'The reply echoes the new password. Any node using it is added to the admin ACL.' },
  { name: 'get guest.password', group: 'System', desc: 'Guest password', key: 'guest.password', replyValue: GET_VALUE },
  { name: 'set guest.password', group: 'System', desc: 'Change the guest password', key: 'guest.password', spec: '<password>' },
  { name: 'get owner.info', group: 'System', desc: 'Owner info text', key: 'owner.info', replyValue: GET_VALUE, fw: '1.12' },
  { name: 'set owner.info', group: 'System', desc: 'Set owner info text', key: 'owner.info', spec: '<text>', fw: '1.12',
    note: '`|` characters become newlines.' },
  { name: 'get adc.multiplier', group: 'System', desc: 'Battery reading calibration', key: 'adc.multiplier', replyValue: GET_VALUE },
  { name: 'set adc.multiplier', group: 'System', desc: 'Fine-tune the battery reading', key: 'adc.multiplier',
    spec: '<value>', args: [{ name: 'value', hint: '0.0–10.0', range: [0, 10] }] },
  { name: 'powersaving', group: 'System', desc: 'Power saving flag', key: 'powersaving', args: onOff,
    note: 'Sleeps between transmissions. Repeater only.' },
];
```

Replace the `CLI_COMMANDS` array:

```ts
export const CLI_COMMANDS: readonly CliCommand[] = [
  ...OPERATIONAL, ...NEIGHBORS, ...STATISTICS, ...LOGGING, ...INFO,
  ...RADIO, ...SYSTEM,
];
```

- [ ] **Step 4: Run the test — expect pass**

Run: `npx vitest run --project unit tests/unit/shared/repeater-cli/catalog.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 5: Typecheck and lint**

Run: `npx tsc --noEmit && npx biome check src/shared/repeater-cli tests/unit/shared`
Expected: both clean.

- [ ] **Step 6: Commit**

```bash
git add src/shared/repeater-cli/catalog.ts tests/unit/shared/repeater-cli/catalog.test.ts
git commit -m "feat(cli): catalog Radio and System groups

set freq and get prv.key are serialOnly by the sender_timestamp==0 test;
get prv.key carries no key (its pair is serial-exempt). Adds the mockup-
missing int.thresh and agc.reset.interval get/set pairs, both firmware-
present in CommonCLI.cpp. set radio/set freq/set prv.key carry reboot.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Catalog — Routing

**Files:**
- Modify: `src/shared/repeater-cli/catalog.ts` (add `ROUTING`; extend `CLI_COMMANDS`)
- Modify: `tests/unit/shared/repeater-cli/catalog.test.ts` (add a Routing enum + key assertion)

**Interfaces:**
- Consumes: `CliCommand`, `GET_VALUE`, `onOff` (Task 1).
- Produces: `ROUTING` array folded into `CLI_COMMANDS`.

**Reconciliation notes:**
- Every `set X` in Routing writes `"OK"`/error — none serial, none noReply.
- Enums verified against firmware: `path.hash.mode` 0/1/2 (`mode < 3`, `:664`), `loop.detect` off/minimal/moderate/strict (`:674–681`), `multi.acks` 0/1 (`constrain 0,1`).
- **Added, firmware-present but absent from the mockup:** `get`/`set flood.max.unscoped` (`:615` / `:819`).

- [ ] **Step 1: Extend the test**

Append inside the `describe`:

```ts
  it('carries the reconciled Routing enums and the added flood.max.unscoped pair', () => {
    expect(CLI_BY_NAME['set loop.detect']?.args?.[0].enum).toEqual(['off', 'minimal', 'moderate', 'strict']);
    expect(CLI_BY_NAME['set path.hash.mode']?.args?.[0].enum).toEqual(['0', '1', '2']);
    expect(CLI_BY_NAME['get flood.max.unscoped']?.key).toBe('flood.max.unscoped');
    expect(CLI_BY_NAME['set flood.max.unscoped']?.key).toBe('flood.max.unscoped');
  });
```

- [ ] **Step 2: Run the test — expect failure**

Run: `npx vitest run --project unit tests/unit/shared/repeater-cli/catalog.test.ts`
Expected: FAIL — `CLI_BY_NAME['set loop.detect']` is `undefined`.

- [ ] **Step 3: Add the Routing array and extend `CLI_COMMANDS`**

Insert above `export const CLI_COMMANDS`:

```ts
const ROUTING: CliCommand[] = [
  { name: 'get repeat', group: 'Routing', desc: 'Repeat flag', key: 'repeat', replyValue: GET_VALUE },
  { name: 'set repeat', group: 'Routing', desc: 'Enable or disable repeating', key: 'repeat', args: onOff,
    note: 'Turning this off silently removes the node from the mesh.' },
  { name: 'get path.hash.mode', group: 'Routing', desc: 'Advert path hash size', key: 'path.hash.mode', replyValue: GET_VALUE, fw: '1.14' },
  { name: 'set path.hash.mode', group: 'Routing', desc: 'Change advert path hash size', key: 'path.hash.mode', fw: '1.14',
    args: [{ name: 'value', enum: ['0', '1', '2'], enumDesc: {
      '0': '1 byte · 256 ids · 64 max flood',
      '1': '2 bytes · 65,536 ids · 32 max flood',
      '2': '3 bytes · 16.7M ids · 21 max flood',
    } }],
    note: 'Firmware ≤1.13 drops multibyte path hashes — raising this can limit flood propagation until your mesh has upgraded.' },
  { name: 'get loop.detect', group: 'Routing', desc: 'Loop detection mode', key: 'loop.detect', replyValue: GET_VALUE, fw: '1.14' },
  { name: 'set loop.detect', group: 'Routing', desc: 'Change loop detection', key: 'loop.detect', fw: '1.14',
    args: [{ name: 'state', enum: ['off', 'minimal', 'moderate', 'strict'], enumDesc: {
      off: 'no loop detection',
      minimal: 'drop at 4+ occurrences (1-byte)',
      moderate: 'drop at 2+ occurrences (1-byte)',
      strict: 'drop at 1+ occurrence (1-byte)',
    } }] },
  { name: 'get txdelay', group: 'Routing', desc: 'Flood retransmit delay factor', key: 'txdelay', replyValue: GET_VALUE },
  { name: 'set txdelay', group: 'Routing', desc: 'Change the flood retransmit delay factor', key: 'txdelay',
    args: [{ name: 'value', hint: '0–2', range: [0, 2] }],
    note: 'Scales the random back-off before retransmitting a flood packet. Higher = fewer collisions, more latency. 0 disables it.' },
  { name: 'get direct.txdelay', group: 'Routing', desc: 'Direct retransmit delay factor', key: 'direct.txdelay', replyValue: GET_VALUE },
  { name: 'set direct.txdelay', group: 'Routing', desc: 'Change the direct retransmit delay factor', key: 'direct.txdelay',
    args: [{ name: 'value', hint: '0–2', range: [0, 2] }] },
  { name: 'get rxdelay', group: 'Routing', desc: 'Receive processing delay', key: 'rxdelay', replyValue: GET_VALUE, experimental: true },
  { name: 'set rxdelay', group: 'Routing', desc: 'Change the receive processing delay', key: 'rxdelay', experimental: true,
    args: [{ name: 'value', hint: '0–20', range: [0, 20] }],
    note: 'Holds weak-signal copies in a queue so strong-signal paths forward first.' },
  { name: 'get dutycycle', group: 'Routing', desc: 'Duty cycle limit', key: 'dutycycle', replyValue: GET_VALUE, fw: '1.15' },
  { name: 'set dutycycle', group: 'Routing', desc: 'Change the duty cycle limit', key: 'dutycycle', fw: '1.15',
    args: [{ name: 'value', hint: '1–100 %', range: [1, 100] }],
    presets: [{ value: '100', label: 'Unlimited' }, { value: '50', label: '50%', note: 'default' }, { value: '10', label: '10%', note: 'EU 868' }, { value: '1', label: '1%', note: 'strictest EU' }] },
  { name: 'get af', group: 'Routing', desc: 'Airtime factor', key: 'af', replyValue: GET_VALUE, deprecated: '1.15' },
  { name: 'set af', group: 'Routing', desc: 'Change the airtime factor', key: 'af', deprecated: '1.15',
    args: [{ name: 'value', hint: '0–9', range: [0, 9] }], note: 'Superseded by `set dutycycle`.' },
  { name: 'get multi.acks', group: 'Routing', desc: 'Multi-acks support', key: 'multi.acks', replyValue: GET_VALUE },
  { name: 'set multi.acks', group: 'Routing', desc: 'Enable or disable multi-acks', key: 'multi.acks',
    args: [{ name: 'state', enum: ['0', '1'], enumDesc: { '0': 'disabled', '1': 'enabled' } }] },
  { name: 'get flood.advert.interval', group: 'Routing', desc: 'Flood advert interval', key: 'flood.advert.interval', replyValue: GET_VALUE },
  { name: 'set flood.advert.interval', group: 'Routing', desc: 'Change the flood advert interval', key: 'flood.advert.interval',
    args: [{ name: 'hours', hint: '3–168', range: [3, 168] }] },
  { name: 'get advert.interval', group: 'Routing', desc: 'Zero-hop advert interval', key: 'advert.interval', replyValue: GET_VALUE },
  { name: 'set advert.interval', group: 'Routing', desc: 'Change the zero-hop advert interval', key: 'advert.interval',
    args: [{ name: 'minutes', hint: '60–240', range: [0, 240] }] },
  { name: 'get flood.max', group: 'Routing', desc: 'Max hops for a flood message', key: 'flood.max', replyValue: GET_VALUE },
  { name: 'set flood.max', group: 'Routing', desc: 'Limit hops for a flood message', key: 'flood.max',
    args: [{ name: 'value', hint: '0–64', range: [0, 64] }] },
  { name: 'get flood.max.advert', group: 'Routing', desc: 'Max hops for an advert flood', key: 'flood.max.advert', replyValue: GET_VALUE },
  { name: 'set flood.max.advert', group: 'Routing', desc: 'Limit hops for an advert flood', key: 'flood.max.advert',
    args: [{ name: 'value', hint: '0–64', range: [0, 64] }] },
  { name: 'get flood.max.unscoped', group: 'Routing', desc: 'Max hops for an unscoped flood', key: 'flood.max.unscoped', replyValue: GET_VALUE },
  { name: 'set flood.max.unscoped', group: 'Routing', desc: 'Limit hops for an unscoped flood', key: 'flood.max.unscoped',
    args: [{ name: 'value', hint: '0–64', range: [0, 64] }],
    note: 'Added in reconciliation — present in CommonCLI.cpp (set :615 / get :819), absent from the mockup.' },
];
```

Replace the `CLI_COMMANDS` array:

```ts
export const CLI_COMMANDS: readonly CliCommand[] = [
  ...OPERATIONAL, ...NEIGHBORS, ...STATISTICS, ...LOGGING, ...INFO,
  ...RADIO, ...SYSTEM, ...ROUTING,
];
```

- [ ] **Step 4: Run the test — expect pass**

Run: `npx vitest run --project unit tests/unit/shared/repeater-cli/catalog.test.ts`
Expected: PASS, 11 tests.

- [ ] **Step 5: Typecheck and lint**

Run: `npx tsc --noEmit && npx biome check src/shared/repeater-cli tests/unit/shared`
Expected: both clean.

- [ ] **Step 6: Commit**

```bash
git add src/shared/repeater-cli/catalog.ts tests/unit/shared/repeater-cli/catalog.test.ts
git commit -m "feat(cli): catalog Routing group

Enums verified against CommonCLI.cpp (loop.detect, path.hash.mode,
multi.acks). Adds the mockup-missing flood.max.unscoped get/set pair. No
Routing command is serial or noReply.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Catalog — ACL, Region, GPS

**Files:**
- Modify: `src/shared/repeater-cli/catalog.ts` (add `ACL`, `REGION`, `GPS`; extend `CLI_COMMANDS`)
- Modify: `tests/unit/shared/repeater-cli/catalog.test.ts` (add `get acl` serialOnly, `region list` NOT serial, `region load` noReply)

**Interfaces:**
- Consumes: `CliCommand`, `GET_VALUE`, `onOff` (Task 1).
- Produces: `ACL`, `REGION`, `GPS` arrays folded into `CLI_COMMANDS`.

**Reconciliation notes (these resolve the §0/§1.2 open questions):**
- `get acl` is `serialOnly`: its repeater-local branch is guarded `sender_timestamp == 0` and prints the ACL to `Serial`, returning no reply (`MyMeshRepeater.cpp:1234`). **Over the air it does not stay silent** — it falls through to `CommonCLI.cpp` `handleGetCmd`, which has no `acl` case, so it returns `"??: acl"` (`:930`). The useful behaviour is serial-only; the note records the over-air `"??: acl"`. `get acl` has no key.
- **`region list` is NOT serialOnly.** `handleRegionCmd` takes no `sender_timestamp` (`CommonCLI.cpp:986`), so no region command can be serial-gated. The mockup's `serial: true` on `region list` is wrong — drop it.
- **`region load` is `noReply`:** it calls `startRegionsLoad()` and leaves `reply[0] = 0` (`:1008`). This is the region-load initiator §0 mentions; the bulk push it pairs with is un-vendored.
- **Added, firmware-present but absent from the mockup:** `region get` (`:1031`), `region home` (`:1043`/`:1051`), `region default` (`:1054`/`:1075`), `region load` (`:1008`). **Omitted:** `region def` (`:991`) — a multi-token bulk-definition grammar, not a discrete palette command; note the decision.
- `setperm` permissions 0/1/2/3 → Guest/Read-only/Read-write/Admin, verified at `MyMeshRepeater.cpp:1223`.
- GPS is behind `ENV_INCLUDE_GPS`; `gps advert` policy none/share/prefs verified (`:400–411`); `gps on`/`gps off`/bare `gps` map to the `gps` toggle with `onOff` args.

- [ ] **Step 1: Extend the test**

Append inside the `describe`:

```ts
  it('resolves the ACL and Region reconciliation questions by name', () => {
    expect(CLI_BY_NAME['get acl']?.serialOnly).toBe(true);
    // region list is NOT serial — handleRegionCmd has no sender_timestamp guard.
    expect(CLI_BY_NAME['region list']?.serialOnly).toBeUndefined();
    // region load writes no reply.
    expect(CLI_BY_NAME['region load']?.noReply).toBe(true);
  });

  it('lists the four setperm permission levels', () => {
    expect(CLI_BY_NAME.setperm?.args?.[1].enum).toEqual(['0', '1', '2', '3']);
  });
```

- [ ] **Step 2: Run the test — expect failure**

Run: `npx vitest run --project unit tests/unit/shared/repeater-cli/catalog.test.ts`
Expected: FAIL — `CLI_BY_NAME['get acl']` is `undefined`.

- [ ] **Step 3: Add the ACL, Region and GPS arrays and complete `CLI_COMMANDS`**

Insert above `export const CLI_COMMANDS`:

```ts
const ACL: CliCommand[] = [
  { name: 'get acl', group: 'ACL', desc: 'View the current ACL', serialOnly: true,
    note: 'The ACL dump is serial only — guarded by sender_timestamp == 0 (MyMeshRepeater.cpp:1234). Over the air it falls through to CommonCLI.cpp and returns "??: acl".' },
  { name: 'setperm', group: 'ACL', desc: "Add, update or remove a companion's permissions", spec: '<pubkey> <permissions>',
    args: [
      { name: 'pubkey', hint: 'companion public key' },
      { name: 'permissions', enum: ['0', '1', '2', '3'], enumDesc: { '0': 'Guest', '1': 'Read-only', '2': 'Read-write', '3': 'Admin' } },
    ],
    note: 'Omit permissions to remove the entry entirely.' },
  { name: 'get allow.read.only', group: 'ACL', desc: 'Room server read-only flag', key: 'allow.read.only', replyValue: GET_VALUE },
  { name: 'set allow.read.only', group: 'ACL', desc: 'Change the read-only flag', key: 'allow.read.only', args: onOff },
];

const REGION: CliCommand[] = [
  { name: 'region', group: 'Region', desc: 'Dump all regions and flood permissions', fw: '1.10' },
  { name: 'region save', group: 'Region', desc: 'Persist region changes made since reboot', fw: '1.10' },
  { name: 'region load', group: 'Region', desc: 'Begin a region-load session', noReply: true, fw: '1.10',
    note: 'Writes no reply (CommonCLI.cpp:1008); pairs with an un-vendored bulk push.' },
  { name: 'region allowf', group: 'Region', desc: 'Allow flooding for a region', fw: '1.10',
    spec: '<name>', args: [{ name: 'name', hint: 'region name or *' }] },
  { name: 'region denyf', group: 'Region', desc: 'Block flooding for a region', fw: '1.10',
    spec: '<name>', args: [{ name: 'name', hint: 'region name or *' }] },
  { name: 'region put', group: 'Region', desc: 'Create a new region', fw: '1.10', spec: '<name> [parent_name]' },
  { name: 'region remove', group: 'Region', desc: 'Remove a region', fw: '1.10', danger: true,
    spec: '<name>', note: 'All child regions must be removed first.' },
  { name: 'region get', group: 'Region', desc: 'Inspect one region', fw: '1.10',
    spec: '<name>', args: [{ name: 'name', hint: 'region name' }],
    note: 'Added in reconciliation — CommonCLI.cpp:1031.' },
  { name: 'region home', group: 'Region', desc: 'Show or set the home region', fw: '1.10',
    spec: '[name]', note: 'Added in reconciliation — bare `region home` shows it, a name sets it (CommonCLI.cpp:1043/1051).' },
  { name: 'region default', group: 'Region', desc: 'Show or set the default scope', fw: '1.10',
    spec: '[name|<null>]', note: 'Added in reconciliation — CommonCLI.cpp:1054/1075.' },
  { name: 'region list', group: 'Region', desc: 'View all regions', fw: '1.12',
    spec: '<filter>', args: [{ name: 'filter', enum: ['allowed', 'denied'] }],
    note: 'Reconciled: NOT serial — handleRegionCmd has no sender_timestamp guard, unlike the mockup.' },
];

const GPS: CliCommand[] = [
  { name: 'gps', group: 'GPS', desc: 'GPS state', key: 'gps', args: onOff,
    note: '`gps on`/`gps off` in firmware; bare `gps` shows status. Behind ENV_INCLUDE_GPS.' },
  { name: 'gps sync', group: 'GPS', desc: 'Sync the clock with GPS time' },
  { name: 'gps setloc', group: 'GPS', desc: 'Set location from GPS coordinates' },
  { name: 'gps advert', group: 'GPS', desc: 'GPS advert policy',
    args: [{ name: 'policy', enum: ['none', 'share', 'prefs'], enumDesc: {
      none: 'never include location',
      share: 'share live GPS location',
      prefs: 'use stored lat/lon',
    } }] },
];
```

Replace the `CLI_COMMANDS` array with its final form:

```ts
export const CLI_COMMANDS: readonly CliCommand[] = [
  ...OPERATIONAL, ...NEIGHBORS, ...STATISTICS, ...LOGGING, ...INFO,
  ...RADIO, ...SYSTEM, ...ROUTING, ...ACL, ...REGION, ...GPS,
];
```

- [ ] **Step 4: Run the full catalog test — expect pass**

Run: `npx vitest run --project unit tests/unit/shared/repeater-cli/catalog.test.ts`
Expected: PASS, 13 tests. All eight `serialOnly` names (`erase`, `log`, `stats-core`, `stats-radio`, `stats-packets`, `set freq`, `get prv.key`, `get acl`) and all four `noReply` names (`reboot`, `poweroff`, `clkreboot`, `region load`) are now individually asserted.

- [ ] **Step 5: Typecheck and lint**

Run: `npx tsc --noEmit && npx biome check src/shared/repeater-cli tests/unit/shared`
Expected: both clean.

- [ ] **Step 6: Commit**

```bash
git add src/shared/repeater-cli/catalog.ts tests/unit/shared/repeater-cli/catalog.test.ts
git commit -m "feat(cli): catalog ACL, Region and GPS groups — reconciliation complete

Resolves the §1.2 open questions: get acl is serialOnly (over the air it
returns '??: acl', not silence); region list is NOT serial (handleRegionCmd
has no sender_timestamp guard) — the mockup was wrong; region load is
noReply. Adds region get/home/default/load; omits region def (bulk grammar).
CLI_COMMANDS is complete.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: `parse.ts` — line + caret → parse mode

**Files:**
- Create: `src/renderer/panels/repeater-admin/cli/lib/parse.ts`
- Create: `tests/unit/renderer/panels/repeater-admin/cli/parse.test.ts`

**Interfaces:**
- Consumes: `CLI_COMMANDS`, `CliCommand` (catalog).
- Produces (verbatim §2.1):
  ```ts
  type CliParse =
    | { mode: 'command'; token: string; start: 0 }
    | { mode: 'arg'; cmd: CliCommand; argIndex: number; token: string; start: number };
  function parseCliLine(text: string, caret: number): CliParse;
  function resolveCommand(text: string): CliCommand | null;   // longest-name resolution, reused by suggest + reducer
  ```

- [ ] **Step 1: Write the failing test**

Create `tests/unit/renderer/panels/repeater-admin/cli/parse.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { parseCliLine, resolveCommand } from '@/panels/repeater-admin/cli/lib/parse';

describe('parseCliLine', () => {
  it('is command mode for an empty line', () => {
    expect(parseCliLine('', 0)).toEqual({ mode: 'command', token: '', start: 0 });
  });

  it('is command mode for a partial name', () => {
    expect(parseCliLine('set ra', 6)).toEqual({ mode: 'command', token: 'set ra', start: 0 });
  });

  it('keeps an exact command name in command mode with the whole prefix as the token', () => {
    // ⌃Space on a complete name must offer siblings, not arguments nobody started.
    const p = parseCliLine('set radio', 9);
    expect(p).toEqual({ mode: 'command', token: 'set radio', start: 0 });
  });

  it('enters arg mode only after a trailing space, with an empty token', () => {
    const p = parseCliLine('set radio ', 10);
    expect(p.mode).toBe('arg');
    if (p.mode === 'arg') {
      expect(p.cmd.name).toBe('set radio');
      expect(p.argIndex).toBe(0);
      expect(p.token).toBe('');
      expect(p.start).toBe(10);
    }
  });

  it('lets the longest command name win — `set radio` over `set`', () => {
    const p = parseCliLine('set radio 869', 13);
    expect(p.mode).toBe('arg');
    if (p.mode === 'arg') {
      expect(p.cmd.name).toBe('set radio');
      expect(p.argIndex).toBe(0);
      expect(p.token).toBe('869');
      expect(p.start).toBe(10);
    }
  });

  it('tracks the argument index across spaces', () => {
    const p = parseCliLine('setperm abc 3', 13);
    expect(p.mode).toBe('arg');
    if (p.mode === 'arg') {
      expect(p.cmd.name).toBe('setperm');
      expect(p.argIndex).toBe(1);
      expect(p.token).toBe('3');
    }
  });

  it('considers only text up to the caret', () => {
    // Caret sits right after `radio`, so the trailing ` 869` is invisible.
    const p = parseCliLine('set radio 869', 9);
    expect(p).toEqual({ mode: 'command', token: 'set radio', start: 0 });
  });
});

describe('resolveCommand', () => {
  it('resolves an exact name', () => {
    expect(resolveCommand('ver')?.name).toBe('ver');
  });

  it('resolves the longest matching name for a line with arguments', () => {
    expect(resolveCommand('set radio 869.525,250,11,5')?.name).toBe('set radio');
  });

  it('returns null for an unknown line', () => {
    expect(resolveCommand('frobnicate the widget')).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test — expect failure**

Run: `npx vitest run --project unit tests/unit/renderer/panels/repeater-admin/cli/parse.test.ts`
Expected: FAIL — cannot resolve `@/panels/repeater-admin/cli/lib/parse`.

- [ ] **Step 3: Create `parse.ts`**

```ts
// Which suggestion surface the caret is currently in. A discriminated union so
// the deferred variable/filter/macro modes (§2.1) stay additive.
import { CLI_COMMANDS, type CliCommand } from '../../../../../shared/repeater-cli/catalog';

export type CliParse =
  | { mode: 'command'; token: string; start: 0 }
  | { mode: 'arg'; cmd: CliCommand; argIndex: number; token: string; start: number };

/** Considers only text up to the caret. Exact equality with a command name
 *  stays in command mode; only `name + ' '` enters arg mode, and the LONGEST
 *  such match wins (`set radio` over `set`). */
export function parseCliLine(text: string, caret: number): CliParse {
  const head = text.slice(0, Math.max(0, Math.min(caret, text.length)));

  let best: { cmd: CliCommand; exact: boolean } | null = null;
  for (const c of CLI_COMMANDS) {
    if (head === c.name) {
      if (!best || c.name.length > best.cmd.name.length) best = { cmd: c, exact: true };
    } else if (head.startsWith(`${c.name} `)) {
      if (!best || c.name.length > best.cmd.name.length) best = { cmd: c, exact: false };
    }
  }

  if (best && !best.exact) {
    const rest = head.slice(best.cmd.name.length + 1);
    const parts = rest.split(/\s+/);
    const token = parts[parts.length - 1];
    return { mode: 'arg', cmd: best.cmd, argIndex: parts.length - 1, token, start: head.length - token.length };
  }

  return { mode: 'command', token: head, start: 0 };
}

/** Longest command name that equals the trimmed line or is a prefix of it
 *  followed by a space. Reused by suggest (recent derivation) and the reducer
 *  (danger confirmation). */
export function resolveCommand(text: string): CliCommand | null {
  const t = text.trim();
  let best: CliCommand | null = null;
  for (const c of CLI_COMMANDS) {
    if (t === c.name || t.startsWith(`${c.name} `)) {
      if (!best || c.name.length > best.name.length) best = c;
    }
  }
  return best;
}
```

- [ ] **Step 4: Run the test — expect pass**

Run: `npx vitest run --project unit tests/unit/renderer/panels/repeater-admin/cli/parse.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 5: Typecheck and lint**

Run: `npx tsc --noEmit && npx biome check src tests`
Expected: both clean.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/panels/repeater-admin/cli/lib/parse.ts tests/unit/renderer/panels/repeater-admin/cli/parse.test.ts
git commit -m "feat(cli): parseCliLine + resolveCommand

Line + caret to a command/arg discriminated union. Exact names stay in
command mode (⌃Space offers siblings); only name+space enters arg mode, and
the longest name wins so 'set radio 869' parses as args to 'set radio'.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: `match.ts` — scoring + common prefix

**Files:**
- Create: `src/renderer/panels/repeater-admin/cli/lib/match.ts`
- Create: `tests/unit/renderer/panels/repeater-admin/cli/match.test.ts`

**Interfaces:**
- Consumes: `CliCommand`, `CLI_BY_NAME` (catalog).
- Produces (verbatim §2.2):
  ```ts
  interface CliMatch { score: number; ranges: [number, number][] }
  function matchCommand(query: string, cmd: CliCommand): CliMatch | null;
  function commonPrefix(items: { label: string; serialOnly?: true }[]): string | null;
  ```
  **Deviation flagged:** the spec's §2.2 signature block writes `commonPrefix(items: { label: string }[])`, but its prose requires the computation to run "over non-`serialOnly` items only". A `{ label }`-only parameter cannot express that, so the parameter is widened to `{ label: string; serialOnly?: true }[]` and the filter is done *inside* `commonPrefix` (it also accepts `CliSuggestion[]`, whose `serialOnly?: true` matches). This is the prose winning over the signature; call it out in the task report.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/renderer/panels/repeater-admin/cli/match.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { CLI_BY_NAME } from '../../../../../../src/shared/repeater-cli/catalog';
import { commonPrefix, matchCommand } from '@/panels/repeater-admin/cli/lib/match';

const setRadio = CLI_BY_NAME['set radio'];
const setDutycycle = CLI_BY_NAME['set dutycycle'];
const setAdc = CLI_BY_NAME['set adc.multiplier']; // desc: 'Fine-tune the battery reading'

describe('matchCommand', () => {
  it('scores an empty query as 1 with no ranges (⌃Space browse)', () => {
    expect(matchCommand('', setRadio)).toEqual({ score: 1, ranges: [] });
  });

  it('scores a prefix hit as 1000 − name.length', () => {
    expect(matchCommand('set r', setRadio)).toEqual({ score: 1000 - 'set radio'.length, ranges: [[0, 5]] });
  });

  it('scores a word-start hit (after space/./-) as 700 − name.length', () => {
    const m = matchCommand('radio', setRadio);
    expect(m).toEqual({ score: 700 - 'set radio'.length, ranges: [[4, 9]] });
  });

  it('scores a mid-substring hit as 450 − name.length', () => {
    const m = matchCommand('ycle', setDutycycle);
    expect(m?.score).toBe(450 - 'set dutycycle'.length);
  });

  it('scores a subsequence hit as 300 − name.length with merged ranges', () => {
    // 'sr' hits s(0) and r(4) of 'set radio' — two non-adjacent ranges.
    const m = matchCommand('sr', setRadio);
    expect(m?.score).toBe(300 - 'set radio'.length);
    expect(m?.ranges).toEqual([[0, 1], [4, 5]]);
  });

  it('merges adjacent subsequence ranges into one span', () => {
    // 'setr' hits s,e,t,r → [0..3] merges, then r at 4 → [[0,3],[4,5]].
    const m = matchCommand('setr', setRadio);
    expect(m?.ranges).toEqual([[0, 3], [4, 5]]);
  });

  it('scores a description-only hit as 120 − name.length with no ranges', () => {
    const m = matchCommand('battery', setAdc);
    expect(m).toEqual({ score: 120 - 'set adc.multiplier'.length, ranges: [] });
  });

  it('returns null when nothing matches', () => {
    expect(matchCommand('zzzz', setRadio)).toBeNull();
  });

  it('breaks prefix ties by name length — the shorter name scores higher', () => {
    const a = matchCommand('set r', CLI_BY_NAME['set radio']); // len 9
    const b = matchCommand('set r', CLI_BY_NAME['set rxdelay']); // len 11
    expect((a as { score: number }).score).toBeGreaterThan((b as { score: number }).score);
  });

  it('is stable: sorting equal-score matches preserves input order', () => {
    // Every command ties at score 1 for the empty query; Array.sort is stable.
    const cmds = [CLI_BY_NAME.ver, CLI_BY_NAME.board, CLI_BY_NAME['get role']];
    const sorted = [...cmds].sort((x, y) => matchCommand('', y).score - matchCommand('', x).score);
    expect(sorted.map((c) => c.name)).toEqual(['ver', 'board', 'get role']);
  });
});

describe('commonPrefix', () => {
  it('returns the longest shared case-insensitive prefix', () => {
    expect(commonPrefix([{ label: 'set radio' }, { label: 'set radio.rxgain' }])).toBe('set radio');
  });

  it('returns null when the set diverges at character zero', () => {
    expect(commonPrefix([{ label: 'ver' }, { label: 'board' }])).toBeNull();
  });

  it('is computed over non-serialOnly items only', () => {
    // The serial-only outlier shares no prefix; without filtering it would
    // collapse the result to null and Tab would do nothing.
    const items = [{ label: 'set radio' }, { label: 'set radio.rxgain' }, { label: 'get acl', serialOnly: true as const }];
    expect(commonPrefix(items)).toBe('set radio');
  });

  it('returns null for an empty (or all-serial) set', () => {
    expect(commonPrefix([])).toBeNull();
    expect(commonPrefix([{ label: 'get acl', serialOnly: true as const }])).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test — expect failure**

Run: `npx vitest run --project unit tests/unit/renderer/panels/repeater-admin/cli/match.test.ts`
Expected: FAIL — cannot resolve `@/panels/repeater-admin/cli/lib/match`.

- [ ] **Step 3: Create `match.ts`**

```ts
// Ranking one command against a query. Prefix › word-start › mid-substring ›
// subsequence › description hit; the empty query ties every command at 1 so the
// recency bonus (§2.3) dominates the browse list.
import type { CliCommand } from '../../../../../shared/repeater-cli/catalog';

export interface CliMatch {
  score: number;
  ranges: [number, number][];
}

export function matchCommand(query: string, cmd: CliCommand): CliMatch | null {
  if (!query) return { score: 1, ranges: [] };

  const name = cmd.name;
  const ln = name.toLowerCase();
  const lq = query.toLowerCase();
  const at = ln.indexOf(lq);

  if (at === 0) return { score: 1000 - name.length, ranges: [[0, lq.length]] };
  if (at > 0) {
    const wordStart = /[\s.\-]/.test(name[at - 1]);
    return { score: (wordStart ? 700 : 450) - name.length, ranges: [[at, at + lq.length]] };
  }

  // Subsequence — "sr" → "set radio".
  const ranges: [number, number][] = [];
  let i = 0;
  for (let j = 0; j < ln.length && i < lq.length; j++) {
    if (ln[j] === lq[i]) {
      ranges.push([j, j + 1]);
      i++;
    }
  }
  if (i === lq.length) return { score: 300 - name.length, ranges: mergeRanges(ranges) };

  if (cmd.desc.toLowerCase().includes(lq)) return { score: 120 - name.length, ranges: [] };
  return null;
}

function mergeRanges(r: [number, number][]): [number, number][] {
  const out: [number, number][] = [];
  for (const [a, b] of r) {
    const last = out[out.length - 1];
    if (last && last[1] === a) last[1] = b;
    else out.push([a, b]);
  }
  return out;
}

/** Longest shared case-insensitive prefix — what Tab fills in. Computed over
 *  NON-serialOnly items only (§2.2): one sunk serial-only command sharing no
 *  prefix would otherwise collapse the result to null and Tab would do nothing.
 *  Accepts CliSuggestion[] (its optional `serialOnly` matches). */
export function commonPrefix(items: { label: string; serialOnly?: true }[]): string | null {
  const usable = items.filter((i) => !i.serialOnly);
  if (usable.length === 0) return null;

  let pre = usable[0].label;
  for (const it of usable) {
    let i = 0;
    while (i < pre.length && i < it.label.length && pre[i].toLowerCase() === it.label[i].toLowerCase()) i++;
    pre = pre.slice(0, i);
    if (!pre) return null;
  }
  return pre;
}
```

- [ ] **Step 4: Run the test — expect pass**

Run: `npx vitest run --project unit tests/unit/renderer/panels/repeater-admin/cli/match.test.ts`
Expected: PASS, 14 tests.

- [ ] **Step 5: Typecheck and lint**

Run: `npx tsc --noEmit && npx biome check src tests`
Expected: both clean.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/panels/repeater-admin/cli/lib/match.ts tests/unit/renderer/panels/repeater-admin/cli/match.test.ts
git commit -m "feat(cli): matchCommand scoring + commonPrefix

Six scoring tiers with the load-bearing empty-query row at 1, merged
subsequence ranges, tie-break by name length, and stable-sort behaviour.
commonPrefix filters serialOnly internally (prose §2.2 over the signature)
so one sunk serial-only command can't collapse Tab-completion.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: `suggest.ts` — ranked suggestions, apply, extraction, recent

**Files:**
- Create: `src/renderer/panels/repeater-admin/cli/lib/suggest.ts`
- Create: `tests/unit/renderer/panels/repeater-admin/cli/suggest.test.ts`

**Interfaces:**
- Consumes: `CLI_COMMANDS`, `CliCommand`, `CliParse`, `parseCliLine`, `resolveCommand`, `matchCommand`, `CliHistoryEntry` (from persistence, Task 11 — declare its shape inline for now via the persistence import; Task 11 creates the module, so **do Task 11 before Task 8 if typecheck complains**, or accept the ordering below which imports the type only).
- Produces (verbatim §2.3):
  ```ts
  interface CliSuggestCtx { recent: string[]; nodeValues: Record<string, string> }
  interface CliSuggestion {
    id: string; label: string; desc: string;
    kind: 'command' | 'value' | 'preset' | 'current';
    cmd?: CliCommand; group?: CliGroup; ranges?: [number, number][]; meta?: string;
    insert: string; replaceFrom: number; replaceAll?: boolean;
    serialOnly?: true; recent?: true;
  }
  function suggest(text: string, caret: number, ctx: CliSuggestCtx): { parse: CliParse; items: CliSuggestion[] };
  function applySuggestion(value: string, caret: number, s: CliSuggestion): { value: string; caret: number };
  function extractNodeValue(cmd: CliCommand, reply: string): string | null;
  function deriveRecent(history: CliHistoryEntry[], max?: number): string[];
  ```

**Ordering note:** `suggest.ts` imports `CliHistoryEntry` from `./persistence`, which Task 11 creates. To keep tasks independently green, **run Task 11 before Task 8**, OR (equivalently) create the `persistence.ts` type stub first. This plan sequences 6→7→8 for logic locality; if you execute strictly in order, add a one-line `export interface CliHistoryEntry { text: string; status: 'ok'|'error'|'timeout'|'sent' }` to a not-yet-created `persistence.ts` here and let Task 11 flesh it out. The simplest path is to execute Task 11 immediately before this task.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/renderer/panels/repeater-admin/cli/suggest.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { CLI_BY_NAME } from '../../../../../../src/shared/repeater-cli/catalog';
import { applySuggestion, deriveRecent, extractNodeValue, suggest } from '@/panels/repeater-admin/cli/lib/suggest';
import type { CliSuggestCtx } from '@/panels/repeater-admin/cli/lib/suggest';

const ctx = (over: Partial<CliSuggestCtx> = {}): CliSuggestCtx => ({ recent: [], nodeValues: {}, ...over });

describe('suggest — command mode', () => {
  it('ranks a recent command above an equal-scoring peer', () => {
    const { items } = suggest('', 0, ctx({ recent: ['set dutycycle'] }));
    expect(items[0].label).toBe('set dutycycle');
    expect(items[0].recent).toBe(true);
  });

  it('sinks serial-only commands to the bottom regardless of match', () => {
    const { items } = suggest('get acl', 7, ctx());
    // 'get acl' is a perfect prefix match but serialOnly (−2000), so anything
    // else that matches outranks it; and it is flagged serialOnly.
    const acl = items.find((i) => i.label === 'get acl');
    expect(acl?.serialOnly).toBe(true);
    expect(items[items.length - 1].label).toBe('get acl');
  });

  it('inserts a trailing space only for commands that take arguments', () => {
    const { items } = suggest('set radio', 9, ctx());
    expect(items.find((i) => i.label === 'set radio')?.insert).toBe('set radio ');
    expect(CLI_BY_NAME.ver && suggest('ver', 3, ctx()).items.find((i) => i.label === 'ver')?.insert).toBe('ver');
  });
});

describe('suggest — arg mode', () => {
  it('offers enum values filtered by prefix', () => {
    const { items } = suggest('set repeat o', 12, ctx());
    expect(items.map((i) => i.label)).toEqual(['on', 'off']);
    const { items: onlyOff } = suggest('set repeat of', 13, ctx());
    expect(onlyOff.map((i) => i.label)).toEqual(['off']);
  });

  it('offers "on node now" only at argIndex 0 and not when it duplicates an enum', () => {
    // set adc.multiplier has no enum → node value offered at index 0.
    const at0 = suggest('set adc.multiplier ', 19, ctx({ nodeValues: { 'adc.multiplier': '1.87' } }));
    expect(at0.items[0]).toMatchObject({ label: '1.87', kind: 'current', meta: 'on node now' });
    // set repeat's node value 'on' IS an enum value → not offered as a separate row.
    const dup = suggest('set repeat ', 11, ctx({ nodeValues: { repeat: 'on' } }));
    expect(dup.items.filter((i) => i.meta === 'on node now')).toHaveLength(0);
    // ...but the matching enum row is marked current.
    expect(dup.items.find((i) => i.label === 'on')?.meta).toBe('current');
  });

  it('matches presets on value-prefix OR label-substring', () => {
    // 'us' has no value starting with it, but the 'US 915' label contains it.
    const { items } = suggest('set radio us', 12, ctx());
    expect(items.map((i) => i.label)).toContain('910.525,250,11,5');
  });
});

describe('applySuggestion', () => {
  it('replaces the whole line for a command (replaceAll) and puts the caret at the end', () => {
    const s = suggest('set ra', 6, ctx()).items.find((i) => i.label === 'set radio');
    const out = applySuggestion('set ra', 6, s as never);
    expect(out).toEqual({ value: 'set radio ', caret: 10 });
  });

  it('splices an arg value at replaceFrom, keeping the tail', () => {
    const s = suggest('set repeat o', 12, ctx()).items.find((i) => i.label === 'on');
    const out = applySuggestion('set repeat o', 12, s as never);
    expect(out).toEqual({ value: 'set repeat on', caret: 13 });
  });
});

describe('extractNodeValue', () => {
  it('strips the firmware "> " prefix via replyValue', () => {
    expect(extractNodeValue(CLI_BY_NAME['get radio'], '> 869.525,250,11,5')).toBe('869.525,250,11,5');
  });

  it('records nothing when extraction is ambiguous (a colon or multiple lines)', () => {
    // A get without a replyValue falls back to "single line, no colon".
    expect(extractNodeValue(CLI_BY_NAME['get role'], '> repeater')).toBe('repeater');
    // A command with no key never records.
    expect(extractNodeValue(CLI_BY_NAME.ver, '1.14.3')).toBeNull();
  });
});

describe('deriveRecent', () => {
  it('resolves ok history lines to distinct command names, newest first, max 5', () => {
    const recent = deriveRecent([
      { text: 'ver', status: 'ok' },
      { text: 'get radio', status: 'error' }, // non-ok skipped
      { text: 'set radio 869.525,250,11,5', status: 'ok' },
      { text: 'set radio 910.525,250,11,5', status: 'ok' }, // same command, collapsed
    ]);
    expect(recent).toEqual(['set radio', 'ver']);
  });
});
```

- [ ] **Step 2: Run the test — expect failure**

Run: `npx vitest run --project unit tests/unit/renderer/panels/repeater-admin/cli/suggest.test.ts`
Expected: FAIL — cannot resolve `@/panels/repeater-admin/cli/lib/suggest`.

- [ ] **Step 3: Create `suggest.ts`**

```ts
// Ranked suggestions over the catalog. One flat, already-sorted list; the
// palette (Phase 2) groups it for display. Apply/splice semantics are stated
// once (§2.3) and every call site — Tab, Enter, mouse click, ghost — uses
// applySuggestion so they can never drift apart.
import { type CliCommand, type CliGroup, CLI_COMMANDS } from '../../../../../shared/repeater-cli/catalog';
import { type CliParse, parseCliLine, resolveCommand } from './parse';
import { matchCommand } from './match';
import type { CliHistoryEntry } from './persistence';

export interface CliSuggestCtx {
  recent: string[];                        // command names, most-recent first, max 5
  nodeValues: Record<string, string>;      // cmd.key → last extracted get value
}

export interface CliSuggestion {
  id: string;
  label: string;
  desc: string;
  kind: 'command' | 'value' | 'preset' | 'current';
  cmd?: CliCommand;
  group?: CliGroup;
  ranges?: [number, number][];
  meta?: string;
  insert: string;
  replaceFrom: number;
  replaceAll?: boolean;
  serialOnly?: true;
  recent?: true;
}

export function suggest(text: string, caret: number, ctx: CliSuggestCtx): { parse: CliParse; items: CliSuggestion[] } {
  const parse = parseCliLine(text, caret);

  if (parse.mode === 'arg') {
    const cmd = parse.cmd;
    const arg = cmd.args?.[parse.argIndex];
    const q = parse.token.toLowerCase();
    const enumVals = arg?.enum ?? [];
    const nodeVal = cmd.key ? ctx.nodeValues[cmd.key] : undefined;
    const items: CliSuggestion[] = [];

    // 1. The value the node last reported — argIndex 0 only, not a dup of an enum.
    if (parse.argIndex === 0 && nodeVal && !enumVals.includes(nodeVal) && (!q || nodeVal.toLowerCase().startsWith(q))) {
      items.push({
        id: `n:${cmd.name}`, label: nodeVal, desc: 'Value on the node now',
        kind: 'current', meta: 'on node now', insert: nodeVal, replaceFrom: parse.start,
      });
    }
    // 2. Enum values, filtered by prefix, carrying their enumDesc.
    for (const v of enumVals) {
      if (q && !v.toLowerCase().startsWith(q)) continue;
      items.push({
        id: `e:${cmd.name}:${v}`, label: v, desc: arg?.enumDesc?.[v] ?? arg?.name ?? '',
        kind: 'value', insert: v, replaceFrom: parse.start,
        ...(nodeVal === v ? { meta: 'current' } : {}),
      });
    }
    // 3. Presets — value-prefix OR label-substring.
    for (const p of cmd.presets ?? []) {
      if (q && !p.value.toLowerCase().startsWith(q) && !p.label.toLowerCase().includes(q)) continue;
      items.push({
        id: `p:${cmd.name}:${p.value}`, label: p.value, desc: p.label,
        kind: 'preset', insert: p.value, replaceFrom: parse.start,
        ...(p.note ? { meta: p.note } : {}),
      });
    }
    return { parse, items };
  }

  // Command mode: score every command, apply the recency boost and serial-only
  // penalty, sort descending (stable → catalog order for ties).
  const token = parse.token.trim();
  const scored: { score: number; item: CliSuggestion }[] = [];
  for (const cmd of CLI_COMMANDS) {
    const m = matchCommand(token, cmd);
    if (!m) continue;
    const rIdx = ctx.recent.indexOf(cmd.name);
    const score = m.score + (rIdx >= 0 ? 260 - rIdx * 10 : 0) - (cmd.serialOnly ? 2000 : 0);
    scored.push({
      score,
      item: {
        id: `c:${cmd.name}`, label: cmd.name, desc: cmd.desc, kind: 'command',
        cmd, group: cmd.group, ranges: m.ranges,
        insert: cmd.name + (cmd.spec || cmd.args ? ' ' : ''),
        replaceFrom: 0, replaceAll: true,
        ...(cmd.serialOnly ? { serialOnly: true } : {}),
        ...(rIdx >= 0 && token === '' ? { recent: true } : {}),
      },
    });
  }
  scored.sort((a, b) => b.score - a.score);
  return { parse, items: scored.map((x) => x.item) };
}

/** value.slice(0, replaceFrom) + insert + (replaceAll ? '' : value.slice(caret)),
 *  caret at replaceFrom + insert.length. Stated once in §2.3. */
export function applySuggestion(value: string, caret: number, s: CliSuggestion): { value: string; caret: number } {
  const head = value.slice(0, s.replaceFrom);
  const tail = s.replaceAll ? '' : value.slice(caret);
  return { value: head + s.insert + tail, caret: s.replaceFrom + s.insert.length };
}

/** Pull the bare value out of a get reply. replyValue if present, else accept
 *  the trimmed reply only when it is a single line with no ':' separator. If
 *  extraction fails, record nothing — a missing suggestion is recoverable, a
 *  wrong prefill is not. */
export function extractNodeValue(cmd: CliCommand, reply: string): string | null {
  if (!cmd.key) return null;
  if (cmd.replyValue) {
    const m = cmd.replyValue.exec(reply);
    return m ? (m[1] ?? m[0]).trim() || null : null;
  }
  const trimmed = reply.trim();
  if (!trimmed || trimmed.includes('\n') || trimmed.includes(':')) return null;
  return trimmed;
}

/** History stores raw lines. Map each ok line through the same longest-name
 *  resolution parse.ts uses, newest-first, collecting distinct names until max. */
export function deriveRecent(history: CliHistoryEntry[], max = 5): string[] {
  const out: string[] = [];
  for (let i = history.length - 1; i >= 0 && out.length < max; i--) {
    if (history[i].status !== 'ok') continue;
    const cmd = resolveCommand(history[i].text);
    if (cmd && !out.includes(cmd.name)) out.push(cmd.name);
  }
  return out;
}
```

- [ ] **Step 4: Run the test — expect pass**

Run: `npx vitest run --project unit tests/unit/renderer/panels/repeater-admin/cli/suggest.test.ts`
Expected: PASS, 11 tests.

- [ ] **Step 5: Typecheck and lint**

Run: `npx tsc --noEmit && npx biome check src tests`
Expected: both clean. (If `tsc` cannot resolve `./persistence`, execute Task 11 first — see the Ordering note.)

- [ ] **Step 6: Commit**

```bash
git add src/renderer/panels/repeater-admin/cli/lib/suggest.ts tests/unit/renderer/panels/repeater-admin/cli/suggest.test.ts
git commit -m "feat(cli): ranked suggestions, apply/splice, extraction, recent

Command-mode ranking (recency +260−10i, serial-only −2000, stable ties);
arg-mode order (on-node-now at index 0 only and not a duplicate enum, enum
prefix, preset value-prefix|label-substring); applySuggestion as the single
splice; extractNodeValue that records nothing on ambiguity; deriveRecent via
longest-name resolution.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: `airtime.ts` — round-trip estimate

**Files:**
- Create: `src/renderer/panels/repeater-admin/cli/lib/airtime.ts`
- Create: `tests/unit/renderer/panels/repeater-admin/cli/airtime.test.ts`

**Interfaces:**
- Consumes: `loraAirtimeMs` (`src/renderer/lib/airtime.ts`), `RadioSettings` (`src/shared/types.ts`).
- Produces (from §2.4):
  ```ts
  function cliRoundTrip(command: string, radio: RadioSettings | null | undefined, hops: number, noReply: boolean): { ms: number; label: string };
  ```
  **Deviation flagged:** the §2.4 signature block writes `radio: RadioSettings`, but the §2.4 prose and §11 both require an *absent* radio to render `'—'`. `RadioSettings` cannot express "absent", so the parameter is widened to `RadioSettings | null | undefined`. Prose wins over the signature; call it out in the task report.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/renderer/panels/repeater-admin/cli/airtime.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { loraAirtimeMs } from '@/lib/airtime';
import { cliRoundTrip } from '@/panels/repeater-admin/cli/lib/airtime';
import type { RadioSettings } from '../../../../../../src/shared/types';

const settings = (over: Partial<RadioSettings> = {}): RadioSettings => ({
  frequencyHz: 915_000_000,
  bandwidthHz: 250_000,
  spreadingFactor: 11,
  codingRate: 5,
  txPowerDbm: 20,
  repeatMode: false,
  pathHashMode: 1,
  ...over,
});

describe('cliRoundTrip', () => {
  it('renders — and ms 0 when radioSettings is absent', () => {
    expect(cliRoundTrip('ver', null, 1, false)).toEqual({ ms: 0, label: '—' });
    expect(cliRoundTrip('ver', undefined, 1, false)).toEqual({ ms: 0, label: '—' });
  });

  it('adds the +32 wrapper overhead to each leg', () => {
    const s = settings();
    // Empty command, one hop, no reply → outbound leg only = loraAirtimeMs(0+32).
    expect(cliRoundTrip('', s, 1, true).ms).toBeCloseTo(loraAirtimeMs(32, s), 6);
    // With a reply → + loraAirtimeMs(160+32).
    expect(cliRoundTrip('', s, 1, false).ms).toBeCloseTo(loraAirtimeMs(32, s) + loraAirtimeMs(192, s), 6);
  });

  it('counts only the outbound leg when noReply is true', () => {
    const s = settings();
    expect(cliRoundTrip('reboot', s, 2, true).ms).toBeLessThan(cliRoundTrip('reboot', s, 2, false).ms);
  });

  it('multiplies every leg by hop count', () => {
    const s = settings();
    expect(cliRoundTrip('ver', s, 2, false).ms).toBeCloseTo(cliRoundTrip('ver', s, 1, false).ms * 2, 6);
  });

  it('floors hops at 1 so an unfloored 0 is not ~0.0 s', () => {
    const s = settings();
    expect(cliRoundTrip('ver', s, 0, false).ms).toBe(cliRoundTrip('ver', s, 1, false).ms);
  });

  it('labels with one decimal below 10 s and rounds at or above 10 s', () => {
    const small = cliRoundTrip('ver', settings({ spreadingFactor: 7, bandwidthHz: 250_000 }), 1, true);
    expect(small.label).toMatch(/^~\d+\.\d s$/);
    const big = cliRoundTrip('neighbors', settings({ spreadingFactor: 12, bandwidthHz: 7_800 }), 6, false);
    expect(big.label).toMatch(/^~\d+ s$/); // no decimal
  });
});
```

- [ ] **Step 2: Run the test — expect failure**

Run: `npx vitest run --project unit tests/unit/renderer/panels/repeater-admin/cli/airtime.test.ts`
Expected: FAIL — cannot resolve `@/panels/repeater-admin/cli/lib/airtime`.

- [ ] **Step 3: Create `airtime.ts`**

```ts
// Round-trip airtime estimate. Wraps loraAirtimeMs following the shipped caller
// (Composer.tsx:106, which adds `+ 32 /* rough wrapper overhead */`): the
// outbound leg is byteLength(command) + 32, the inbound leg is 160 + 32 (a
// single reply frame ≤160 B, §0), each multiplied by hop count since every hop
// retransmits. noReply counts the outbound leg only.
import type { RadioSettings } from '../../../../../shared/types';
import { loraAirtimeMs } from '../../../../lib/airtime';

const WRAPPER = 32;      // rough transport wrapper overhead (Composer.tsx:106)
const REPLY_BYTES = 160; // one reply frame ≤160 B (§0)

function byteLength(s: string): number {
  return new TextEncoder().encode(s).length;
}

export function cliRoundTrip(
  command: string,
  radio: RadioSettings | null | undefined,
  hops: number,
  noReply: boolean,
): { ms: number; label: string } {
  if (!radio) return { ms: 0, label: '—' };

  const legs = Math.max(1, hops);
  const out = loraAirtimeMs(byteLength(command) + WRAPPER, radio) * legs;
  const inbound = noReply ? 0 : loraAirtimeMs(REPLY_BYTES + WRAPPER, radio) * legs;
  const ms = out + inbound;
  if (ms <= 0) return { ms: 0, label: '—' };

  const secs = ms / 1000;
  const label = secs < 10 ? `~${secs.toFixed(1)} s` : `~${Math.round(secs)} s`;
  return { ms, label };
}
```

- [ ] **Step 4: Run the test — expect pass**

Run: `npx vitest run --project unit tests/unit/renderer/panels/repeater-admin/cli/airtime.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Typecheck and lint**

Run: `npx tsc --noEmit && npx biome check src tests`
Expected: both clean.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/panels/repeater-admin/cli/lib/airtime.ts tests/unit/renderer/panels/repeater-admin/cli/airtime.test.ts
git commit -m "feat(cli): cliRoundTrip airtime estimate

Wraps loraAirtimeMs with the +32 wrapper per leg, 160-byte reply frame,
per-hop multiplication and outbound-only for noReply. Floors hops at 1 and
renders — for an absent radio (parameter widened to RadioSettings|null per
the §2.4 prose). Label: one decimal below 10 s, rounded above.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 10: `queue.ts` — CliEntry + FIFO transitions

**Files:**
- Create: `src/renderer/panels/repeater-admin/cli/lib/queue.ts`
- Create: `tests/unit/renderer/panels/repeater-admin/cli/queue.test.ts`

**Interfaces:**
- Consumes: `CliCommand` (catalog).
- Produces (verbatim §2.5):
  ```ts
  type CliEntryState = 'queued'|'sending'|'ok'|'error'|'timeout'|'sent'|'cancelled';
  interface CliEntry { id; text; cmd: CliCommand | null; state; queuedAt; startedAt: number|null; endedAt: number|null; reply: string|null; error: { kind:'refused'|'timeout'|'transport'|'superseded'; message } | null }
  interface CliQueueState { entries: CliEntry[] }
  function enqueue(s, e): CliQueueState;
  function beginNext(s): { state: CliQueueState; next: CliEntry | null };
  function settle(s, id, patch: Partial<CliEntry>): CliQueueState;
  function cancel(s, id): CliQueueState;
  function abortAll(s): CliQueueState;
  ```
  Plus a helper: `historyStatusFor(e: CliEntry): 'ok'|'error'|'timeout'|'sent'|null` — `null` for non-terminal and `cancelled` entries, so a cancelled entry never reaches history (§2.5).

- [ ] **Step 1: Write the failing test**

Create `tests/unit/renderer/panels/repeater-admin/cli/queue.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { abortAll, beginNext, cancel, enqueue, historyStatusFor, settle } from '@/panels/repeater-admin/cli/lib/queue';
import type { CliEntry, CliQueueState } from '@/panels/repeater-admin/cli/lib/queue';

let seq = 0;
const entry = (over: Partial<CliEntry> = {}): CliEntry => ({
  id: `e${seq++}`,
  text: 'ver',
  cmd: null,
  state: 'queued',
  queuedAt: 0,
  startedAt: null,
  endedAt: null,
  reply: null,
  error: null,
  ...over,
});

const state = (entries: CliEntry[]): CliQueueState => ({ entries });

describe('queue transitions', () => {
  it('enqueue appends in order', () => {
    const s = enqueue(enqueue(state([]), entry({ id: 'a' })), entry({ id: 'b' }));
    expect(s.entries.map((e) => e.id)).toEqual(['a', 'b']);
  });

  it('beginNext promotes the earliest queued entry to sending', () => {
    const { state: s, next } = beginNext(state([entry({ id: 'a' }), entry({ id: 'b' })]));
    expect(next?.id).toBe('a');
    expect(s.entries[0].state).toBe('sending');
    expect(s.entries[0].startedAt).toEqual(expect.any(Number));
    expect(s.entries[1].state).toBe('queued');
  });

  it('beginNext returns null while an entry is already sending (one-at-a-time)', () => {
    const { next } = beginNext(state([entry({ id: 'a', state: 'sending' }), entry({ id: 'b' })]));
    expect(next).toBeNull();
  });

  it('beginNext returns null when nothing is queued', () => {
    expect(beginNext(state([entry({ id: 'a', state: 'ok' })])).next).toBeNull();
  });

  it('settle patches an entry by id', () => {
    const s = settle(state([entry({ id: 'a', state: 'sending' })]), 'a', { state: 'ok', reply: 'pong', endedAt: 5 });
    expect(s.entries[0]).toMatchObject({ state: 'ok', reply: 'pong', endedAt: 5 });
  });

  it('cancel moves a queued entry to cancelled and leaves others alone', () => {
    const s = cancel(state([entry({ id: 'a', state: 'sending' }), entry({ id: 'b' })]), 'b');
    expect(s.entries[0].state).toBe('sending');
    expect(s.entries[1].state).toBe('cancelled');
  });

  it('cancel is a no-op on a non-queued entry', () => {
    const s = cancel(state([entry({ id: 'a', state: 'sending' })]), 'a');
    expect(s.entries[0].state).toBe('sending');
  });

  it('abortAll cancels the sending entry too, so beginNext recovers', () => {
    const aborted = abortAll(state([entry({ id: 'a', state: 'sending' }), entry({ id: 'b' })]));
    expect(aborted.entries[0].state).toBe('cancelled');
    expect(aborted.entries[0].error).toEqual({ kind: 'transport', message: expect.any(String) });
    expect(aborted.entries[1].state).toBe('cancelled');
    // Nothing is left sending, so the queue is not wedged.
    expect(beginNext(aborted).next).toBeNull();
  });

  it('abortAll leaves terminal entries untouched', () => {
    const s = abortAll(state([entry({ id: 'a', state: 'ok' })]));
    expect(s.entries[0].state).toBe('ok');
  });

  it('excludes cancelled and non-terminal entries from history', () => {
    expect(historyStatusFor(entry({ state: 'ok' }))).toBe('ok');
    expect(historyStatusFor(entry({ state: 'sent' }))).toBe('sent');
    expect(historyStatusFor(entry({ state: 'cancelled' }))).toBeNull();
    expect(historyStatusFor(entry({ state: 'queued' }))).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test — expect failure**

Run: `npx vitest run --project unit tests/unit/renderer/panels/repeater-admin/cli/queue.test.ts`
Expected: FAIL — cannot resolve `@/panels/repeater-admin/cli/lib/queue`.

- [ ] **Step 3: Create `queue.ts`**

```ts
// Client-side FIFO in front of a library that allows exactly one outstanding
// CLI command per repeater. Pure and serialisable — the AbortController lives in
// a ref in CliTab (Phase 3), never in this state.
import type { CliCommand } from '../../../../../shared/repeater-cli/catalog';

export type CliEntryState = 'queued' | 'sending' | 'ok' | 'error' | 'timeout' | 'sent' | 'cancelled';

export interface CliEntry {
  id: string;
  text: string;                     // exactly what goes on the air
  cmd: CliCommand | null;           // resolved catalog entry, null if unknown
  state: CliEntryState;
  queuedAt: number;
  startedAt: number | null;
  endedAt: number | null;
  reply: string | null;
  error: { kind: 'refused' | 'timeout' | 'transport' | 'superseded'; message: string } | null;
}

export interface CliQueueState {
  entries: CliEntry[];
}

const TERMINAL = new Set<CliEntryState>(['ok', 'error', 'timeout', 'sent', 'cancelled']);

export function enqueue(s: CliQueueState, e: CliEntry): CliQueueState {
  return { entries: [...s.entries, e] };
}

/** Promote the earliest queued entry to `sending`, unless one is already
 *  sending — the invariant that keeps the library from ever seeing two
 *  outstanding commands. */
export function beginNext(s: CliQueueState): { state: CliQueueState; next: CliEntry | null } {
  if (s.entries.some((e) => e.state === 'sending')) return { state: s, next: null };
  const idx = s.entries.findIndex((e) => e.state === 'queued');
  if (idx === -1) return { state: s, next: null };
  const next: CliEntry = { ...s.entries[idx], state: 'sending', startedAt: Date.now() };
  return { state: { entries: s.entries.map((e, i) => (i === idx ? next : e)) }, next };
}

export function settle(s: CliQueueState, id: string, patch: Partial<CliEntry>): CliQueueState {
  return { entries: s.entries.map((e) => (e.id === id ? { ...e, ...patch } : e)) };
}

/** Move a QUEUED entry to cancelled. A sending entry is left alone — use
 *  abortAll for that. */
export function cancel(s: CliQueueState, id: string): CliQueueState {
  return {
    entries: s.entries.map((e) => (e.id === id && e.state === 'queued' ? { ...e, state: 'cancelled', endedAt: Date.now() } : e)),
  };
}

/** Move EVERY non-terminal entry, including the sending one, to cancelled.
 *  Leaving an aborted entry in `sending` would make beginNext return null
 *  forever and wedge the queue — the exact failure this change removes. */
export function abortAll(s: CliQueueState): CliQueueState {
  return {
    entries: s.entries.map((e) =>
      TERMINAL.has(e.state)
        ? e
        : { ...e, state: 'cancelled', endedAt: Date.now(), error: { kind: 'transport', message: 'aborted' } },
    ),
  };
}

/** The history status for an entry, or null when it must not be recorded. A
 *  cancelled entry stays in the transcript and is NOT added to history (§2.5). */
export function historyStatusFor(e: CliEntry): 'ok' | 'error' | 'timeout' | 'sent' | null {
  switch (e.state) {
    case 'ok':
    case 'error':
    case 'timeout':
    case 'sent':
      return e.state;
    default:
      return null;
  }
}
```

- [ ] **Step 4: Run the test — expect pass**

Run: `npx vitest run --project unit tests/unit/renderer/panels/repeater-admin/cli/queue.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 5: Typecheck and lint**

Run: `npx tsc --noEmit && npx biome check src tests`
Expected: both clean.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/panels/repeater-admin/cli/lib/queue.ts tests/unit/renderer/panels/repeater-admin/cli/queue.test.ts
git commit -m "feat(cli): FIFO queue with a one-outstanding invariant

beginNext returns null while an entry is sending; cancel handles queued
entries; abortAll cancels the sending entry too so beginNext recovers rather
than wedging. historyStatusFor keeps cancelled and non-terminal entries out
of history.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 11: `persistence.ts` — history ring + reboot-pending

**Files:**
- Create: `src/renderer/panels/repeater-admin/cli/lib/persistence.ts`
- Create: `tests/unit/renderer/panels/repeater-admin/cli/persistence.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces (verbatim §2.6 + §6):
  ```ts
  interface CliHistoryEntry { text: string; status: 'ok' | 'error' | 'timeout' | 'sent' }
  interface RebootPending { settings: { label: string; verify: string | null }[]; dismissed: boolean; rebootSentAtMs: number | null }
  const HISTORY_CAP = 200;
  function loadHistory(pubkeyHex: string, storage?: Storage): CliHistoryEntry[];
  function saveHistory(pubkeyHex: string, h: CliHistoryEntry[], storage?: Storage): void;
  function loadPendingReboot(pubkeyHex: string, storage?: Storage): RebootPending;
  function savePendingReboot(pubkeyHex: string, p: RebootPending, storage?: Storage): void;
  function pushHistory(h: CliHistoryEntry[], entry: CliHistoryEntry): CliHistoryEntry[];   // collapse consecutive dup, cap 200 front-trim
  function patchLastStatus(h: CliHistoryEntry[], status: CliHistoryEntry['status']): CliHistoryEntry[];
  ```
  `storage` defaults to `globalThis.localStorage` and is injectable — the `unit` project runs in `environment: 'node'` with no `localStorage`, so without injection every test would silently exercise only the degraded path and pass green (`vitest.config.ts:29–31`). `RebootPending` is defined here because Phase 1's persistence is its only producer/consumer; Phase 2's `RebootPending.tsx` imports it from here.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/renderer/panels/repeater-admin/cli/persistence.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import {
  loadHistory,
  loadPendingReboot,
  patchLastStatus,
  pushHistory,
  saveHistory,
  savePendingReboot,
} from '@/panels/repeater-admin/cli/lib/persistence';
import type { CliHistoryEntry } from '@/panels/repeater-admin/cli/lib/persistence';

// A minimal in-memory Storage so the node-env test exercises the REAL path,
// not the degraded no-storage fallback.
class MemStorage implements Storage {
  private map = new Map<string, string>();
  get length() { return this.map.size; }
  clear() { this.map.clear(); }
  getItem(k: string) { return this.map.has(k) ? (this.map.get(k) as string) : null; }
  key(i: number) { return [...this.map.keys()][i] ?? null; }
  removeItem(k: string) { this.map.delete(k); }
  setItem(k: string, v: string) { this.map.set(k, v); }
}

const PK = 'abcdef0123456789';
let store: MemStorage;
beforeEach(() => {
  store = new MemStorage();
});

describe('history persistence', () => {
  it('round-trips oldest-first against an injected Storage', () => {
    const h: CliHistoryEntry[] = [{ text: 'ver', status: 'ok' }, { text: 'get radio', status: 'ok' }];
    saveHistory(PK, h, store);
    expect(loadHistory(PK, store)).toEqual(h);
  });

  it('is keyed per pubkey', () => {
    saveHistory(PK, [{ text: 'ver', status: 'ok' }], store);
    expect(loadHistory('other', store)).toEqual([]);
  });

  it('returns [] for absent or corrupt storage entries', () => {
    expect(loadHistory(PK, store)).toEqual([]);
    store.setItem('coresense.cli.history.' + PK, '{not json');
    expect(loadHistory(PK, store)).toEqual([]);
  });
});

describe('pushHistory', () => {
  it('appends at the end (oldest-first)', () => {
    const h = pushHistory([{ text: 'ver', status: 'ok' }], { text: 'board', status: 'ok' });
    expect(h.map((e) => e.text)).toEqual(['ver', 'board']);
  });

  it('collapses a consecutive duplicate rather than adding a second row', () => {
    const h = pushHistory([{ text: 'ver', status: 'ok' }], { text: 'ver', status: 'error' });
    expect(h).toEqual([{ text: 'ver', status: 'error' }]);
  });

  it('trims from the front at the 200 cap', () => {
    let h: CliHistoryEntry[] = [];
    for (let i = 0; i < 205; i++) h = pushHistory(h, { text: `c${i}`, status: 'ok' });
    expect(h.length).toBe(200);
    expect(h[0].text).toBe('c5'); // the five oldest were trimmed
    expect(h[199].text).toBe('c204');
  });
});

describe('patchLastStatus', () => {
  it('patches the newest entry, leaving the rest', () => {
    const h = patchLastStatus([{ text: 'a', status: 'sent' }, { text: 'b', status: 'sent' }], 'ok');
    expect(h).toEqual([{ text: 'a', status: 'sent' }, { text: 'b', status: 'ok' }]);
  });

  it('is a no-op on an empty history', () => {
    expect(patchLastStatus([], 'ok')).toEqual([]);
  });
});

describe('reboot-pending persistence', () => {
  it('defaults to an empty, non-dismissed, not-rebooting state', () => {
    expect(loadPendingReboot(PK, store)).toEqual({ settings: [], dismissed: false, rebootSentAtMs: null });
  });

  it('round-trips', () => {
    const p = { settings: [{ label: 'radio', verify: 'get radio' }], dismissed: true, rebootSentAtMs: 123 };
    savePendingReboot(PK, p, store);
    expect(loadPendingReboot(PK, store)).toEqual(p);
  });
});

describe('degraded storage', () => {
  it('a throwing Storage degrades to session-only rather than crashing', () => {
    const boom: Storage = {
      length: 0, clear() {}, key() { return null; },
      getItem() { throw new Error('nope'); },
      setItem() { throw new Error('nope'); },
      removeItem() {},
    };
    expect(loadHistory(PK, boom)).toEqual([]);
    expect(() => saveHistory(PK, [{ text: 'ver', status: 'ok' }], boom)).not.toThrow();
    expect(loadPendingReboot(PK, boom)).toEqual({ settings: [], dismissed: false, rebootSentAtMs: null });
  });
});
```

- [ ] **Step 2: Run the test — expect failure**

Run: `npx vitest run --project unit tests/unit/renderer/panels/repeater-admin/cli/persistence.test.ts`
Expected: FAIL — cannot resolve `@/panels/repeater-admin/cli/lib/persistence`.

- [ ] **Step 3: Create `persistence.ts`**

```ts
// Per-repeater history ring and reboot-pending, keyed by contact.publicKeyHex —
// named explicitly because "pubkey" is ambiguous (Contact.key 'c:<hex>', the
// library's 12-char prefix, or the full hex), and CliTab and RebootPending
// picking differently would silently split the two stores.
//
// `storage` is injectable and defaults to globalThis.localStorage. The unit
// project runs in environment:'node' with no localStorage, so a test that did
// not inject a fake would silently exercise only the degraded path and pass.

export interface CliHistoryEntry {
  text: string;
  status: 'ok' | 'error' | 'timeout' | 'sent';
}

export interface RebootPending {
  settings: { label: string; verify: string | null }[];
  dismissed: boolean;
  rebootSentAtMs: number | null;   // persisted, unlike the mockup's transient flag
}

export const HISTORY_CAP = 200;

const historyKey = (pk: string) => `coresense.cli.history.${pk}`;
const rebootKey = (pk: string) => `coresense.cli.pendingReboot.${pk}`;
const DEFAULT_REBOOT: RebootPending = { settings: [], dismissed: false, rebootSentAtMs: null };

function resolveStorage(storage?: Storage): Storage | null {
  try {
    return storage ?? globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export function loadHistory(pubkeyHex: string, storage?: Storage): CliHistoryEntry[] {
  const s = resolveStorage(storage);
  if (!s) return [];
  try {
    const raw = s.getItem(historyKey(pubkeyHex));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as CliHistoryEntry[]) : [];
  } catch {
    return [];
  }
}

export function saveHistory(pubkeyHex: string, h: CliHistoryEntry[], storage?: Storage): void {
  const s = resolveStorage(storage);
  if (!s) return;
  try {
    s.setItem(historyKey(pubkeyHex), JSON.stringify(h.slice(-HISTORY_CAP)));
  } catch {
    // degrade to session-only
  }
}

export function loadPendingReboot(pubkeyHex: string, storage?: Storage): RebootPending {
  const s = resolveStorage(storage);
  if (!s) return { ...DEFAULT_REBOOT };
  try {
    const raw = s.getItem(rebootKey(pubkeyHex));
    if (!raw) return { ...DEFAULT_REBOOT };
    const p = JSON.parse(raw) as Partial<RebootPending>;
    return {
      settings: Array.isArray(p.settings) ? p.settings : [],
      dismissed: !!p.dismissed,
      rebootSentAtMs: typeof p.rebootSentAtMs === 'number' ? p.rebootSentAtMs : null,
    };
  } catch {
    return { ...DEFAULT_REBOOT };
  }
}

export function savePendingReboot(pubkeyHex: string, p: RebootPending, storage?: Storage): void {
  const s = resolveStorage(storage);
  if (!s) return;
  try {
    s.setItem(rebootKey(pubkeyHex), JSON.stringify(p));
  } catch {
    // degrade to session-only
  }
}

/** Push on submit (so ↑ recalls what you just ran). Consecutive duplicates
 *  collapse; the 200-entry cap trims from the front. Oldest-first. */
export function pushHistory(h: CliHistoryEntry[], entry: CliHistoryEntry): CliHistoryEntry[] {
  const last = h[h.length - 1];
  const next = last && last.text === entry.text ? [...h.slice(0, -1), entry] : [...h, entry];
  return next.length > HISTORY_CAP ? next.slice(next.length - HISTORY_CAP) : next;
}

/** Patch the newest entry's status — the settle half of push-on-submit. */
export function patchLastStatus(h: CliHistoryEntry[], status: CliHistoryEntry['status']): CliHistoryEntry[] {
  if (h.length === 0) return h;
  return [...h.slice(0, -1), { ...h[h.length - 1], status }];
}
```

- [ ] **Step 4: Run the test — expect pass**

Run: `npx vitest run --project unit tests/unit/renderer/panels/repeater-admin/cli/persistence.test.ts`
Expected: PASS, 11 tests.

- [ ] **Step 5: Typecheck and lint**

Run: `npx tsc --noEmit && npx biome check src tests`
Expected: both clean. (This is also the point at which `suggest.ts` from Task 8 resolves `./persistence` cleanly — if you followed the recommended 11-before-8 ordering, disregard.)

- [ ] **Step 6: Commit**

```bash
git add src/renderer/panels/repeater-admin/cli/lib/persistence.ts tests/unit/renderer/panels/repeater-admin/cli/persistence.test.ts
git commit -m "feat(cli): per-pubkey history ring + reboot-pending persistence

Keyed by contact.publicKeyHex over an injectable Storage (default
globalThis.localStorage) so the node-env test drives the real path. History
is oldest-first, push-on-submit with consecutive-dup collapse and a 200-cap
front-trim; every access try/catch-degrades to session-only. RebootPending
lives here, its only Phase 1 producer/consumer.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 12: `promptReducer.ts` — the keyboard state machine

**Files:**
- Create: `src/renderer/panels/repeater-admin/cli/lib/promptReducer.ts`
- Create: `tests/unit/renderer/panels/repeater-admin/cli/promptReducer.test.ts`

**Interfaces:**
- Consumes: `CliCommand` (catalog); `parseCliLine`, `resolveCommand` (parse); `suggest`, `applySuggestion`, `CliSuggestCtx`, `CliSuggestion` (suggest); `commonPrefix` (match); `CliHistoryEntry`, `pushHistory`, `patchLastStatus` (persistence).
- Produces (verbatim §3):
  ```ts
  interface CliPromptState { value; caret; history; histIndex; draft; manualOpen; dismissed; navigated; activeId; rsearch: { query; index; restore } | null; confirmPending: { text; cmd: CliCommand } | null; ctx: CliSuggestCtx }
  type CliEffect = { kind: 'submit'; text: string } | { kind: 'clearTranscript' };
  function cliPromptReducer(s: CliPromptState, a: CliPromptAction): { state: CliPromptState; effect?: CliEffect };
  ```
  Plus the `CliPromptAction` union (every §3.1 key + every §3 non-key action), and derived-view helpers `initialPromptState`, `paletteItems`, `isPaletteOpen`, `ghostSuffix`, `rsearchView` (all pure).

- [ ] **Step 1: Write the failing test**

Create `tests/unit/renderer/panels/repeater-admin/cli/promptReducer.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  cliPromptReducer,
  ghostSuffix,
  initialPromptState,
  isPaletteOpen,
  paletteItems,
  rsearchView,
} from '@/panels/repeater-admin/cli/lib/promptReducer';
import type { CliPromptAction, CliPromptState } from '@/panels/repeater-admin/cli/lib/promptReducer';

// Fold a sequence of actions, returning the final state and the LAST effect.
function run(start: CliPromptState, ...actions: CliPromptAction[]) {
  let state = start;
  let effect: ReturnType<typeof cliPromptReducer>['effect'];
  for (const a of actions) {
    const r = cliPromptReducer(state, a);
    state = r.state;
    effect = r.effect;
  }
  return { state, effect };
}

const withHistory = (texts: string[]): CliPromptState => ({
  ...initialPromptState(),
  history: texts.map((text) => ({ text, status: 'ok' as const })),
});

describe('typing and visibility', () => {
  it('a value change clears dismissed/manualOpen and resets navigation/history index', () => {
    const s = run(initialPromptState(), { kind: 'value/change', value: 'ver', caret: 3 }).state;
    expect(s.value).toBe('ver');
    expect(isPaletteOpen(s)).toBe(true);
    expect(s.navigated).toBe(false);
    expect(s.histIndex).toBe(-1);
    expect(s.activeId).toBe(paletteItems(s)[0].id); // activeId invariant
  });

  it('the palette is closed on an empty line but ⌃Space browses it open', () => {
    expect(isPaletteOpen(initialPromptState())).toBe(false);
    const s = run(initialPromptState(), { kind: 'key/ctrlSpace' }).state;
    expect(s.manualOpen).toBe(true);
    expect(isPaletteOpen(s)).toBe(true);
  });

  it('⌃Space then Escape closes the palette (manualOpen cleared, dismissed set)', () => {
    const s = run(initialPromptState(), { kind: 'key/ctrlSpace' }, { kind: 'key/escape' }).state;
    expect(s.manualOpen).toBe(false);
    expect(s.dismissed).toBe(true);
    expect(isPaletteOpen(s)).toBe(false);
  });
});

describe('history recall', () => {
  it('↑↑ steps back twice — the first ↑ also sets dismissed so the second is history, not selection', () => {
    const base = { ...withHistory(['ver', 'board']), value: 'dr', caret: 2 };
    const one = run(base, { kind: 'key/arrowUp' }).state;
    expect(one.value).toBe('board'); // newest
    expect(one.draft).toBe('dr');
    expect(one.dismissed).toBe(true);
    const two = run(one, { kind: 'key/arrowUp' }).state;
    expect(two.value).toBe('ver'); // older
  });

  it('↓ past the newest restores the saved draft', () => {
    const base = { ...withHistory(['ver']), value: 'dr', caret: 2 };
    const up = run(base, { kind: 'key/arrowUp' }).state;
    const down = run(up, { kind: 'key/arrowDown' }).state;
    expect(down.value).toBe('dr');
    expect(down.histIndex).toBe(-1);
  });
});

describe('Tab and ghost', () => {
  it('Tab on a closed empty prompt opens the palette', () => {
    const s = run(initialPromptState(), { kind: 'key/tab' }).state;
    expect(isPaletteOpen(s)).toBe(true);
  });

  it('Tab completes to the common prefix', () => {
    const s = run({ ...initialPromptState(), value: 'set rad', caret: 7 }, { kind: 'key/tab' }).state;
    expect(s.value).toBe('set radio'); // shared prefix of set radio / set radio.rxgain
  });

  it('accepting the ghost appends only the suffix, preserving typed casing', () => {
    const s: CliPromptState = { ...initialPromptState(), value: 'SET r', caret: 5 };
    expect(ghostSuffix(s)).toBe('adio'); // top item 'set radio'
    const applied = run(s, { kind: 'key/acceptGhost' }).state;
    expect(applied.value).toBe('SET radio');
  });
});

describe('Enter', () => {
  it('applies the selection instead of running when the palette is open and navigated', () => {
    const open = { ...initialPromptState(), value: 've', caret: 2 };
    const nav = run(open, { kind: 'key/arrowDown' }).state; // navigated
    const { state, effect } = run(nav, { kind: 'key/enter' });
    expect(effect).toBeUndefined();
    expect(state.value.startsWith('v')).toBe(true);
  });

  it('Escape-then-Enter submits (navigated survives Escape, but open does not)', () => {
    const open = { ...initialPromptState(), value: 'ver', caret: 3 };
    const nav = run(open, { kind: 'key/arrowDown' }).state;
    const dismissed = run(nav, { kind: 'key/escape' }).state;
    expect(dismissed.navigated).toBe(true);
    const { effect } = run(dismissed, { kind: 'key/enter' });
    expect(effect).toEqual({ kind: 'submit', text: 'ver' });
  });

  it('a danger command routes to confirmPending instead of submitting', () => {
    const s = { ...initialPromptState(), value: 'reboot', caret: 6, dismissed: true };
    const { state, effect } = run(s, { kind: 'key/enter' });
    expect(effect).toBeUndefined();
    expect(state.confirmPending?.cmd.name).toBe('reboot');
    // confirm/cancel clears it.
    expect(run(state, { kind: 'confirm/cancel' }).state.confirmPending).toBeNull();
  });

  it('a plain command submits and clears the line', () => {
    const s = { ...initialPromptState(), value: 'ver', caret: 3, dismissed: true };
    const { state, effect } = run(s, { kind: 'key/enter' });
    expect(effect).toEqual({ kind: 'submit', text: 'ver' });
    expect(state.value).toBe('');
  });
});

describe('⌃L and non-key actions', () => {
  it('⌃L emits clearTranscript without touching state', () => {
    const { effect } = run(initialPromptState(), { kind: 'key/ctrlL' });
    expect(effect).toEqual({ kind: 'clearTranscript' });
  });

  it('line/set prefills without running (follow-up chip)', () => {
    const s = run(initialPromptState(), { kind: 'line/set', text: 'set radio 869.525,250,11,5' }).state;
    expect(s.value).toBe('set radio 869.525,250,11,5');
    expect(isPaletteOpen(s)).toBe(true);
  });

  it('item/apply applies a clicked row', () => {
    const s = { ...initialPromptState(), value: 'set ra', caret: 6 };
    const id = paletteItems(s).find((i) => i.label === 'set radio')?.id as string;
    const applied = run(s, { kind: 'item/apply', id }).state;
    expect(applied.value).toBe('set radio ');
  });

  it('history/push then history/patchStatus record and amend the newest line', () => {
    const pushed = run(initialPromptState(), { kind: 'history/push', entry: { text: 'ver', status: 'sent' } }).state;
    expect(pushed.history.at(-1)).toEqual({ text: 'ver', status: 'sent' });
    const patched = run(pushed, { kind: 'history/patchStatus', status: 'ok' }).state;
    expect(patched.history.at(-1)).toEqual({ text: 'ver', status: 'ok' });
  });

  it('ctx/setNodeValue and ctx/setRecent update the suggestion context', () => {
    const withNode = run(initialPromptState(), { kind: 'ctx/setNodeValue', key: 'radio', value: '869.525,250,11,5' }).state;
    expect(withNode.ctx.nodeValues.radio).toBe('869.525,250,11,5');
    const withRecent = run(withNode, { kind: 'ctx/setRecent', recent: ['ver'] }).state;
    expect(withRecent.ctx.recent).toEqual(['ver']);
  });
});

describe('reverse-i-search', () => {
  it('⌃R enters search saving the line; typing filters; Enter accepts and runs', () => {
    const base = { ...withHistory(['get radio', 'set tx 22', 'ver']), value: 'draft', caret: 5 };
    const entered = run(base, { kind: 'key/ctrlR' }).state;
    expect(entered.rsearch?.restore).toBe('draft');
    const typed = run(entered, { kind: 'rsearch/setQuery', query: 'tx' }).state;
    expect(rsearchView(typed).text).toBe('set tx 22');
    const { state, effect } = run(typed, { kind: 'key/enter' });
    expect(effect).toEqual({ kind: 'submit', text: 'set tx 22' });
    expect(state.rsearch).toBeNull();
  });

  it('⌃R clamps at the oldest match', () => {
    const base = withHistory(['radio a', 'radio b']); // both match 'radio'
    const s = run(base, { kind: 'key/ctrlR' }, { kind: 'rsearch/setQuery', query: 'radio' },
      { kind: 'key/ctrlR' }, { kind: 'key/ctrlR' }, { kind: 'key/ctrlR' }).state;
    // newest-first: index 0 = 'radio b', index 1 = 'radio a' (oldest), clamped there.
    expect(rsearchView(s).index).toBe(1);
    expect(rsearchView(s).text).toBe('radio a');
  });

  it('Escape aborts and restores the saved line', () => {
    const base = { ...withHistory(['ver']), value: 'draft', caret: 5 };
    const s = run(base, { kind: 'key/ctrlR' }, { kind: 'key/escape' }).state;
    expect(s.rsearch).toBeNull();
    expect(s.value).toBe('draft');
  });
});
```

- [ ] **Step 2: Run the test — expect failure**

Run: `npx vitest run --project unit tests/unit/renderer/panels/repeater-admin/cli/promptReducer.test.ts`
Expected: FAIL — cannot resolve `@/panels/repeater-admin/cli/lib/promptReducer`.

- [ ] **Step 3: Create `promptReducer.ts`**

```ts
// The pure reducer over everything the keyboard touches. Making the keyboard a
// pure function is what makes it exhaustively testable without a DOM — the
// tricky interactions (navigated changes what Enter does, dismissed is a latch
// not a mirror of visibility, the history index shadows a saved draft, and
// reverse-search is modal) all live here. The reducer returns an OPTIONAL
// effect for the two things it does not own (the queue and the transcript);
// CliTab applies it. It calls suggest() itself, so callers keep no derived list
// in sync.
import type { CliCommand } from '../../../../../shared/repeater-cli/catalog';
import { commonPrefix } from './match';
import { parseCliLine, resolveCommand } from './parse';
import { type CliHistoryEntry, patchLastStatus, pushHistory } from './persistence';
import { type CliSuggestCtx, type CliSuggestion, applySuggestion, suggest } from './suggest';

export interface CliPromptState {
  value: string;
  caret: number;
  history: CliHistoryEntry[];
  histIndex: number;          // -1 = not recalling
  draft: string;              // saved on the first ArrowUp
  manualOpen: boolean;
  dismissed: boolean;
  navigated: boolean;
  activeId: string;
  rsearch: { query: string; index: number; restore: string } | null;
  confirmPending: { text: string; cmd: CliCommand } | null;
  ctx: CliSuggestCtx;
}

export type CliEffect =
  | { kind: 'submit'; text: string }
  | { kind: 'clearTranscript' };

export type CliPromptAction =
  | { kind: 'value/change'; value: string; caret: number }
  | { kind: 'caret/set'; caret: number }
  | { kind: 'key/ctrlSpace' }
  | { kind: 'key/arrowUp' }
  | { kind: 'key/arrowDown' }
  | { kind: 'key/tab' }
  | { kind: 'key/acceptGhost' }        // → / End
  | { kind: 'key/enter' }
  | { kind: 'key/escape' }
  | { kind: 'key/ctrlR' }
  | { kind: 'key/ctrlG' }
  | { kind: 'key/ctrlL' }
  | { kind: 'item/apply'; id: string }
  | { kind: 'line/set'; text: string }
  | { kind: 'history/loaded'; history: CliHistoryEntry[] }
  | { kind: 'history/push'; entry: CliHistoryEntry }
  | { kind: 'history/patchStatus'; status: CliHistoryEntry['status'] }
  | { kind: 'ctx/setNodeValue'; key: string; value: string }
  | { kind: 'ctx/setRecent'; recent: string[] }
  | { kind: 'rsearch/setQuery'; query: string }
  | { kind: 'confirm/cancel' };

export function initialPromptState(ctx?: Partial<CliSuggestCtx>): CliPromptState {
  return {
    value: '', caret: 0, history: [], histIndex: -1, draft: '',
    manualOpen: false, dismissed: false, navigated: false, activeId: '',
    rsearch: null, confirmPending: null,
    ctx: { recent: ctx?.recent ?? [], nodeValues: ctx?.nodeValues ?? {} },
  };
}

export function paletteItems(s: CliPromptState): CliSuggestion[] {
  return suggest(s.value, s.caret, s.ctx).items;
}

/** Derived, never stored. No `items.length > 0` term — a zero-item palette must
 *  still render §4.1's "press ↵ to send it raw" hint. */
export function isPaletteOpen(s: CliPromptState): boolean {
  return (s.manualOpen || (s.value.trim() !== '' && !s.dismissed)) && !s.rsearch && !s.confirmPending;
}

/** activeId invariant: whenever the item list changes and navigated is false,
 *  activeId is items[0].id. Nothing else initialises it. */
function reselect(s: CliPromptState): CliPromptState {
  if (s.navigated) return s;
  return { ...s, activeId: paletteItems(s)[0]?.id ?? '' };
}

/** The ghost suffix: rendered only when the caret is at end and the top item's
 *  label prefix-matches the current token case-insensitively. Accepting appends
 *  only the suffix, preserving typed casing. */
export function ghostSuffix(s: CliPromptState): string {
  if (!isPaletteOpen(s) || s.caret !== s.value.length) return '';
  const top = paletteItems(s)[0];
  if (!top) return '';
  const token = parseCliLine(s.value, s.caret).token;
  if (top.label.length > token.length && top.label.toLowerCase().startsWith(token.toLowerCase())) {
    return top.label.slice(token.length);
  }
  return '';
}

function rsearchMatches(history: CliHistoryEntry[], query: string): CliHistoryEntry[] {
  const q = query.toLowerCase();
  const out: CliHistoryEntry[] = [];
  for (let i = history.length - 1; i >= 0; i--) {
    if (!q || history[i].text.toLowerCase().includes(q)) out.push(history[i]);
  }
  return out;
}

export function rsearchView(s: CliPromptState): { text: string | null; index: number; total: number } {
  if (!s.rsearch) return { text: null, index: 0, total: 0 };
  const matches = rsearchMatches(s.history, s.rsearch.query);
  return { text: matches[s.rsearch.index]?.text ?? null, index: s.rsearch.index, total: matches.length };
}

function applyItem(s: CliPromptState, item: CliSuggestion): CliPromptState {
  const { value, caret } = applySuggestion(s.value, s.caret, item);
  const hasArgs = !!(item.cmd && (item.cmd.args || item.cmd.spec));
  // No-args → close; with-args → leave open so arg suggestions appear.
  return reselect({ ...s, value, caret, navigated: false, manualOpen: false, dismissed: !hasArgs, histIndex: -1 });
}

function clearLine(s: CliPromptState): CliPromptState {
  return { ...s, value: '', caret: 0, histIndex: -1, draft: '', navigated: false, manualOpen: false, dismissed: false, activeId: '' };
}

export function cliPromptReducer(s: CliPromptState, a: CliPromptAction): { state: CliPromptState; effect?: CliEffect } {
  switch (a.kind) {
    case 'value/change':
      return { state: reselect({ ...s, value: a.value, caret: a.caret, dismissed: false, manualOpen: false, histIndex: -1, navigated: false }) };

    case 'caret/set':
      return { state: reselect({ ...s, caret: a.caret }) };

    case 'key/ctrlSpace':
      return { state: reselect({ ...s, manualOpen: !s.manualOpen, dismissed: false, navigated: false }) };

    case 'key/arrowUp': {
      if (s.rsearch) return { state: s }; // modal — swallowed
      if (isPaletteOpen(s)) {
        const items = paletteItems(s);
        if (!items.length) return { state: s };
        const cur = items.findIndex((i) => i.id === s.activeId);
        return { state: { ...s, activeId: items[Math.max(0, cur - 1)].id, navigated: true } };
      }
      if (s.history.length === 0) return { state: s };
      const first = s.histIndex === -1;
      const index = Math.min(first ? 0 : s.histIndex + 1, s.history.length - 1);
      const entry = s.history[s.history.length - 1 - index];
      return { state: reselect({ ...s, value: entry.text, caret: entry.text.length, draft: first ? s.value : s.draft, histIndex: index, dismissed: true, navigated: false }) };
    }

    case 'key/arrowDown': {
      if (s.rsearch) return { state: s };
      if (isPaletteOpen(s)) {
        const items = paletteItems(s);
        if (!items.length) return { state: s };
        const cur = items.findIndex((i) => i.id === s.activeId);
        return { state: { ...s, activeId: items[Math.min(items.length - 1, cur + 1)].id, navigated: true } };
      }
      if (s.histIndex === -1) return { state: s };
      if (s.histIndex === 0) {
        return { state: reselect({ ...s, value: s.draft, caret: s.draft.length, histIndex: -1, navigated: false }) };
      }
      const index = s.histIndex - 1;
      const entry = s.history[s.history.length - 1 - index];
      return { state: reselect({ ...s, value: entry.text, caret: entry.text.length, histIndex: index, navigated: false }) };
    }

    case 'key/tab': {
      if (s.rsearch) {
        const { text } = rsearchView(s);
        if (text === null) return { state: { ...s, rsearch: null } };
        return { state: reselect({ ...s, value: text, caret: text.length, rsearch: null, navigated: false, dismissed: false }) };
      }
      if (!isPaletteOpen(s)) return { state: reselect({ ...s, manualOpen: true, dismissed: false, navigated: false }) };
      const items = paletteItems(s);
      if (items.length === 0) return { state: s };
      if (items.length === 1) return { state: applyItem(s, items[0]) };
      if (s.navigated) return { state: applyItem(s, items.find((i) => i.id === s.activeId) ?? items[0]) };
      const prefix = commonPrefix(items);
      const parse = parseCliLine(s.value, s.caret);
      if (prefix && prefix.length > parse.token.length) {
        const value = s.value.slice(0, parse.start) + prefix + s.value.slice(s.caret);
        return { state: reselect({ ...s, value, caret: parse.start + prefix.length, navigated: false }) };
      }
      return { state: { ...s, navigated: true } };
    }

    case 'key/acceptGhost': {
      if (s.rsearch) {
        const { text } = rsearchView(s);
        if (text === null) return { state: s };
        return { state: reselect({ ...s, value: text, caret: text.length, rsearch: null, navigated: false, dismissed: false }) };
      }
      const suffix = ghostSuffix(s);
      if (!suffix) return { state: s }; // caller falls through to native cursor move
      const value = s.value + suffix;
      return { state: reselect({ ...s, value, caret: value.length, navigated: false }) };
    }

    case 'key/enter': {
      if (s.rsearch) {
        const { text } = rsearchView(s);
        if (text === null) return { state: s };
        return { state: clearLine({ ...s, rsearch: null }), effect: { kind: 'submit', text } };
      }
      if (isPaletteOpen(s) && s.navigated) {
        const sel = paletteItems(s).find((i) => i.id === s.activeId);
        return { state: sel ? applyItem(s, sel) : s };
      }
      const text = s.value.trim();
      if (text === '') return { state: s };
      const cmd = resolveCommand(text);
      if (cmd?.danger) return { state: { ...s, confirmPending: { text, cmd } } };
      return { state: clearLine(s), effect: { kind: 'submit', text } };
    }

    case 'key/escape': {
      if (s.confirmPending) return { state: { ...s, confirmPending: null } };
      if (s.rsearch) return { state: reselect({ ...s, value: s.rsearch.restore, caret: s.rsearch.restore.length, rsearch: null }) };
      if (isPaletteOpen(s)) return { state: { ...s, manualOpen: false, dismissed: true } };
      return { state: { ...s, value: '', caret: 0, histIndex: -1, navigated: false } };
    }

    case 'key/ctrlR': {
      if (s.rsearch) {
        const total = rsearchMatches(s.history, s.rsearch.query).length;
        if (total === 0) return { state: s };
        return { state: { ...s, rsearch: { ...s.rsearch, index: Math.min(s.rsearch.index + 1, total - 1) } } };
      }
      return { state: { ...s, rsearch: { query: '', index: 0, restore: s.value } } };
    }

    case 'key/ctrlG':
      if (!s.rsearch) return { state: s };
      return { state: reselect({ ...s, value: s.rsearch.restore, caret: s.rsearch.restore.length, rsearch: null }) };

    case 'key/ctrlL':
      return { state: s, effect: { kind: 'clearTranscript' } };

    case 'item/apply': {
      const item = paletteItems(s).find((i) => i.id === a.id);
      return { state: item ? applyItem(s, item) : s };
    }

    case 'line/set':
      return { state: reselect({ ...s, value: a.text, caret: a.text.length, histIndex: -1, navigated: false, dismissed: false, manualOpen: false }) };

    case 'history/loaded':
      return { state: { ...s, history: a.history, histIndex: -1 } };

    case 'history/push':
      return { state: { ...s, history: pushHistory(s.history, a.entry), histIndex: -1 } };

    case 'history/patchStatus':
      return { state: { ...s, history: patchLastStatus(s.history, a.status) } };

    case 'ctx/setNodeValue':
      return { state: reselect({ ...s, ctx: { ...s.ctx, nodeValues: { ...s.ctx.nodeValues, [a.key]: a.value } } }) };

    case 'ctx/setRecent':
      return { state: reselect({ ...s, ctx: { ...s.ctx, recent: a.recent } }) };

    case 'rsearch/setQuery':
      if (!s.rsearch) return { state: s };
      return { state: { ...s, rsearch: { ...s.rsearch, query: a.query, index: 0 } } };

    case 'confirm/cancel':
      return { state: { ...s, confirmPending: null } };
  }
}
```

- [ ] **Step 4: Run the test — expect pass**

Run: `npx vitest run --project unit tests/unit/renderer/panels/repeater-admin/cli/promptReducer.test.ts`
Expected: PASS, ~20 tests covering every §3.1 key row and every §3 non-key action.

- [ ] **Step 5: Run the whole `unit` project, typecheck, and lint**

Run: `npx vitest run --project unit && npx tsc --noEmit && npx biome check src tests`
Expected: all green — every Phase 1 module and the catalog test pass together; typecheck and Biome clean over `src tests`.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/panels/repeater-admin/cli/lib/promptReducer.ts tests/unit/renderer/panels/repeater-admin/cli/promptReducer.test.ts
git commit -m "feat(cli): pure prompt reducer returning {state, effect?}

Every §3.1 key row and every §3 non-key action as a pure function calling
suggest() itself: ↑ sets the dismissed latch so ↑↑ steps back twice, Escape-
then-Enter submits (navigated survives Escape, open does not), ⌃Space+Escape
closes, danger routes to confirmPending, and reverse-search is modal with
clamp-at-oldest and abort-restores. Palette visibility and the activeId
invariant are derived, never stored.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Notes for the implementer

- **The spec is the authority.** Where this plan and `docs/superpowers/specs/2026-07-28-repeater-cli-autocomplete-design.md` disagree, the spec wins — and tell the reviewer, because it means the plan has a bug.
- **Firmware line numbers drift.** Every `CommonCLI.cpp:NNN` / `MyMeshRepeater.cpp:NNN` here was accurate at `2d7c9d8`. Locate a handler by its `memcmp(...)` string and its `sender_timestamp == 0` guard, not by line, and update the entry `note` if a cited line moved.
- **Two module-level widenings are deliberate**, made where the spec's own signature block contradicts its prose, and should be flagged in review, not "fixed": `commonPrefix`'s parameter (`{ label; serialOnly? }[]` so it can filter internally, per §2.2 prose) and `cliRoundTrip`'s `radio` (`RadioSettings | null | undefined` so an absent radio renders `'—'`, per §2.4 prose and §11).
- **Task 8 (`suggest`) imports `CliHistoryEntry` from Task 11 (`persistence`).** Execute Task 11 before Task 8, or the `suggest.ts` typecheck will fail on an unresolved `./persistence`. The logic order (6→7→8) reads better; the build order needs 11 first.
- **Nothing here mounts React or hits the network.** Every test is a `.ts` file under `tests/unit/` run by `--project unit` in `environment: 'node'`. Do not add a `.tsx` under `tests/unit/` — it will never run.
- **`Date.now()` in `queue.ts` and `beginNext`** is intentional and DOM-free; tests assert the state transition and that `startedAt`/`endedAt` are numbers, not a specific value.
