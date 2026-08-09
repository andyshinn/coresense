# Repeater CLI — Phase 3: Queue, No-Reply, and Abort Across the Transport — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Carry `expectReply` and `signal` through the transport chain — `api.ts` → `routes.ts` → `sessionAdapter.ts` — on the `@andyshinn/meshcore-ts@0.6.0` surface (`repeaterSendCli(contactKey, command, opts?: RepeaterCliOptions)`); classify a CLI outcome into the four `CliEntry.error.kind`s (`refused` / `timeout` / `superseded` / `transport`); wire phase 1's FIFO queue into phase 2's `CliTab` with one per-send `AbortController` that clears the main-process `pendingCli` on repeater switch/unmount instead of stranding it for the full 30-second timeout; and pin every branch with integration tests.

**Architecture:** The renderer never imports the library. `api.repeaterCli` posts `{ command, expectReply }` and forwards an `AbortSignal` through the `init` bag that `request()` already spreads into `fetch`; `request()` throws a typed `ApiError` carrying the HTTP status and the server's `code`, so the renderer classifies without re-parsing status text. The route maps the library's outcome to `202 { sent: true }` (no-reply), `200 { reply }`, `504 { code: 'cli_timeout' }` (reply timeout), or `503 { code: 'transport' }` (everything else, superseded included), forwarding the HTTP request's own `AbortSignal` so an aborted request deletes the `pendingCli` entry. A pure `send.ts` maps an api result-or-error into a `CliEntry` settle patch; `CliTab`'s drain effect owns one `AbortController` per send and aborts it from the same cleanup that calls `abortAll`. `sessionAdapter.ts` stays a thin pass-through, its third parameter typed off the library so it never drifts.

**Tech Stack:** Electron + React 19 + TypeScript, Tailwind v4 (`cs-*` tokens), zustand, shadcn/Radix primitives, Vitest (three projects: `unit` / `integration` / `dom`), Biome.

**Spec:** `docs/superpowers/specs/2026-07-28-repeater-cli-autocomplete-design.md`. Read it before starting — every section number referenced below (§5.1, §5.4, §7.1, §7.2, §11) points there. Where this plan and the spec disagree, the spec wins, and tell the reviewer, because it means the plan has a bug.

## Global Constraints

- **Worktree:** `/Users/andy/GitHub/andyshinn/coresense/.claude/worktrees/cli-autocomplete`, branch `worktree-cli-autocomplete`. Run every command from there.
- **Run tooling via `npx`, not `pnpm <script>`** — `pnpm` scripts reflink-fail in worktrees: `npx vitest run --project unit|integration|dom`, `npx tsc --noEmit`, `npx biome check src tests`.
- **Lint scope is `src tests`** — bare `npx biome check` fails on pre-existing `build/`, `dist/` and `out/` artifacts that are not ours.
- **Never use bare `git stash` / `git stash pop`** — the stash stack is shared across worktrees and sessions.
- **`@testing-library/jest-dom` is NOT installed** — assert with `toBeTruthy()` / `toBeNull()` / attribute and `className` reads, never `toBeInTheDocument()`.
- **A `.tsx` under `tests/unit/` never runs** — the vitest project split is by extension: `unit` = `*.test.ts` in `environment: 'node'`, `dom` = `tests/component/**/*.test.tsx`, `integration` = `tests/integration`.
- **Commit after every task** with conventional-commit prefixes (`feat:` / `fix:` / `refactor:` / `test:` / `style:` / `docs:`).
- **End every commit message with the trailer:** `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`.

