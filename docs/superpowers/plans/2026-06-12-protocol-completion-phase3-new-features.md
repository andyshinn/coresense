# Protocol Completion — Phase 3: New Feature Groups (B–I) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or executing-plans. Steps use checkbox (`- [ ]`).

**Goal:** Add the ~24 new companion-protocol commands toward firmware v1.16.0 parity, as registry-native feature modules. Pure additive — no migration. Protocol layer only (codes + encode/decode + ProtocolSession methods + tests; NO IPC/UI).

**Method:** TDD with golden-byte tests. Every command's wire layout is cross-checked against the firmware source (`/Users/andy/GitHub/meshcore-dev/MeshCore/examples/companion_radio/MyMesh.cpp`) and, where present, the reference lib (`/Users/andy/GitHub/meshcore-dev/meshcore.js`) BEFORE coding. The spec Appendix layouts are the starting point but firmware is the contract (the spec warns they are extraction-time references).

**Tech Stack:** TypeScript, Vitest, `pnpm typecheck`, Biome (`pnpm exec biome check src tests`).

**Process constraints (carry forward):** stay on `feat/protocol-completion`; never `git checkout`/`switch`/`reset`/`stash`/`restore`; never touch `OwnerCard.tsx`; commit trailer `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`; `git commit` needs sandbox disabled; biome scope `src tests`.

---

## Architecture for new modules

Each module follows the existing pattern (e.g. `radioParams.ts`, `time.ts`):
- Pure `encode*`/`decode*` + a result type.
- ProtocolSession methods (`get*`/`set*`/`send*`) — thin, calling the module with `this.ctx`.
- **Request/response** commands use `ctx.request(frame, { expect })` (typed reply via pendingTyped, tier 1 of onPacket) or `ctx.request(frame)` (RESP_OK/ERR). **No registry Feature needed** unless the module reacts to an unsolicited PUSH or a dual-reply (`RESP_X | RESP_DISABLED`).
- Modules reacting to a PUSH or needing dual-reply correlation register a `Feature` in `FeatureRegistry`.

New codes go into `codes.ts` (`CMD` / `RESP` / `PUSH`). Verify each new RESP/PUSH code does not collide with an existing inbound code before adding.

## Sequencing (by infrastructure dependency, lowest-risk first)

