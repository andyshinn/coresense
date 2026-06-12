# Protocol Completion — Phase 2f: Repeater-Admin Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Migrate the repeater-administration cluster — login/logout, status & telemetry requests + their PUSH responses, ACL / neighbours / owner-info (via binary-req), CLI commands, trace-path, raw-data, and local-stats — out of `ProtocolSession` into a `features/repeaterAdmin.ts` feature module, and **close the Phase 2e admin-hook seam** (the module now owns `adminSentQueue`/`pendingCli` and registers the `directMessages` hooks). Behavior-preserving.

**Architecture / what this resolves:**
- **The Phase 2e seam closes here.** `directMessages` owns `RESP_SENT` + `RESP_CONTACT_MSG_RECV` and calls `adminHooks.onSentTag` / `onCliReply`. Today the *session* registers those hooks against its own `adminSentQueue`/`pendingCli`. After this phase the **repeaterAdmin module** owns those queues and registers the hooks (via `registerAdminHooks()`), and the session's `start()` hook block + residual queues are removed. `directMessages` keeps owning the opcodes — admin participates only through the hook seam (per the spec's Phase 2e note).
- **`adminSessions` (bridge/adminSession.ts) is already a singleton** (login state + tag/login awaiters) imported directly — the feature uses it as-is.
- **Wire layer consolidates into `repeater.ts`.** `repeater.ts` already holds every repeater *decoder* (login/binary/trace/acl/neighbours/owner/local-stats/raw-data). Task 1 moves the 9 repeater *encoders* out of `encode.ts` and the `status`/`telemetry` decoders (+ CayenneLPP table) out of `decode.ts` into `repeater.ts`, leaving `decode.ts` empty → **deleted**. `repeater.ts` keeps its established `build*`/`parse*` names (it is the pre-existing repeater wire module, not the shared encode.ts/decode.ts; renaming ~20 intricate, largely-untested decoders is churn/risk with no behavior benefit — the feature imports the established names).
- **Telemetry folds into repeaterAdmin** (not a separate `telemetry.ts`): `sendTelemetryReq` / `PUSH_TELEMETRY_RESPONSE` / CayenneLPP are structurally identical to the status flow and, today, are purely a repeater request/response. The module notes this can split out if a non-repeater telemetry source (periodic sensor push) later lands. (Deviation from the spec's separate-`telemetry`-module listing — recorded in the spec on completion.)

**Tech Stack:** TypeScript, Vitest (`pnpm test:unit` / `pnpm test:integration`), `pnpm typecheck`, Biome (`pnpm exec biome check src tests`, `--write`).

**Process constraints (carry forward):** stay on `feat/protocol-completion`; never `git checkout`/`switch`/`reset`/`stash`/`restore` (reviewers inspect read-only via `git diff`/`git show`); never read or modify `src/renderer/shell/leftnav/OwnerCard.tsx`; commit trailer `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`; `git commit` needs `dangerouslyDisableSandbox: true`; biome scope `src tests`; **encoders/decoders move VERBATIM** (byte-identical).

---

## Module map (state at phase completion)

### `src/main/protocol/repeater.ts` (the repeater wire layer — extended)
- **Existing decoders (unchanged):** `parseLoginSuccess`/`LoginSuccess`, `parseLoginFail`/`LoginFail`, `parseRawData`/`RawData`, `parseBinaryResponse`/`BinaryResponse`, `parseTraceData`/`TraceData`, `parseRepeaterStatsBlob`/`RepeaterStats`, `parseAclList`/`AclEntry`, `parseNeighbours`/`NeighboursPage`/`Neighbour`, `parseOwnerInfo`/`OwnerInfo`, `parseLocalStats`/`LocalStats`.
- **Moved IN from `encode.ts` (verbatim, keep `build*` names):** `buildSendStatusReq`, `buildSendTelemetryReq`, `buildSendLogin`, `buildLogout`, `buildSendAnonReq`, `buildAnonLogin`, `buildSendTracePath`, `buildGetStats`, `buildSendBinaryReq`. (Add `import { CMD, REQ_TYPE?, STATS_TYPE } from './codes'` as needed — check each.)
- **Moved IN from `decode.ts` (verbatim):** `parseStatusResponse`/`StatusResponse`/`StatusField` + `decodeStatusFields` + `formatUptime`; `parseTelemetryResponse`/`TelemetryResponse`/`TelemetryField` + `CayenneDescriptor` + `CAYENNE_TYPES` + `decodeCayenneLPP`.

### `src/main/protocol/encode.ts` (shrinks, survives)
- Keeps only `buildSendSelfAdvert`, `buildReboot` (device-level; not part of 2f).

### `src/main/protocol/decode.ts` → **DELETED** (becomes empty).

### `src/main/protocol/features/repeaterAdmin.ts` (NEW)
- **State (module-level):** `adminSentQueue: PendingAdminSent[]` (+ interface), `pendingCli: Map<string, PendingCli>` (+ interface), `pendingLocalStats: {...} | null`. **Consts:** `ADMIN_SENT_TIMEOUT_MS`, `ADMIN_REPLY_TIMEOUT_MS`, `CLI_REPLY_TIMEOUT_MS` (moved from session).
- **Private helpers:** `lookupRepeaterContact(contactKey)`, `writeAdminAndAwaitTag(ctx, frame)`, `sendBinaryReq(ctx, contactKey, reqData)`.
- **Public methods (take `ctx` first):** `sendStatusReq`, `sendTelemetryReq`, `repeaterLogin`, `repeaterLogout`, `repeaterRequestAcl`, `repeaterRequestNeighbours`, `repeaterRequestOwnerInfo`, `repeaterSendCli`, `repeaterTracePath`, `repeaterGetLocalStats`.
- **`registerAdminHooks()`:** calls `directMessages.setAdminHooks({ onSentTag, onCliReply })` pointed at the module's `adminSentQueue`/`pendingCli`.
- **`repeaterAdminFeature: Feature`** handling `[PUSH.STATUS_RESPONSE, PUSH.TELEMETRY_RESPONSE, PUSH.LOGIN_SUCCESS, PUSH.LOGIN_FAIL, PUSH.BINARY_RESPONSE, PUSH.TRACE_DATA, PUSH.RAW_DATA, RESP.STATS]` — bodies = the legacy `onPacket` branch logic + `handleStatusResponse` + `handleTelemetryResponse`.
- **`resetAdmin(reason)`:** fail/clear `adminSentQueue` + `pendingCli` + `pendingLocalStats`, then `adminSessions.reset(reason)`.
- Imports: wire layer from `../repeater`; `adminSessions` + `AdminMode`/`AdminRole` from `../../bridge/adminSession`; `directMessages` (setAdminHooks + encodeSendDmText + enqueueDmSend/dequeueDmSend) from `./directMessages`; `stateHolder`, `emit`, `child`, `CMD`/`PUSH`/`RESP`/`REQ_TYPE`/`STATS_TYPE`/`TXT_TYPE` from `../codes`, `type Feature, FeatureContext`.

### `src/main/protocol/session.ts`
- Registers `repeaterAdminFeature`; `start()` calls `repeaterAdmin.registerAdminHooks()` (replacing the inline `setAdminHooks` block); disconnect + `stop()` call `repeaterAdmin.resetAdmin(...)`; the 10 public methods become thin delegators to `repeaterAdmin.*(this.ctx, ...)`. All 8 legacy push/resp branches + the 2 private handlers + the 3 state fields/interfaces + admin consts removed.

---

## Task 1: Consolidate the repeater wire layer into `repeater.ts` (mechanical, LOW RISK)

**Files:** Modify `repeater.ts`, `encode.ts`, `session.ts`. Delete `decode.ts`. Create `tests/unit/main/protocol/repeater.test.ts`. Modify/relocate `encode.test.ts`, delete `decode.test.ts`.

### - [ ] Step 1: Move the 9 repeater encoders `encode.ts` → `repeater.ts`
Move verbatim (keep names): `buildSendStatusReq` (encode.ts:8-17), `buildSendTelemetryReq` (23-33), `buildSendLogin` (48-59), `buildLogout` (62-71), `buildSendAnonReq` (77-88), `buildAnonLogin` (94-98), `buildSendTracePath` (104-119), `buildGetStats` (123-125), `buildSendBinaryReq` (143-154). Append to `repeater.ts`. Add to repeater.ts imports: `{ Buffer }` (value — encoders allocate), `{ CMD, STATS_TYPE }` from `./codes` (check exact set: trace uses CMD.SEND_TRACE_PATH; getStats uses CMD.GET_STATS + the STATS_TYPE *type*; login/anon/binary use CMD.*). `encode.ts` keeps `buildSendSelfAdvert` + `buildReboot` only — trim its now-unused `CMD`/`STATS_TYPE`/`TXT_TYPE` imports to what those two need.

### - [ ] Step 2: Move the status/telemetry decoders `decode.ts` → `repeater.ts`
Move verbatim: `StatusResponse`, `StatusField`, `parseStatusResponse`, `decodeStatusFields`, `formatUptime`; `TelemetryResponse`, `TelemetryField`, `CayenneDescriptor`, `CAYENNE_TYPES`, `decodeCayenneLPP`, `parseTelemetryResponse`. Append to `repeater.ts`. `decode.ts` is now empty → **delete the file**.

### - [ ] Step 3: Repoint `session.ts` imports
- The 9 encoders: change their import from `./encode` → `./repeater` (merge into the existing `./repeater` import block).
- `parseStatusResponse`, `parseTelemetryResponse`: change from `./decode` → `./repeater`; **remove the now-empty `./decode` import line**.
- `encode.ts` import block in session: keep `buildSendSelfAdvert`, `buildReboot`; remove the 9 moved names.

### - [ ] Step 4: Relocate unit tests
- New `tests/unit/main/protocol/repeater.test.ts`: move the 9 encoder cases from `encode.test.ts` (buildLogout / buildSendStatusReq / buildSendTelemetryReq / buildSendLogin / buildSendAnonReq / buildAnonLogin / buildSendBinaryReq / buildSendTracePath / buildGetStats + the "rejects pubkeys < 32 bytes" case) **byte-assertions preserved**, and the `parseStatusResponse` / `parseTelemetryResponse` cases from `decode.test.ts`. Import from `../../../../src/main/protocol/repeater`.
- Trim `encode.test.ts` imports/cases to the survivors (`buildSendSelfAdvert`, `buildReboot`). **Delete `decode.test.ts`** (it only held the two relocated cases).
- Sweep for orphaned `Buffer`/`hex`/`pk` helpers.

### - [ ] Step 5: Full suite + `pnpm typecheck` (0) + biome `--write`. Commit: `refactor(protocol): consolidate the repeater wire layer into repeater.ts (retire decode.ts)`.

---

## Task 2: `features/repeaterAdmin.ts` — state + methods + handlers + hooks (HIGH RISK — test-guarded)

**Files:** Create `src/main/protocol/features/repeaterAdmin.ts`, `tests/integration/inbound/repeater-admin.test.ts`. Modify `session.ts`.

### - [ ] Step 1: Write characterization tests FIRST (`tests/integration/inbound/repeater-admin.test.ts`)
No existing integration coverage. Pin the flows; run GREEN against the present session, then keep guarding after the move. Model after `dm-send-ack.test.ts`. Cover:
- **Login round-trip:** seed a repeater contact (full 32B pubkey). `repeaterLogin(key, 'pw')` writes `CMD_SEND_ANON_REQ` (0x39, default mesh mode) or `CMD_SEND_LOGIN` (0x1a if `preferDirect`). Emit `PUSH_LOGIN_SUCCESS` (`[0x85][perms][6B prefix]…`, 15B form) for that prefix → the promise resolves with `isAdmin` + `mode`/`effective`, and `adminSessions.getSession(key)` is set.
- **onSentTag binary-req round-trip (owner info):** `repeaterRequestOwnerInfo(key)` writes `CMD_SEND_BINARY_REQ` (0x32, reqData `[0x07]`). Emit `RESP_SENT` (`[0x06][flood][tag u32][est u32]`) → the admin queue consumes the tag (DM queue untouched). Emit `PUSH_BINARY_RESPONSE` (`[0x8c][0][tag u32][ascii "fw\nname\nowner"]`) with the same tag → the promise resolves to `{firmwareVersion,nodeName,ownerInfo}`. **This is the critical seam test** — it exercises `writeAdminAndAwaitTag` → `onSentTag` → `adminSessions.awaitTag`/`resolveTag`.
- **Status response emit:** `sendStatusReq(key)` writes `0x1b`; emit `PUSH_STATUS_RESPONSE` (`[0x87][0][6B prefix][stats…]`) → asserts a `repeaterStatus` bus event with the contact key.
- **Telemetry response emit:** parallel with `0x27` / `PUSH_TELEMETRY_RESPONSE` (0x8b) + a CayenneLPP field → `repeaterTelemetry` event.
- **Local stats:** `repeaterGetLocalStats('CORE')` writes `CMD_GET_STATS` (0x38, subtype 0); emit `RESP_STATS` (`[0x18][0][battMv u16][uptime u32][errFlags u16][queueLen u8]`) → resolves `{kind:'core',…}`.
- **CLI:** `repeaterSendCli(key,'cmd')` writes a CLI DM (`0x02`, txt_type=CLI_DATA); emit `RESP_CONTACT_MSG_RECV_V3` (0x10) with `txt_type=1` from that prefix → the promise resolves to the body (and the message is NOT stored).

Run `pnpm test:integration -- repeater-admin` → PASS on current code.

### - [ ] Step 2: Create `repeaterAdmin.ts`
- **State + interfaces** (moved from session): `PendingAdminSent`, `PendingCli`, the `adminSentQueue`/`pendingCli`/`pendingLocalStats` module-level vars, and the consts `ADMIN_SENT_TIMEOUT_MS`/`ADMIN_REPLY_TIMEOUT_MS`/`CLI_REPLY_TIMEOUT_MS`.
- **`registerAdminHooks(): void`** — the inline `start()` block, with `this.adminSentQueue`→`adminSentQueue`, `this.pendingCli`→`pendingCli`:
  ```ts
  export function registerAdminHooks(): void {
    directMessages.setAdminHooks({
      onSentTag: (tagHex) => {
        const a = adminSentQueue.shift();
        if (!a) return false;
        clearTimeout(a.timer); a.resolve(tagHex); return true;
      },
      onCliReply: (prefix, body) => {
        const p = pendingCli.get(prefix);
        if (!p) return false;
        clearTimeout(p.timer); pendingCli.delete(prefix); p.resolve(body); return true;
      },
    });
  }
  ```
- **Private helpers** (verbatim, `this.writeFrame`→`ctx.writeFrame`, `this.adminSentQueue`→`adminSentQueue`): `lookupRepeaterContact(contactKey)` (session:1006-1017), `writeAdminAndAwaitTag(ctx, frame)` (988-1004), `sendBinaryReq(ctx, contactKey, reqData)` (977-983).
- **Public methods** (verbatim bodies, add `ctx` param, `this.writeFrame`→`ctx.writeFrame`, `this.lookupRepeaterContact`→`lookupRepeaterContact`, `this.sendBinaryReq`→`sendBinaryReq(ctx,…)`, `this.pendingCli`/`this.pendingLocalStats`→module state, `directMessages.*` unchanged): `sendStatusReq` (320-334), `sendTelemetryReq` (337-351), `repeaterLogin` (363-405), `repeaterLogout` (844-849), `repeaterRequestAcl` (852-856), `repeaterRequestNeighbours` (858-884), `repeaterRequestOwnerInfo` (886-890), `repeaterSendCli` (896-935), `repeaterTracePath` (939-953), `repeaterGetLocalStats` (957-972).
- **`repeaterAdminFeature: Feature`** over the 8 codes — `handle(code, frame, _ctx)` switch reproducing the legacy branches (session:1376-1422) + `handleStatusResponse` (1436-1457) + `handleTelemetryResponse` (1459-1480): STATUS_RESPONSE→status emit, TELEMETRY_RESPONSE→telemetry emit, LOGIN_SUCCESS→`adminSessions.resolveLogin`, LOGIN_FAIL→`adminSessions.rejectLogin`, BINARY_RESPONSE→`adminSessions.resolveTag`, TRACE_DATA→`adminSessions.resolveTag`, RAW_DATA→`log.trace`, STATS→resolve `pendingLocalStats`.
- **`resetAdmin(reason)`** — the disconnect cleanup (session:1113-1139):
  ```ts
  export function resetAdmin(reason: string): void {
    while (adminSentQueue.length > 0) {
      const e = adminSentQueue.shift();
      if (e) { clearTimeout(e.timer); e.reject(new Error(reason)); }
    }
    for (const e of pendingCli.values()) { clearTimeout(e.timer); e.reject(new Error(reason)); }
    pendingCli.clear();
    if (pendingLocalStats) {
      clearTimeout(pendingLocalStats.timer); pendingLocalStats.reject(new Error(reason)); pendingLocalStats = null;
    }
    adminSessions.reset(reason);
  }
  ```

### - [ ] Step 3: Update `session.ts` — register, delegate, delete
- Register `repeaterAdminFeature` in `FeatureRegistry([...])`.
- `start()`: replace the `directMessages.setAdminHooks({...})` block (session:232-248) with `repeaterAdmin.registerAdminHooks();`.
- Delete the 8 legacy `onPacket` branches (STATUS_RESPONSE / TELEMETRY_RESPONSE / LOGIN_SUCCESS / LOGIN_FAIL / BINARY_RESPONSE / TRACE_DATA / RAW_DATA / STATS) and the private `handleStatusResponse` / `handleTelemetryResponse` methods.
- Delete the state fields `adminSentQueue` / `pendingCli` / `pendingLocalStats` + the `PendingAdminSent` / `PendingCli` interfaces + the `ADMIN_SENT_TIMEOUT_MS` / `ADMIN_REPLY_TIMEOUT_MS` / `CLI_REPLY_TIMEOUT_MS` consts.
- `onTransportState` disconnect: replace the four admin cleanup blocks (adminSentQueue / pendingCli / pendingLocalStats / `adminSessions.reset`) with a single `repeaterAdmin.resetAdmin('transport disconnected')`.
- `stop()`: add `repeaterAdmin.resetAdmin('session stopped')` (parity with resetDrain/resetDmState/resetContactsIter).
- Delegate the 10 public methods: each body becomes `return repeaterAdmin.<name>(this.ctx, …same args…)`.
- Delete the private `sendBinaryReq` / `writeAdminAndAwaitTag` / `lookupRepeaterContact`.
- Remove now-unused imports: the repeater decoders only used by the moved handlers (`parseLoginSuccess`/`parseLoginFail`/`parseBinaryResponse`/`parseTraceData`/`parseRawData`/`parseLocalStats`/`parseStatusResponse`/`parseTelemetryResponse`); the 9 encoders; `AdminMode`/`AdminRole`/`adminSessions` if no longer referenced in session; the repeater result types (`AclEntry`/`LocalStats`/`LoginFail`/`LoginSuccess`/`NeighboursPage`/`OwnerInfo`/`TraceData`) IF only used by the moved method signatures (the delegators infer return types from the module, so most can go — let typecheck tell you which remain). Add `import * as repeaterAdmin from './features/repeaterAdmin'`.

### - [ ] Step 4: Full suite + typecheck 0 + biome. The Step-1 tests + existing routes tests green. Verify legacy `onPacket` branch count dropped by 8. Commit: `refactor(protocol): migrate repeater administration to a feature module (close the admin-hook seam)`.

---

## Cross-phase note (record on completion)
- The Phase 2e admin-hook seam is now **closed**: `repeaterAdmin` owns `adminSentQueue`/`pendingCli` and registers the `directMessages` hooks. Update the spec's Phase 2e note to mark it resolved.
- `telemetry` was folded into `repeaterAdmin` (not a separate module). Note in the spec that it may split when a non-repeater telemetry source lands.
- CayenneLPP now lives in `repeater.ts` (not `decode.ts`) — Phase 4's "complete the CayenneLPP table" enhancement retargets there. Update the spec reference.

## Self-Review
- **Coverage:** all 8 inbound repeater codes + 10 public methods + 3 private helpers + 3 state fields + the hook seam + disconnect/stop reset assigned to tasks. ✅
- **Risk isolation:** Task 1 (wire consolidation) is a behavior-neutral relocation guarded by relocated unit tests; Task 2 carries the dispatch + seam change, guarded by a new integration test written green before the move. ✅
- **Seam fidelity:** `registerAdminHooks` reproduces the exact shift/resolve the session did; `onSentTag` still runs before the DM FIFO (guarded by the binary-req round-trip test); `adminSessions` tag/login keying unchanged. ✅
- **No scattered wire layer left:** `decode.ts` deleted; repeater encoders out of `encode.ts`; the feature imports one wire module (`repeater.ts`). ✅