**Dependency — READ THIS FIRST.** The `repeaterSendCli` widening this phase needs (`expectReply` + `signal`, §7.1) has shipped in `@andyshinn/meshcore-ts@0.6.0`: `repeaterSendCli(contactKey, command, opts?: RepeaterCliOptions): Promise<string>` with `RepeaterCliOptions { expectReply?; timeoutMs?; signal? }`, and `CLI_REPLY_TIMEOUT_MS` / `ADMIN_SENT_TIMEOUT_MS` / `ADMIN_REPLY_TIMEOUT_MS` are now exported. **This phase is no longer blocked.** **Task 1 bumps the floor to `^0.6.0`, installs, and reconciles the one regression the bump surfaces** — a relay-attribution change that touches `sendMessage.ts` and its `channel-relay-ack` fixture — then gates on a clean `npx tsc --noEmit` and a green full suite. Once Task 1 lands, **every task typechecks against the real surface**: Tasks 3, 4, and 6 call or exercise the three-argument method; **Tasks 2 and 5 do not touch the library at all** (Task 2 is renderer→HTTP only; Task 5's `send.ts` is pure, and its `CliTab` wiring calls `api.repeaterCli`, not the library). Do Task 1 first; do Tasks 2 and 5 whenever phases 1–2 are merged; Tasks 3, 4, 6 follow Task 1's bump.

**Line numbers drift.** Every `file.ts:NNN` here was accurate at `2d7c9d8`. Locate by symbol name, not by line.

---

## File Structure

**Create**

| File | Responsibility |
|---|---|
| `src/renderer/panels/repeater-admin/cli/lib/send.ts` | Pure map from an `api.repeaterCli` result-or-error to a `CliEntry` settle patch. No React, no store, no library. |
| `tests/unit/renderer/panels/repeater-admin/cli/send.test.ts` | The four §5.4 outcomes plus the no-reply `sent` and `Err -` refused branches. |

**Modify**

| File | Change |
|---|---|
| `src/renderer/lib/api.ts` | Add `class ApiError` + `parseServerErrorCode`; throw `ApiError` from `request()`; widen `repeaterCli` to accept `opts?: { expectReply?, signal? }` and return `{ ok:true; reply:string } \| { ok:true; sent:true }`. |
| `tests/unit/renderer/lib/api.test.ts` | Add `parseServerErrorCode`, `ApiError`, and `repeaterCli` cases (fetch-mocked, node env). |
| `src/main/api/routes.ts` | Rewrite the `POST /api/repeater/:key/cli` handler: accept `expectReply`, forward `c.req.raw.signal`, classify to `202` / `200` / `504 cli_timeout` / `503 transport`. |
| `src/main/protocol/sessionAdapter.ts` | Widen the `repeaterSendCli` pass-through with a third options parameter typed off the library. |
| `src/renderer/panels/repeater-admin/CliTab.tsx` | Wire phase 1's queue: a drain effect that sends via `api.repeaterCli` (with `expectReply:false` for `noReply` commands and an `AbortController` per send) and settles through `send.ts`; an unmount cleanup that aborts the live controller and calls `abortAll`. |
| `tests/integration/inbound/repeater-admin.test.ts` | Route-level `202`/`504`/`503` classification (Task 3, fake adapter via `setProtocolSession`); adapter-level `expectReply` true/false and the abort-clears-`pendingCli` case (Task 6, real loopback). |
| `package.json` | Raise the `@andyshinn/meshcore-ts` floor to `^0.6.0` (Task 1). |
| `src/main/messaging/sendMessage.ts` | Thread `sentAt`/`timestampUnix` from `sendChannelText` into `registerChannelSend` — 0.6.0's encrypted-timestamp relay matcher needs it (Task 1). |
| `tests/integration/outbound/channel-relay-ack.test.ts` | Rebuild the heard-relay fixture to replay a real GRP_TXT packet carrying the registered `timestampUnix` (Task 1). |

---

### Task 1: Raise `@andyshinn/meshcore-ts` to `^0.6.0` and reconcile the one regression

The `repeaterSendCli` widening this phase needs shipped in `@andyshinn/meshcore-ts@0.6.0`, so this task is **no longer a block** — it bumps the floor, installs, and reconciles the single regression the bump surfaces, then gates on a clean `npx tsc --noEmit` and a green full suite. The regression is a relay-attribution change: 0.6.0's heard-relay matcher matches on the packet's encrypted timestamp instead of a `channelHash` guess, so `sendMessage.ts` must thread `timestampUnix` (+ `sentAt`) from `sendChannelText` into `registerChannelSend`, and the `channel-relay-ack` fixture must replay a real GRP_TXT packet carrying that timestamp. Tasks 3/4/6 Consume the produced surface verbatim.

**Files:**
- Modify: `package.json`, `pnpm-lock.yaml` (raise the floor to `^0.6.0`)
- Modify: `src/main/messaging/sendMessage.ts` (thread `sentAt`/`timestampUnix` — the production half of the regression fix)
- Modify: `tests/integration/outbound/channel-relay-ack.test.ts` (rebuild the heard-relay fixture — the non-trivial half)

**Interfaces:**
- Consumes: nothing.
- Produces (the `@andyshinn/meshcore-ts@0.6.0` surface — Tasks 3/4/6 Consume it verbatim):
  ```ts
  // dist/index.d.ts:2335 — return type stays Promise<string>.
  repeaterSendCli(contactKey: string, command: string, opts?: RepeaterCliOptions): Promise<string>;

  // dist/index.d.ts:1234-1252
  interface RepeaterCliOptions { expectReply?: boolean; timeoutMs?: number; signal?: AbortSignal }

  // dist/index.d.ts:1434-1439 — also re-exported under the Models namespace.
  export const CLI_REPLY_TIMEOUT_MS = 30000;
  export const ADMIN_SENT_TIMEOUT_MS = 5000;
  export const ADMIN_REPLY_TIMEOUT_MS = 20000;
  ```
  Behaviour contract (verified against the published `dist/index.js`):
  1. `expectReply` defaults to `true` → registers a `pendingCli` entry keyed on `contact.publicKeyHex.slice(0, 12)`, arms a `CLI_REPLY_TIMEOUT_MS` (30 000 ms) timer, resolves with the reply text routed by sender prefix, rejects `new Error('CLI command timed out after 30000ms')` on timeout, and rejects `new Error('superseded by newer CLI command')` when a newer command displaces it (`dist/index.js:3963-3966`).
  2. `expectReply: false` → registers **no** reply awaiter, resolves `''` the moment the radio confirms the send (`RESP_SENT`), rejects on a definitive send failure. Its timer bounds send-confirmation and defaults to `ADMIN_SENT_TIMEOUT_MS` (5 000 ms), **not** `CLI_REPLY_TIMEOUT_MS`.
  3. `signal` → when it aborts while a reply is pending, the promise rejects with `signal.reason` and the abort handler **deletes** the `pendingCli` entry (`dist/index.js:3944-3945`), freeing the per-repeater slot instead of stranding it for the full timeout. It does not recall a send already on air. With `expectReply: false` the signal is a no-op — nothing is pending.
  4. `timeoutMs` overrides the wait; **no coresense call site sets it** (§7.1).
  5. `CLI_REPLY_TIMEOUT_MS` is exported so coresense derives §5.4's "no reply after 30 s" copy and the `504` timeout classification from the constant instead of hardcoding.

- [ ] **Step 1: Raise the floor and install**

Edit `package.json` — raise the dependency to the shipped release:
```json
    "@andyshinn/meshcore-ts": "^0.6.0",
```
Then, from the worktree:
```bash
pnpm install
```

- [ ] **Step 2: Verify the surface resolves**

Run:
```bash
grep -n "repeaterSendCli(contactKey" node_modules/@andyshinn/meshcore-ts/dist/index.d.ts
grep -n "RepeaterCliOptions\|CLI_REPLY_TIMEOUT_MS" node_modules/@andyshinn/meshcore-ts/dist/index.d.ts
node -e "console.log(require('@andyshinn/meshcore-ts/package.json').version)"
```
Expected: the signature shows the third `opts?: RepeaterCliOptions` parameter; `RepeaterCliOptions` and `CLI_REPLY_TIMEOUT_MS` appear in the type surface; the version prints `0.6.0`. `npx tsc --noEmit` is **not** clean yet — the bump surfaces one regression, fixed in Steps 3-4.

- [ ] **Step 3: Thread `timestampUnix`/`sentAt` through `sendMessage.ts` (the production fix)**

0.6.0's heard-relay matcher matches on the packet's encrypted timestamp, so a channel send must register the `timestampUnix` it went out with. `sendChannelText` now returns it and `registerChannelSend` now accepts it (+ `sentAt`). Widen the local `Session` interface (`sendMessage.ts:14-18`) and pass both through. This src change alone makes **production** attribution correct.

```diff
 interface Session {
-  sendChannelText(key: string, text: string): Promise<{ ok: boolean; error?: string; channelHash?: number }>;
+  sendChannelText(
+    key: string,
+    text: string,
+  ): Promise<{ ok: boolean; error?: string; channelHash?: number; timestampUnix?: number }>;
   sendDmTextWithRetry(key: string, text: string, id: string): Promise<{ ok: boolean; error?: string }>;
-  registerChannelSend(p: { messageId: string; channelHash: number }): void;
+  registerChannelSend(p: { messageId: string; channelHash: number; sentAt?: number; timestampUnix?: number }): void;
 }
```

In the `ch:` branch, replace the register call (`sendMessage.ts:53-55`):

```diff
       if (result.ok && result.channelHash != null) {
-        session.registerChannelSend({ messageId: id, channelHash: result.channelHash });
+        session.registerChannelSend({
+          messageId: id,
+          channelHash: result.channelHash,
+          sentAt: deps.now(),
+          timestampUnix: result.timestampUnix,
+        });
       }
```

Run `npx tsc --noEmit` — clean now (the remaining failure is a runtime fixture mismatch, not a type error).

- [ ] **Step 4: Rebuild the `channel-relay-ack` fixture (the non-trivial step)**

**This is the one hard part of the bump — make it its own gate.** `tests/integration/outbound/channel-relay-ack.test.ts`'s `heardRelayFrame(channelHash)` fabricates ciphertext (`0xde 0xad 0xbe 0xef`) that **cannot** match 0.6.0's matcher, which decrypts the relayed packet and compares its timestamp to the registered `timestampUnix`. Two facts make this non-trivial:
  - `transport.sent` in the loopback harness is the **host→radio command frame**, not the mesh packet, so you cannot capture the real packet off the wire and replay it.
  - The frame must therefore be built from **real channel crypto**: a GRP_TXT payload encrypted under the channel secret (`channel.secretHex`) carrying the exact `timestampUnix` the send registered — or a `@andyshinn/meshcore-ts` test helper if 0.6.0 exports one (confirm against `node_modules/@andyshinn/meshcore-ts/dist/index.d.ts` before hand-rolling AES).

Rewrite the test to capture the registered timestamp and encode a matching packet (widen `heardRelayFrame` to take the timestamp):

```ts
const result = await adapter.sendChannelText('ch:Outbound', 'hi there');
expect(result.ok).toBe(true);
expect(typeof result.channelHash).toBe('number');
expect(typeof result.timestampUnix).toBe('number');
holder.setMessageState(id, 'sent');

adapter.registerChannelSend({
  messageId: id,
  channelHash: result.channelHash as number,
  sentAt: Date.now(),
  timestampUnix: result.timestampUnix,
});

// Build a REAL GRP_TXT relay: encrypt a GRP_TXT payload stamped with the SAME
// timestampUnix under the channel secret, then wrap it in the 0x88 companion
// frame with a single 1-byte path hop (0xAA). Source the channel-encrypt
// primitive from 0.6.0's dist if it exports one; otherwise derive it from
// channel.secretHex with node:crypto exactly as the library encodes a channel send.
receive(heardRelayFrame(result.channelHash as number, result.timestampUnix as number));
```

Gate this step on the single test — do not proceed until it is green:
```bash
npx vitest run tests/integration/outbound/channel-relay-ack.test.ts
```

- [ ] **Step 5: Full-suite gate + revisit note**

Run the whole gate:
```bash
npx tsc --noEmit
npx biome check src tests
npx vitest run --project unit
npx vitest run --project integration
npx vitest run --project dom
```
Expected: all clean.

**Note (do not action here — separate follow-up):** 0.6.0 resolves the §7.1 `messageState`-pollution item library-side. CLI sends/replies no longer appear on `messageState`; instead the library emits `cliSendState` (`CliSendStateEvent { id: 'cli-<base36>-<rand>'; contactKey; state: 'sent'|'ack'|'failed' }`) and `cliUnmatched` (`CliUnmatchedEvent { contactKey?; senderPrefixHex; body; … }`). So coresense's no-op-row / junk-WS-frame handling at `src/main/protocol/adapterEvents.ts:113-116` should be **revisited** when this bump lands. This is a note only — do **not** expand this phase's scope into it.

- [ ] **Step 6: Commit**

```bash
git add package.json pnpm-lock.yaml src/main/messaging/sendMessage.ts tests/integration/outbound/channel-relay-ack.test.ts
git commit -m "chore(deps): raise @andyshinn/meshcore-ts to ^0.6.0 for repeaterSendCli opts

0.6.0 widens repeaterSendCli with RepeaterCliOptions (expectReply / timeoutMs /
signal) and exports CLI_REPLY_TIMEOUT_MS, which phase 3 needs to send
fire-and-forget CLI commands and to clear the pendingCli entry on abort instead
of stranding it for the full 30-second reply timeout. The bump's one regression
is reconciled here: sendMessage.ts threads timestampUnix/sentAt from
sendChannelText into registerChannelSend so 0.6.0's encrypted-timestamp relay
matcher attributes heard relays correctly, and the channel-relay-ack fixture is
rebuilt to replay a real GRP_TXT packet carrying that timestamp.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: `api.ts` — typed errors and the widened `repeaterCli`

Buildable today; does not touch the library.

**Files:**
- Modify: `src/renderer/lib/api.ts` (`parseServerError` at `:41-48`; `request()` at `:50-64`; `repeaterCli` at `:265-269`)
- Test: `tests/unit/renderer/lib/api.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  ```ts
  export class ApiError extends Error {
    readonly status: number;
    readonly code: string | null;
  }
  export function parseServerErrorCode(body: string): string | null;
  repeaterCli(
    c: ApiClient, key: string, command: string,
    opts?: { expectReply?: boolean; signal?: AbortSignal },
  ): Promise<{ ok: true; reply: string } | { ok: true; sent: true }>;
  ```
  `parseServerError(body): string | null` is **unchanged** — its three existing tests stay green.

- [ ] **Step 1: Write the failing tests**

Append to `tests/unit/renderer/lib/api.test.ts`. Keep the existing `describe('parseServerError', …)` block **verbatim**; add the import symbols and the three new blocks.

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api, parseServerError, parseServerErrorCode } from '@/lib/api';