- **3a — Radio tuning (group D).** Pure request/response, fully firmware-verified, no new infra. **First — establishes the pattern.** (This plan details it below.)
- **3b — Flood scope (group F).** Request/response + a variable-length GET reply (48 B when set, 1 B when clear). No new infra.
- **3c — Misc (group I).** `hasConnection` (OK/ERR), `getAllowedRepeatFreq` (typed reply, N×8 B ranges), `SET_ADVERT_LATLON` optional `alt` extension, and a `PUSH_ADVERT` (0x80) Feature (known-contact re-advert → touch contact). First module with a registry Feature.
- **3d — Device admin (group C).** export/import private key, set PIN, factory-reset. Needs a new `FeatureDisabledError` and **dual-reply handling** (`RESP_PRIVATE_KEY | RESP_DISABLED`) — a small Feature that correlates the in-flight call (the `request({expect})` FIFO can't express "either code"). Build-gated commands are frame-tested only.
- **3e — Message signing (group E).** Stateful `signData(bytes)` = SIGN_START → chunked SIGN_DATA → SIGN_FINISH → RESP_SIGNATURE, with `RESP_SIGN_START` max-len budget + `BAD_STATE` guards. Request/response per step; the state machine lives in the module.
- **3f — Path diagnostics (group G).** `sendPathDiscoveryReq` (RESP_SENT tag → **await-by-tag** → `PUSH_PATH_DISCOVERY_RESPONSE`), `getAdvertPath` (typed reply), `PUSH_PATH_UPDATED` Feature. **Requires `ctx.awaitTag`** (not yet on FeatureContext) — add it here, backed by the same mechanism repeaterAdmin uses (adminSentQueue-style or a dedicated tag map).
- **3g — Raw/control/channel data (group H).** `sendRawData`/`sendRawPacket`/`sendControlData`/`sendChannelData` + `PUSH_CONTROL_DATA` / `RESP_CHANNEL_DATA_RECV` Feature.
- **3h — Contact interop (group B).** `shareContact`/`exportContact`/`importContact`/`getContactByKey`. Export/import blobs need the **borrowed Advert parser** (Phase 4 overlap) — do alongside or after Phase 4's Advert. `getContactByKey` replies `RESP_CONTACT` (0x03) — it MUST correlate inside `contactsFeature` (the recorded hazard), NOT via the `pendingTyped` FIFO.

Each sub-phase is its own commit (codes + module + unit golden tests + integration test + session delegators), full suite green. Detail for 3b+ is filled in when reached (after firmware re-verification of that group's layouts).

---

## Task 3a: Radio tuning (group D) — request/response, no Feature

**Firmware-verified** (MyMesh.cpp:1411-1428): `CMD_SET_TUNING_PARAMS=0x15`, `CMD_GET_TUNING_PARAMS=0x2b`, `RESP_CODE_TUNING_PARAMS=0x17`. SET reads `rx`,`af` as u32 LE at bytes 1,5 and divides by 1000 into floats; GET replies `[0x17][rx u32][af u32]` with `×1000`. Firmware constrains `rx_delay_base` 0–20, `airtime_factor` 0–9.

**Files:** Create `src/main/protocol/features/tuning.ts`, `tests/unit/main/protocol/features/tuning.test.ts`, `tests/integration/outbound/tuning.test.ts`. Modify `codes.ts`, `session.ts`.

### - [ ] Step 1: Add codes
`CMD`: `SET_TUNING_PARAMS: 0x15`, `GET_TUNING_PARAMS: 0x2b`. `RESP`: `TUNING_PARAMS: 0x17`. (All three slots confirmed free.)

### - [ ] Step 2: `tuning.ts`
- `TuningParams { rxDelayBase: number; airtimeFactor: number }`.
- `encodeSetTuningParams(p)` → `[0x15][round(rx*1000) u32 LE][round(af*1000) u32 LE]`.
- `encodeGetTuningParams()` → `[0x2b]`.
- `decodeTuningParams(frame)` → null if `<9`, else `{ rxDelayBase: u32@1/1000, airtimeFactor: u32@5/1000 }`.
- `getTuningParams(ctx)`: `ctx.request(encodeGetTuningParams(), { expect: RESP.TUNING_PARAMS })` → `decodeTuningParams` (throw on malformed).
- `setTuningParams(ctx, p)`: `await ctx.request(encodeSetTuningParams(p))` (RESP_OK; throws ProtocolError on ERR).

### - [ ] Step 3: Unit golden tests
- `encodeSetTuningParams({rxDelayBase: 10, airtimeFactor: 1})` → `15` + `10000` LE (`10270000`) + `1000` LE (`e8030000`) = `151027000 0e8030000` (verify exact hex).
- `encodeGetTuningParams()` → `2b`.
- `decodeTuningParams` round-trips a built RESP frame; returns null below 9 bytes.

### - [ ] Step 4: ProtocolSession delegators
`async getTuningParams(): Promise<TuningParams> { return tuning.getTuningParams(this.ctx); }` and `async setTuningParams(p: TuningParams): Promise<void> { return tuning.setTuningParams(this.ctx, p); }`. Import `* as tuning` (or named) — `TuningParams` type re-exported for callers.

### - [ ] Step 5: Integration test
- `getTuningParams()` writes `0x2b`; emit `RESP_TUNING_PARAMS` frame → promise resolves to the decoded `{rxDelayBase, airtimeFactor}`.
- `setTuningParams({...})` writes the 9-byte `0x15` frame; emit `RESP_OK` (`[0x00]`) → resolves; emit `RESP_ERR` → rejects `ProtocolError`.

### - [ ] Step 6: Full suite + typecheck 0 + biome. Commit: `feat(protocol): add radio tuning params (get/set) — phase 3 group D`.

## Self-Review
- Layout firmware-verified (MyMesh.cpp:1411-1428). ✅
- Request/response only → no registry Feature, no onPacket change. ✅
- Golden bytes pin the ×1000 scaling + LE order. ✅
- Pattern established for 3b+ (codes → module → golden unit → session delegator → integration). ✅