const client = { baseUrl: 'http://x', apiKey: 'k' };

describe('parseServerErrorCode', () => {
  it('extracts the code field from a JSON body', () => {
    expect(parseServerErrorCode('{"error":"no reply","code":"cli_timeout"}')).toBe('cli_timeout');
  });

  it('returns null for a non-JSON body or an absent/non-string code', () => {
    expect(parseServerErrorCode('Internal Server Error')).toBeNull();
    expect(parseServerErrorCode('{"error":"x"}')).toBeNull();
    expect(parseServerErrorCode('{"code":503}')).toBeNull();
  });
});

describe('repeaterCli', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('posts command + expectReply and forwards the abort signal', async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ ok: true, reply: 'radio: 869.525' }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const ctrl = new AbortController();

    const res = await api.repeaterCli(client, 'c:abc', 'get radio', {
      expectReply: true,
      signal: ctrl.signal,
    });

    expect(res).toEqual({ ok: true, reply: 'radio: 869.525' });
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(init.body as string)).toEqual({ command: 'get radio', expectReply: true });
    expect(init.signal).toBe(ctrl.signal);
  });

  it('omits expectReply from the body when unspecified', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true, reply: 'ok' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await api.repeaterCli(client, 'c:abc', 'get radio');

    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(init.body as string)).toEqual({ command: 'get radio' });
  });

  it('returns { sent: true } on a 202 no-reply response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ok: true, sent: true }), { status: 202 })));

    const res = await api.repeaterCli(client, 'c:abc', 'set advert.interval 30', { expectReply: false });

    expect(res).toEqual({ ok: true, sent: true });
  });

  it('throws an ApiError carrying the status and code on a failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ error: 'no reply', code: 'cli_timeout' }), { status: 504 })),
    );

    await expect(api.repeaterCli(client, 'c:abc', 'get radio')).rejects.toMatchObject({
      name: 'ApiError',
      status: 504,
      code: 'cli_timeout',
      message: 'no reply',
    });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run --project unit tests/unit/renderer/lib/api.test.ts`
Expected: FAIL — `ApiError` and `parseServerErrorCode` are not exported, and `repeaterCli` rejects the fourth `opts` argument at compile.

- [ ] **Step 3: Add `ApiError` and `parseServerErrorCode`**

In `src/renderer/lib/api.ts`, insert immediately after `parseServerError` (after its closing brace at `:48`):

```ts
/** Thrown by `request()` on a non-2xx response. Carries the HTTP status and the
 *  server's `code` field (when present) so callers classify without re-parsing
 *  status text — the repeater CLI route sets `code: 'cli_timeout'` vs
 *  `'transport'` for the transcript's four failure kinds (§5.4). */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string | null;
  constructor(message: string, status: number, code: string | null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

/** Pull a `{ "code": "…" }` classifier out of a JSON error body, or null. */
export function parseServerErrorCode(body: string): string | null {
  try {
    const parsed = JSON.parse(body) as { code?: unknown };
    return typeof parsed?.code === 'string' ? parsed.code : null;
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Throw `ApiError` from `request()`**

Replace the throw inside `request()` (currently `throw new Error(parseServerError(body) ?? \`${res.status} ${body || res.statusText}\`);`) with:

```ts
    throw new ApiError(
      parseServerError(body) ?? `${res.status} ${body || res.statusText}`,
      res.status,
      parseServerErrorCode(body),
    );
```

Leave the rest of `request()` untouched — it already spreads `...init` into `fetch` (`:51`), so a `signal` on the `init` bag reaches the network with no change here.

- [ ] **Step 5: Widen `repeaterCli`**

Replace the `repeaterCli` entry (`:265-269`) with:

```ts
  repeaterCli: (
    c: ApiClient,
    key: string,
    command: string,
    opts: { expectReply?: boolean; signal?: AbortSignal } = {},
  ) =>
    request<{ ok: true; reply: string } | { ok: true; sent: true }>(
      c,
      `/api/repeater/${encodeURIComponent(key)}/cli`,
      {
        method: 'POST',
        body: JSON.stringify({ command, expectReply: opts.expectReply }),
        signal: opts.signal,
      },
    ),
```

`JSON.stringify` drops an `undefined` value, so `expectReply` is absent from the body unless the caller passes `false` (or `true`) — the route defaults it to `true`. `request<T>` returns `res.json()` for any 2xx, so both the `200 { reply }` and `202 { sent: true }` shapes resolve; a `504`/`503` throws the `ApiError` from Step 4. `CliTab.tsx`'s existing two-argument call (`api.repeaterCli(client, contact.key, cmd)` at `:36`) still typechecks — `opts` defaults to `{}`.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run --project unit tests/unit/renderer/lib/api.test.ts && npx tsc --noEmit`
Expected: PASS — the 3 existing `parseServerError` tests, 2 `parseServerErrorCode` tests, 4 `repeaterCli` tests (9 total); typecheck clean.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/lib/api.ts tests/unit/renderer/lib/api.test.ts
git commit -m "feat(api): typed ApiError and a no-reply/abort-aware repeaterCli

request() now throws an ApiError carrying the HTTP status and the server's
code field, so the CLI transcript can tell a 504 cli_timeout from a 503
transport failure without re-parsing status text. repeaterCli gains an
opts bag: expectReply flows into the request body (fire-and-forget), signal
flows into the fetch init that request already spreads through, and the
return widens to { ok, reply } | { ok, sent } for the 200/202 split.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: `routes.ts` — accept `expectReply`, forward the signal, classify the outcome

**Depends on Task 1's `^0.6.0` bump** — the handler calls the three-argument `repeaterSendCli`, which only typechecks once Task 4's adapter accepts the options bag (which needs 0.6.0's three-arg signature). Apply Task 4's one-line signature edit first if `tsc` complains, then return here. The route tests themselves inject a **fake** adapter, so they exercise only coresense's classification logic.

**Files:**
- Modify: `src/main/api/routes.ts` (`POST /api/repeater/:key/cli` at `:799-811`)
- Test: `tests/integration/inbound/repeater-admin.test.ts`

**Interfaces:**
- Consumes: `protocolSession()` from `../protocol`; `setProtocolSession` and `createRoutes` (test seams); Task 4's `SessionAdapter.repeaterSendCli(key, command, opts?)`.
- Produces: the HTTP contract `202 { ok: true, sent: true }` / `200 { ok: true, reply }` / `504 { error, code: 'cli_timeout' }` / `503 { error, code: 'transport' }` that `api.ts` (Task 2) and `send.ts` (Task 5) Consume.

- [ ] **Step 1: Write the failing route tests**

Add to `tests/integration/inbound/repeater-admin.test.ts`. At the top, extend the imports and add a fake-adapter helper; then add the `describe` block. The existing `PK` constant (`'aa'.repeat(32)`) is reused.

```ts
import { createRoutes } from '../../../src/main/api/routes';
import { setProtocolSession } from '../../../src/main/protocol';
import type { SessionAdapter } from '../../../src/main/protocol/sessionAdapter';

function routesApp() {
  return createRoutes({
    port: () => 8080,
    wsClients: () => 0,
    bridgeStatus: () => ({ running: false, clients: 0 }) as never,
  });
}

/** A SessionAdapter double whose only live method is repeaterSendCli. */
function fakeCliAdapter(impl: SessionAdapter['repeaterSendCli']): SessionAdapter {
  return { repeaterSendCli: impl } as unknown as SessionAdapter;
}

async function postCli(body: unknown) {
  return routesApp().request(`/api/repeater/c%3A${PK}/cli`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/repeater/:key/cli classification', () => {
  afterEach(() => setProtocolSession(null));

  it('returns 200 { reply } when a reply is expected and arrives', async () => {
    setProtocolSession(fakeCliAdapter(async () => 'radio: 869.525'));
    const res = await postCli({ command: 'get radio' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, reply: 'radio: 869.525' });
  });

  it('returns 202 { sent: true } for a no-reply command', async () => {
    const calls: Array<{ expectReply?: boolean }> = [];
    setProtocolSession(
      fakeCliAdapter(async (_key, _command, opts) => {
        calls.push({ expectReply: opts?.expectReply });
        return '';
      }),
    );
    const res = await postCli({ command: 'set advert.interval 30', expectReply: false });
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ ok: true, sent: true });
    expect(calls[0].expectReply).toBe(false);
  });

  it('classifies a reply timeout as 504 cli_timeout', async () => {
    setProtocolSession(
      fakeCliAdapter(async () => {
        throw new Error('CLI command timed out after 30000ms');
      }),
    );
    const res = await postCli({ command: 'get radio' });
    expect(res.status).toBe(504);
    expect((await res.json()) as { code: string }).toMatchObject({ code: 'cli_timeout' });
  });

  it('classifies any other failure (incl. superseded) as 503 transport', async () => {
    setProtocolSession(
      fakeCliAdapter(async () => {
        throw new Error('superseded by newer CLI command');
      }),
    );
    const res = await postCli({ command: 'get radio' });
    expect(res.status).toBe(503);
    expect((await res.json()) as { code: string; error: string }).toMatchObject({
      code: 'transport',
      error: 'superseded by newer CLI command',
    });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run --project integration tests/integration/inbound/repeater-admin.test.ts`
Expected: FAIL — the current handler ignores `expectReply` (never returns `202`) and returns `503` with no `code` field for every error, so the `202`, `504`, and `code` assertions fail.

- [ ] **Step 3: Rewrite the CLI route**

Replace the whole `api.post('/api/repeater/:key/cli', …)` handler (`:799-811`) with:

```ts
  api.post('/api/repeater/:key/cli', async (c) => {
    const key = decodeURIComponent(c.req.param('key'));
    const body = (await c.req.json().catch(() => null)) as { command?: string; expectReply?: boolean } | null;
    if (!body || typeof body.command !== 'string' || body.command.length === 0) {
      return c.json({ error: 'command is required' }, 400);
    }
    // Defaults to a reply-expecting send; only an explicit false opts out.
    const expectReply = body.expectReply !== false;
    try {
      // Forward the HTTP request's own AbortSignal: if the client aborts (repeater
      // switch / unmount), the library deletes its pendingCli entry rather than
      // holding it for the full CLI_REPLY_TIMEOUT_MS (§5.1, §7.1).
      const reply = await protocolSession().repeaterSendCli(key, body.command, {
        expectReply,
        signal: c.req.raw.signal,
      });
      if (!expectReply) return c.json({ ok: true, sent: true }, 202);
      return c.json({ ok: true, reply }, 200);
    } catch (err) {
      const message = (err as Error).message;
      // The library rejects a lapsed reply with `CLI command timed out after
      // <ms>ms` (§7.1). Everything else — transport drop, superseded-by-newer —
      // is a transport-tier failure; the renderer re-reads the message to split
      // superseded out (§5.4).
      if (message.includes('timed out after')) {
        return c.json({ error: message, code: 'cli_timeout' }, 504);
      }
      return c.json({ error: message, code: 'transport' }, 503);
    }
  });
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run --project integration tests/integration/inbound/repeater-admin.test.ts && npx tsc --noEmit`
Expected: PASS — 4 new classification tests plus the file's existing repeater-admin tests; typecheck clean **provided Task 4 has widened the adapter** (if `tsc` reports "Expected 2 arguments, but got 3" on the `repeaterSendCli` call, apply Task 4 Step 1 first, then re-run).

- [ ] **Step 5: Commit**

```bash
git add src/main/api/routes.ts tests/integration/inbound/repeater-admin.test.ts
git commit -m "feat(api): classify repeater CLI outcomes and forward abort/no-reply

The CLI route now honours expectReply (202 { sent } for fire-and-forget),
forwards the request's AbortSignal so an aborted request clears the
library's pendingCli entry instead of stranding it for 30 s, and tags
failures: 504 cli_timeout for a lapsed reply, 503 transport otherwise
(superseded included, re-split by message on the renderer).

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: `sessionAdapter.ts` — forward the options bag

**Depends on Task 1's `^0.6.0` bump** — the third parameter is typed off the library, so `Parameters<MeshCoreSession['repeaterSendCli']>[2]` resolves to `RepeaterCliOptions` once `^0.6.0` is installed. Pure pass-through, no independent runtime surface; its behaviour is exercised by Task 6's loopback tests and Task 3's route. The green gate here is `tsc`.

**Files:**
- Modify: `src/main/protocol/sessionAdapter.ts` (`repeaterSendCli` at `:169-171`)

**Interfaces:**
- Consumes: Task 1's `MeshCoreSession.repeaterSendCli(contactKey, command, opts?)`.
- Produces: `SessionAdapter.repeaterSendCli(key: string, command: string, opts?: Parameters<MeshCoreSession['repeaterSendCli']>[2]): Promise<string>` — Consumed by Task 3's route.

- [ ] **Step 1: Widen the pass-through**

Replace the `repeaterSendCli` method (`:169-171`) with:

```ts
  repeaterSendCli(key: string, command: string, opts?: Parameters<MeshCoreSession['repeaterSendCli']>[2]) {
    return this.session.repeaterSendCli(key, command, opts);
  }
```

`Parameters<…>[2]` keeps the options type tracking the library exactly — the same convention this file already uses for `repeaterRequestNeighbours`, `repeaterTracePath`, and `repeaterGetLocalStats` (`:163-176`), so it cannot drift if the library evolves the bag.

- [ ] **Step 2: Verify the type lines up**

Run: `npx tsc --noEmit`
Expected: clean. If `tsc` reports `Tuple type '[contactKey: string, command: string]' of length '2' has no element at index '2'` (or an arity error on the call), the `^0.6.0` bump from Task 1 has not been installed — run Task 1, do not work around it with a two-arg shim.

- [ ] **Step 3: Commit**

```bash
git add src/main/protocol/sessionAdapter.ts
git commit -m "feat(protocol): forward the CLI options bag through the session adapter

repeaterSendCli now passes an optional third argument (expectReply / signal)
straight to the library, typed off Parameters<MeshCoreSession[...]> so it
tracks the library and never drifts. Behaviour is covered by the loopback
integration tests.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: `CliTab` queue wiring + the pure settle map

`send.ts` and its test are buildable today. The `CliTab` edits depend on **phase 1** (the queue module) and **phase 2** (the `CliTab` that owns the queue state); they call `api.repeaterCli` (Task 2), not the library, so they are not release-blocked — but the end-to-end no-reply/abort round-trip only takes effect once Tasks 3–4 land in main.

**Files:**
- Create: `src/renderer/panels/repeater-admin/cli/lib/send.ts`
- Test: `tests/unit/renderer/panels/repeater-admin/cli/send.test.ts`
- Modify: `src/renderer/panels/repeater-admin/CliTab.tsx` (phase 2's rewritten tab)

**Interfaces:**
- Consumes:
  - Phase 1 `queue.ts` (§2.5): `CliEntry`, `CliEntryState`, `CliQueueState`, `enqueue(s,e)`, `beginNext(s): { state, next }`, `settle(s,id,patch)`, `cancel(s,id)`, `abortAll(s)`.
  - Phase 1 `catalog.ts` (§1): `CliCommand` (for `cmd.noReply` and `cmd.rebootRequired`).
  - Task 2: `api.repeaterCli(c, key, command, opts?: { expectReply?, signal? }): Promise<{ ok:true; reply:string } | { ok:true; sent:true }>`, `ApiError`.
  - Phase 2 `CliTab` settle side-effects it must **preserve** (not re-implement): `patchStatus` (history status), `extractNodeValue` → `setNodeValues`, `armReboot` / `markRebootSent`, and any follow-up enqueue; plus the phase-2 effect deps `patchStatus` / `onPending` / `pending`.
- Produces (`send.ts`):
  ```ts
  export type CliReplyResult = { ok: true; reply: string } | { ok: true; sent: true };
  export function settlePatchForReply(result: CliReplyResult, endedAt: number): Partial<CliEntry>;
  export function settlePatchForError(err: unknown, endedAt: number): Partial<CliEntry>;
  ```

- [ ] **Step 1: Write the failing test for `send.ts`**

Create `tests/unit/renderer/panels/repeater-admin/cli/send.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { settlePatchForError, settlePatchForReply } from '../../../../../../src/renderer/panels/repeater-admin/cli/lib/send';

describe('settlePatchForReply', () => {
  it('marks an ordinary reply ok and keeps the text', () => {
    expect(settlePatchForReply({ ok: true, reply: 'radio: 869.525' }, 5)).toEqual({
      state: 'ok',
      reply: 'radio: 869.525',
      error: null,
      endedAt: 5,
    });
  });

  it('marks an Err- reply refused, keeping it as a reply (HTTP 200, not a transport failure)', () => {
    expect(settlePatchForReply({ ok: true, reply: 'Err - unknown command' }, 5)).toEqual({
      state: 'error',
      reply: 'Err - unknown command',
      error: { kind: 'refused', message: 'Err - unknown command' },
      endedAt: 5,
    });
  });

  it('detects Err after leading whitespace', () => {
    expect(settlePatchForReply({ ok: true, reply: '  Err -3' }, 5).error).toEqual({
      kind: 'refused',
      message: '  Err -3',
    });
  });

  it('marks a no-reply send as sent, with no reply body', () => {
    expect(settlePatchForReply({ ok: true, sent: true }, 5)).toEqual({
      state: 'sent',
      reply: null,
      error: null,
      endedAt: 5,
    });
  });
});

describe('settlePatchForError', () => {
  it('reads superseded off the message before the transport code', () => {
    const err = Object.assign(new Error('superseded by newer CLI command'), { code: 'transport' });
    expect(settlePatchForError(err, 5)).toEqual({
      state: 'error',
      error: { kind: 'superseded', message: 'superseded by newer CLI command' },
      endedAt: 5,
    });
  });

  it('maps a cli_timeout code to a timeout state', () => {
    const err = Object.assign(new Error('CLI command timed out after 30000ms'), { code: 'cli_timeout' });
    expect(settlePatchForError(err, 5)).toEqual({
      state: 'timeout',
      error: { kind: 'timeout', message: 'CLI command timed out after 30000ms' },
      endedAt: 5,
    });
  });

  it('maps everything else to transport', () => {
    const err = Object.assign(new Error('device offline'), { code: 'transport' });
    expect(settlePatchForError(err, 5)).toEqual({
      state: 'error',
      error: { kind: 'transport', message: 'device offline' },
      endedAt: 5,
    });
  });

  it('degrades a non-Error rejection to a transport failure', () => {
    expect(settlePatchForError('boom', 5)).toEqual({
      state: 'error',
      error: { kind: 'transport', message: 'boom' },
      endedAt: 5,
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run --project unit tests/unit/renderer/panels/repeater-admin/cli/send.test.ts`
Expected: FAIL — cannot resolve `…/cli/lib/send`.

- [ ] **Step 3: Create `send.ts`**

Create `src/renderer/panels/repeater-admin/cli/lib/send.ts`:

```ts
// Mapping an api.repeaterCli outcome to a CliEntry settle patch. Pure, so the
// four §5.4 failure kinds are pinned without a DOM or a live transport.
//
// The split is deliberate: a refused command is HTTP 200 with an `Err -` reply
// body — the transport succeeded, the firmware said no — so it stays a reply,
// tinted danger, not a transport failure. A superseded rejection arrives tagged
// `code: 'transport'` from the route (§7.2), so it is disambiguated by MESSAGE
// before the code is consulted.

import type { CliEntry } from './queue';

export type CliReplyResult = { ok: true; reply: string } | { ok: true; sent: true };

export function settlePatchForReply(result: CliReplyResult, endedAt: number): Partial<CliEntry> {
  if ('reply' in result) {
    const reply = result.reply;
    if (reply.trimStart().startsWith('Err')) {
      return { state: 'error', reply, error: { kind: 'refused', message: reply }, endedAt };
    }
    return { state: 'ok', reply, error: null, endedAt };
  }
  return { state: 'sent', reply: null, error: null, endedAt };
}

export function settlePatchForError(err: unknown, endedAt: number): Partial<CliEntry> {
  const message = err instanceof Error ? err.message : String(err);
  const code = (err as { code?: unknown } | null)?.code;
  if (message.includes('superseded by newer CLI command')) {
    return { state: 'error', error: { kind: 'superseded', message }, endedAt };
  }
  if (code === 'cli_timeout') {
    return { state: 'timeout', error: { kind: 'timeout', message }, endedAt };
  }
  return { state: 'error', error: { kind: 'transport', message }, endedAt };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run --project unit tests/unit/renderer/panels/repeater-admin/cli/send.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Wire the queue into `CliTab`**

Open `src/renderer/panels/repeater-admin/CliTab.tsx` (phase 2's rewritten tab). It already owns the FIFO queue state from phase 1 — locate it by symbol (a `CliQueueState` held in `useState`/`useReducer`, and the `enqueue`/`settle`/`abortAll` imports). **Match phase 2's actual local names**; the code below uses `queue` / `setQueue` as placeholders for whatever phase 2 called them, exactly as the prior plan's "adapt the variable names to what the file already uses". Do not introduce a second queue.

Add the imports:

```tsx
import { useEffect, useRef } from 'react';
import { abortAll, beginNext, settle } from './cli/lib/queue';
import { settlePatchForError, settlePatchForReply } from './cli/lib/send';
```

Add an `AbortController` ref beside the queue state:

```tsx
  // One controller per in-flight send; aborted by the unmount cleanup below.
  // Deliberately NOT in queue state — queue state stays serialisable and pure
  // (§2.5). A remount (repeater switch) discards this ref with the component.
  const abortRef = useRef<AbortController | null>(null);
```

Add the drain effect. It **preserves every phase-2 settle side-effect** — `patchStatus` (history status), `extractNodeValue` → `setNodeValues`, `armReboot` / `markRebootSent`, and any follow-up enqueue — and swaps **only** the three lines marked `(a)` / `(b)` / `(c)`. Do **not** collapse the success branch to a bare `settle`; that would drop phase 2's node-value capture, history status, and reboot arming:

```tsx
  // Drain: one command in flight at a time (§5.1). beginNext returns null while
  // an entry is already `sending`, which is the invariant that keeps the library
  // from ever seeing two outstanding commands on this repeater.
  //
  // KEEP phase 2's success-branch body (patchStatus / extractNodeValue →
  // setNodeValues / armReboot / markRebootSent / follow-ups). Phase 3 changes
  // ONLY the (a)/(b)/(c) lines below.
  useEffect(() => {
    if (!client) return;
    const { state: begun, next } = beginNext(queue);
    if (!next) return;
    setQueue(begun);

    const ctrl = new AbortController();
    abortRef.current = ctrl;
    const expectReply = !next.cmd?.noReply; // (a) fire-and-forget for noReply cmds

    void (async () => {
      try {
        // (a) forward expectReply + the per-send signal.
        const res = await api.repeaterCli(client, contact.key, next.text, {
          expectReply,
          signal: ctrl.signal,
        });
        // (b) derive the settle patch from send.ts, then run phase 2's
        //     side-effects against it — unchanged.
        const patch = settlePatchForReply(res, Date.now());
        patchStatus(next, patch.state); // phase-2: history status
        if (patch.reply != null) {
          const value = extractNodeValue(next.cmd, patch.reply);
          if (value != null) setNodeValues((v) => ({ ...v, [next.cmd!.id]: value }));
        }
        // §6: a rebootRequired command arms the reboot-pending state on ANY
        // settled send — a fire-and-forget set settles `sent`, not `ok`, so
        // both count.
        if ((patch.state === 'ok' || patch.state === 'sent') && next.cmd?.rebootRequired) {
          armReboot(next);
          markRebootSent(next);
        }
        setQueue((q) => settle(q, next.id, patch));
      } catch (err) {
        // (c) abortAll already moved this entry to `cancelled`; don't overwrite it.
        if (ctrl.signal.aborted) return;
        setQueue((q) => settle(q, next.id, settlePatchForError(err, Date.now())));
      }
    })();
    // Keep phase 2's dependency list — patchStatus/onPending/pending included.
  }, [queue, client, contact.key, patchStatus, onPending, pending]);
```

The `patchStatus` / `extractNodeValue` / `setNodeValues` / `armReboot` / `markRebootSent` names above are phase 2's own helpers — **match the file's actual names and call shapes**; phase 3 is not introducing them, only re-sourcing the settle patch from `send.ts` and adding `'sent'` to the reboot-arm guard (§6).

Add the abort-on-switch/unmount cleanup:

```tsx
  // On repeater switch or unmount, abort the live send — which clears the
  // main-process pendingCli entry (§7.1) instead of leaving it registered for
  // the full timeout — and move every non-terminal entry to `cancelled` so the
  // drain never wedges on a `sending` entry that will never settle (§2.5).
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      setQueue((q) => abortAll(q));
    };
  }, []);
```

If phase 2 already imported `api`, `useEffect`, or `useRef`, fold these into the existing imports rather than duplicating them.

- [ ] **Step 6: Add the reboot-on-`sent` component test (§6)**

Phase 2 arms the reboot-pending state when a `rebootRequired` command settles. Now that a fire-and-forget set settles `sent` rather than `ok`, add a component test proving the arming triggers on `'sent'` too — it fails first against an `ok`-only guard and passes once Step 5's guard admits `'sent'`. Add it to phase 2's `CliTab` suite (`tests/component/…/CliTab.test.tsx` — match its actual path and render harness):

```tsx
it('arms reboot-pending when a rebootRequired noReply set settles sent', async () => {
  // A rebootRequired + noReply catalog command → the route answers 202 { sent }.
  const repeaterCli = vi.fn(async () => ({ ok: true, sent: true }) as const);
  const view = renderCliTab({ api: { repeaterCli } }); // match phase 2's harness

  await view.submitCli('set repeat 0'); // catalog entry: noReply + rebootRequired

  // §6: the send settles `sent`, which must arm the reboot-pending affordance.
  expect(view.getRebootPending()).toBe(true);
  expect(repeaterCli).toHaveBeenCalledWith(
    expect.anything(),
    expect.any(String),
    'set repeat 0',
    expect.objectContaining({ expectReply: false }),
  );
});
```

Run: `npx vitest run --project dom` — RED with an `ok`-only reboot guard, GREEN once Step 5's guard admits `'sent'`. Adapt `renderCliTab` / `submitCli` / `getRebootPending` to phase 2's real component-test utilities.

- [ ] **Step 7: Verify the renderer still builds and its tests stay green**

Run: `npx tsc --noEmit && npx vitest run --project dom && npx biome check src tests`
Expected: all clean, including the new reboot-on-`sent` test. Phase 2's `CliTab` component tests still pass — the drain effect is a no-op on an empty queue, a submit still enqueues exactly as before, and every phase-2 settle side-effect (patchStatus / setNodeValues / armReboot / markRebootSent) is preserved; the only new behaviour is that a `noReply` command sends `expectReply:false`, settles `sent`, arms reboot on `sent` as well as `ok` (§6), and an aborted send is left in `cancelled`.

- [ ] **Step 8: Commit**

```bash
git add src/renderer/panels/repeater-admin/cli/lib/send.ts tests/unit/renderer/panels/repeater-admin/cli/send.test.ts src/renderer/panels/repeater-admin/CliTab.tsx tests/component/repeater-admin/CliTab.test.tsx
git commit -m "feat(cli): drain the queue through the transport with per-send abort

CliTab now drives phase 1's FIFO one command at a time: noReply commands
go out expectReply:false and settle as `sent`; every send owns an
AbortController in a ref that the unmount/switch cleanup aborts — clearing
the main pendingCli entry — while abortAll moves the in-flight entry to
cancelled so the drain can't wedge. The drain KEEPS every phase-2 settle
side-effect (patchStatus / setNodeValues / armReboot / markRebootSent) and
arms reboot on `sent` as well as `ok` (§6). A pure send.ts maps the api
result or error into the four §5.4 CliEntry kinds
(refused/timeout/superseded/transport).

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Integration — `expectReply` and abort against the real library

**Depends on Task 1's `^0.6.0` bump** — these tests call the three-argument `repeaterSendCli` on a real `MeshCoreSession` over the loopback transport, so they compile and pass once `^0.6.0` is installed. They complement Task 3's route tests (which used a fake adapter): here the assertions are about the **library's** behaviour — that `expectReply:false` registers no pending entry and that an abort **clears** `pendingCli` (0.6.0 confirms this at `dist/index.js:3944-3945`), not merely that the caller saw a rejection (§11).

**Files:**
- Modify: `tests/integration/inbound/repeater-admin.test.ts`

**Interfaces:**
- Consumes: Task 4's `SessionAdapter.repeaterSendCli(key, command, opts?)`; Task 1's behaviour contract; the file's existing harness (`makeTestSession`, `repeater()`, `PK`, `PREFIX`, `tick`, `cliReply(prefixHex, body)`).
- Produces: nothing (tests).

- [ ] **Step 1: Add a white-box `pendingCli` accessor and the new cases**

Add near the top of `tests/integration/inbound/repeater-admin.test.ts`:

```ts
// White-box reach into the library's admin-correlation map. This is a
// deliberate assertion that abort/no-reply touch the RIGHT internal state
// (§11: "cleared, not merely that the client saw an abort"). `ctx` is private
// on MeshCoreSession; the cast pins the runtime shape recorded in the release
// (`ctx.rt.adminCorr.pendingCli`, keyed by the 12-char pubkey prefix). If the
// release relocates the map, update this one helper.
function pendingCliMap(adapter: import('../../../src/main/protocol/sessionAdapter').SessionAdapter): Map<string, unknown> {
  return (
    adapter.session as unknown as { ctx: { rt: { adminCorr: { pendingCli: Map<string, unknown> } } } }
  ).ctx.rt.adminCorr.pendingCli;
}
```

Then add these tests inside `describe('repeater administration', …)` (alongside the existing `resolves a CLI command reply routed by sender prefix` test, which already covers `expectReply` defaulting to true):

```ts
  it('registers a pendingCli entry while a reply is expected', async () => {
    const { adapter, receive } = makeTestSession();
    adapter.session.state.upsertContact(repeater());

    const p = adapter.repeaterSendCli(`c:${PK}`, 'get radio');
    await tick();
    expect(pendingCliMap(adapter).size).toBe(1);

    receive(cliReply(PREFIX, 'radio: 869.525,250,11,5'));
    expect(await p).toBe('radio: 869.525,250,11,5');
    expect(pendingCliMap(adapter).size).toBe(0);
  });

  it('resolves a no-reply send without registering a pendingCli entry', async () => {
    const { adapter } = makeTestSession();
    adapter.session.state.upsertContact(repeater());

    const p = adapter.repeaterSendCli(`c:${PK}`, 'set advert.interval 30', { expectReply: false });
    await tick();
    // No cliReply frame is delivered; the send resolves on transport hand-off.
    expect(await p).toBe('');
    expect(pendingCliMap(adapter).size).toBe(0);
  });

  it('clears the pendingCli entry when the caller aborts mid-flight', async () => {
    const { adapter } = makeTestSession();
    adapter.session.state.upsertContact(repeater());

    const ctrl = new AbortController();
    const p = adapter.repeaterSendCli(`c:${PK}`, 'get radio', { signal: ctrl.signal });
    await tick();
    expect(pendingCliMap(adapter).size).toBe(1);

    ctrl.abort();
    await expect(p).rejects.toThrow();
    // The entry is deleted, not left to fire its 30 s timer — the whole point.
    expect(pendingCliMap(adapter).size).toBe(0);
  });
```

- [ ] **Step 2: Run the integration project**

Run: `npx vitest run --project integration tests/integration/inbound/repeater-admin.test.ts && npx tsc --noEmit`
Expected with `^0.6.0` installed: PASS — the three new cases plus Task 3's four route cases plus the file's pre-existing repeater-admin tests; typecheck clean. If `tsc` errors on the third `repeaterSendCli` argument, the `^0.6.0` bump is not installed (Task 1). If `pendingCliMap` throws `Cannot read properties of undefined`, 0.6.0 relocated the correlation state — update the accessor path to match the shipped `dist/index.d.ts`, do not weaken the assertion to a behavioural proxy.

- [ ] **Step 3: Full-project verification and commit**

Run:
```bash
npx tsc --noEmit
npx biome check src tests
npx vitest run --project unit
npx vitest run --project integration
npx vitest run --project dom
```
Expected: all five clean.

```bash
git add tests/integration/inbound/repeater-admin.test.ts
git commit -m "test(api): pin expectReply and abort-clears-pendingCli at the library

Adds loopback integration coverage that the no-reply send registers no
pendingCli entry and resolves on transport hand-off, and that aborting a
reply-expecting send DELETES the pendingCli entry rather than leaving it to
time out. Asserts the library's internal correlation map directly, per §11.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Notes for the implementer

- **The spec is the authority.** Where this plan and `docs/superpowers/specs/2026-07-28-repeater-cli-autocomplete-design.md` disagree, the spec wins — and tell the reviewer, because it means the plan has a bug.
- **Bump before the transport tasks.** Tasks 3, 4, and 6 do not compile until `^0.6.0` is installed. The arity error on the third `repeaterSendCli` argument means the bump is missing, not a bug to route around — a two-arg shim would leave `pendingCli` wrong and need cleanup (Decision #2). Run Task 1 first, or leave those tasks unstarted.
- **Two error paths look alike and must not be conflated.** A `refused` command is HTTP 200 (`send.ts` `settlePatchForReply`); a `superseded` command is HTTP 503 with `code:'transport'` and is re-split by message (`settlePatchForError`). The route never emits `code:'superseded'` — that kind exists only on the renderer.
- **`send.ts` and Task 2's `api.ts` are the only phase-3 work independent of the bump.** Land them behind phases 1–2 whenever those merge; run Task 1's `^0.6.0` bump before the transport chain (Tasks 3/4/6).
- **The abort test's white-box reach is intentional.** §11 requires proving the entry was *cleared*, which a behavioural proxy (the caller's rejection) cannot show. Keep the `pendingCliMap` accessor pinned to the shipped internal shape.
