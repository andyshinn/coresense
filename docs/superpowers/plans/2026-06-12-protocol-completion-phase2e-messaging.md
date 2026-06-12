# Protocol Completion — Phase 2e: Messaging Cluster Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Migrate the messaging cluster — the inbox **drain** pump (`PUSH_MSG_WAITING` / `RESP_NO_MORE_MESSAGES`), **channels** slot management + enumeration (`RESP_CHANNEL_INFO`), **channel messages** (`RESP_CHANNEL_MSG_RECV` V1/V3 + send), and **direct messages** (`RESP_CONTACT_MSG_RECV` V1/V3 + `RESP_SENT` + `PUSH_SEND_CONFIRMED` + DM send/ack state machine) — out of `ProtocolSession` into four registered feature modules. Behavior-preserving.

**Architecture / the couplings this phase resolves:**
- **Drain cross-cuts both message handlers.** `handleChannelMsg` and `handleContactMsg` both call `pumpNextDrain()`. So `drain.ts` is migrated FIRST and owns `drainBusy`/`drainPending` + `scheduleDrain()`/`pumpAfterRecv()`; the message modules import `pumpAfterRecv` directly (module-singleton pattern). The handshake calls `scheduleDrain()`; disconnect calls `resetDrain()`.
- **`channelByIdx` + `devicePresence` are co-owned** by channel enumeration (`RESP_CHANNEL_INFO`), channel-message dispatch (reads the idx→Channel map), the channel send path, and the channel CRUD methods. They live in ONE owner, `channels.ts`; `channelMessages.ts` reads via `getChannelByIdx(idx)`.
- **`setChannel` already uses the session ack FIFO** (`awaitAck`/`pendingAcks`). `ctx.request(frame)` (no `expect`) wraps that *exact* FIFO, so `setChannel` re-expresses as `try { await ctx.request(...) } catch { false }` with identical ack semantics.
- **DM handlers are entangled with the Phase 2f admin queues.** `handleSent` gives `adminSentQueue` first crack at the RESP_SENT tag; `handleContactMsg` routes `txt_type=CLI_DATA` replies to `pendingCli`. Those queues are repeater-admin (Phase 2f) and STAY in the session. `directMessages.ts` owns the opcodes and exposes an **admin-intercept hook seam** (`setAdminHooks({ onSentTag, onCliReply })`) + DM-queue helpers (`enqueueDmSend`/`dequeueDmSend`) that the session registers/uses at `start()`. When Phase 2f migrates repeater-admin, the admin module registers the hooks instead; the session loses the queues. This is the direct analog of the approved `contactsSync` bridge from Phase 2d.

**Tech Stack:** TypeScript, Vitest (`pnpm test:unit` / `pnpm test:integration`), `pnpm typecheck` (tsc --noEmit, noUnusedLocals on), Biome (`pnpm exec biome check src tests`, `--write` to autofix).

**Process constraints (carry forward):** stay on `feat/protocol-completion`; never `git checkout`/`switch`/`reset`/`stash`/`restore` (reviewers inspect read-only via `git diff`/`git show`); never read or modify `src/renderer/shell/leftnav/OwnerCard.tsx`; commit trailer `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`; `git commit` needs `dangerouslyDisableSandbox: true`; biome scope `src tests`; **encoders/decoders move VERBATIM** (rename `build*`→`encode*`, `parse*`→`decode*`; byte layout byte-identical).

---

## Module map (state at phase completion)

### `src/main/protocol/features/drain.ts`
- **Encoder:** `encodeGetNextMsg()` (from `buildGetNextMsg`).
- **State (module-level):** `let drainBusy = false; let drainPending = false;`
- **API:** `scheduleDrain(ctx)`, `pumpAfterRecv(ctx)` (from `pumpNextDrain`), `resetDrain()`.
- **`drainFeature: Feature`** handling `[PUSH.MSG_WAITING, RESP.NO_MORE_MESSAGES]`.
- Connected guard: `transportManager.getState().state === 'connected'` (replaces `this.connected`).

### `src/main/protocol/features/channels.ts`
- **Encoders:** `encodeGetChannel(idx)`, `encodeSetChannel(idx,name,secretHex)`, `deriveChannelSecret(name)`.
- **Decoder:** `decodeChannelInfo(frame)` + `ChannelInfo`.
- **State (module-level):** `const channelByIdx = new Map<number, Channel>(); const devicePresence = new Set<string>();`
- **API:** `getChannelByIdx(idx)`, `setChannel(ctx,idx,name,secretHex)`, `markChannelPresent(channel)`, `markChannelAbsent(idx)`, `pickFreeSlot()`, `getDevicePresence()`, `clearPresence()`, `rebuildIndexes()`, `deriveSecret(name)`.
- **`channelsFeature: Feature`** handling `[RESP.CHANNEL_INFO]`.

### `src/main/protocol/features/channelMessages.ts`
- **Encoder:** `encodeSendChannelText(opts)` (from `buildSendChannelText`).
- **Decoders:** `decodeChannelMsgV3(frame)` / `decodeChannelMsgV1(frame)` + `ChannelMsgV3` + private `splitSenderPrefix`.
- **API:** `sendChannelText(ctx, channelKey, text)`.
- **`channelMessagesFeature: Feature`** handling `[RESP.CHANNEL_MSG_RECV_V3, RESP.CHANNEL_MSG_RECV]`.
- Deps imported directly: `getChannelByIdx` (channels), `pumpAfterRecv` (drain), `consumeMatching` (meshObservations), `channelHashOf`/`buildPath` (paths).

### `src/main/protocol/features/directMessages.ts`
- **Encoder:** `encodeSendDmText(opts)` (from `buildSendDmText`).
- **Decoders:** `decodeContactMsgV3`/`decodeContactMsgV1` + `ContactMsgV3`; `decodeSentAck` + `SentAck`; `decodeSendConfirmed` + `SendConfirmed`.
- **State (module-level):** `const dmSendQueue: string[] = []; const pendingDmAcks = new Map<string,{messageId:string;timer:NodeJS.Timeout}>();`
- **API:** `sendDmText(ctx,...)`, `sendDmTextWithRetry(ctx,...)`, `failOldestDmSend(reason)`, `enqueueDmSend(id)`, `dequeueDmSend(id)`, `resetDmState(reason)`, `setAdminHooks({onSentTag,onCliReply})`.
- **`directMessagesFeature: Feature`** handling `[RESP.CONTACT_MSG_RECV_V3, RESP.CONTACT_MSG_RECV, RESP.SENT, PUSH.SEND_CONFIRMED]`.
- Deps imported directly: `pumpAfterRecv` (drain).

**Registration order at completion** (`FeatureRegistry([...])`): existing 7 + `drainFeature, channelsFeature, channelMessagesFeature, directMessagesFeature`.

---

## Task 1: `drain.ts` — the inbox pump (keystone, LOW–MEDIUM RISK)

The message modules depend on `pumpAfterRecv`, so drain migrates first. After this task the still-in-session `handleChannelMsg`/`handleContactMsg` call the module's `pumpAfterRecv(this.ctx)` and the handshake calls `scheduleDrain(this.ctx)`.

**Files:** Create `src/main/protocol/features/drain.ts`, `tests/integration/inbound/drain.test.ts`. Modify `session.ts`, `encode.ts`, `encode.test.ts`.

### - [ ] Step 1: Write the failing regression test FIRST (`tests/integration/inbound/drain.test.ts`)

There is no existing drain integration test. Pin current behavior through the public bus surface (model after `contacts-iterator.test.ts`):
- `session.start()`; fake-transport connected. Emit `PUSH_MSG_WAITING` (`Buffer.from([0x83])`) → assert the transport sent `CMD_GET_NEXT_MSG` (`0x0a`) after `DRAIN_INTERVAL_MS`.
- While a drain is in flight, a second `PUSH_MSG_WAITING` sets `drainPending` (no immediate extra write); after `RESP_NO_MORE_MESSAGES` (`Buffer.from([0x0a])`) the pending drain fires one more `0x0a`.
- After a `*_MSG_RECV` is handled the pump issues the next `0x0a` (covered indirectly by channel/contact recv; assert here via a contact-msg frame that the follow-up `0x0a` is written).
- Use fake-transport's sent-frame capture (`sentFrames()` or equivalent — match how `send-channel.test.ts` reads writes) and `vi.useFakeTimers()` / advance for `DRAIN_INTERVAL_MS` (250ms).

Run: `pnpm test:integration -- drain` → **PASS against the CURRENT session implementation** (this is a characterization test; it must pass before the move so it can guard the move).

### - [ ] Step 2: Create `drain.ts`

```ts
import { Buffer } from 'node:buffer';
import { emit } from '../../events/bus';            // not needed unless logging; prefer child logger
import { child } from '../../log';
import { transportManager } from '../../transport/manager';
import { CMD, PUSH, RESP } from '../codes';
import type { Feature, FeatureContext } from '../feature';

const log = child('protocol');
const DRAIN_INTERVAL_MS = 250;

export function encodeGetNextMsg(): Buffer {
  return Buffer.from([CMD.GET_NEXT_MSG]);
}

let drainBusy = false;
let drainPending = false;

function isConnected(): boolean {
  return transportManager.getState().state === 'connected';
}

/** Pump CMD_GET_NEXT_MSG. One PUSH_MSG_WAITING per queue event, so chain
 *  GET_NEXT_MSG until RESP_NO_MORE_MESSAGES. drainBusy clears only on
 *  NO_MORE_MESSAGES (see drainFeature), not after writeFrame returns. */
export async function scheduleDrain(ctx: FeatureContext): Promise<void> {
  if (drainBusy) { drainPending = true; return; }
  drainBusy = true;
  await sleep(DRAIN_INTERVAL_MS);
  try {
    await ctx.writeFrame(encodeGetNextMsg());
  } catch (err) {
    log.warn(`drain write failed: ${(err as Error).message}`);
    drainBusy = false;
    if (drainPending) { drainPending = false; void scheduleDrain(ctx); }
  }
}

/** Called after a *_MSG_RECV is handled while a drain is active. */
export function pumpAfterRecv(ctx: FeatureContext): void {
  if (!isConnected()) return;
  ctx.writeFrame(encodeGetNextMsg()).catch((err) => {
    log.warn(`drain pump write failed: ${(err as Error).message}`);
    drainBusy = false;
  });
}

/** True while a drain round is active — message handlers gate pumpAfterRecv on this. */
export function isDraining(): boolean { return drainBusy; }

export function resetDrain(): void { drainBusy = false; drainPending = false; }

export const drainFeature: Feature = {
  handles: [PUSH.MSG_WAITING, RESP.NO_MORE_MESSAGES],
  handle: (code, _frame, ctx) => {
    if (code === PUSH.MSG_WAITING) { void scheduleDrain(ctx); return; }
    // RESP.NO_MORE_MESSAGES
    drainBusy = false;
    log.trace('drain done: NO_MORE_MESSAGES');
    if (drainPending) { drainPending = false; void scheduleDrain(ctx); }
  },
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
```
> Drop the unused `emit` import. `isDraining()` replaces `this.drainBusy` reads in the still-in-session message handlers (`if (this.drainBusy) this.pumpNextDrain()` → `if (isDraining()) pumpAfterRecv(this.ctx)`).

### - [ ] Step 3: Relocate the `buildGetNextMsg` unit case from `encode.test.ts` → a small `drain` unit test (or fold into `drain.test.ts`); rename to `encodeGetNextMsg`. Remove `buildGetNextMsg` from `encode.ts` + its `encode.test.ts` import.

### - [ ] Step 4: Update session
- Register `drainFeature` in `FeatureRegistry([...])`.
- Delete the two legacy `onPacket` branches: `if (code === PUSH.MSG_WAITING) { void this.scheduleDrain(); return; }` and the `if (code === RESP.NO_MORE_MESSAGES) {...}` block.
- Delete the private `scheduleDrain` + `pumpNextDrain` methods and the `drainBusy`/`drainPending` fields.
- Repoint callers still in session: handshake `void this.scheduleDrain()` (~1499) → `void scheduleDrain(this.ctx)`; the three `if (this.drainBusy) this.pumpNextDrain()` (in `handleChannelMsg` ~1914, `handleContactMsg` ~1707/1749) → `if (isDraining()) pumpAfterRecv(this.ctx)`.
- In `stop()` / disconnect cleanup add `resetDrain()`.
- Remove the `buildGetNextMsg` import from the `./encode` block; add `import { drainFeature, isDraining, pumpAfterRecv, resetDrain, scheduleDrain } from './features/drain'`.

### - [ ] Step 5: Run the Step-1 test (now guarding the MOVED code) + full suite + `pnpm typecheck` (0) + biome `--write`. Verify legacy branch count dropped by 2. Commit: `refactor(protocol): migrate the inbox drain pump to a feature module`.

---

## Task 2: `channels.ts` — slot map, presence, enumeration (MEDIUM RISK)

Owns `channelByIdx` + `devicePresence` + `RESP_CHANNEL_INFO`. The session keeps thin public delegating methods (they're called from IPC/route handlers — verify with `grep -rn "\.markChannelPresent\|\.markChannelAbsent\|\.pickFreeSlot\|\.getDevicePresence\|\.deriveSecret\|\.setChannel" src` and keep every public signature identical).

**Files:** Create `src/main/protocol/features/channels.ts`. Modify `session.ts`, `encode.ts`, `decode.ts`, `encode.test.ts`, `decode.test.ts`. Existing `tests/integration/outbound/send-channel.test.ts` is the regression guard for `setChannel` + presence; keep it green.

### - [ ] Step 1: Create `channels.ts` with the wire layer + state + methods
- Move verbatim (renamed): `buildGetChannel`→`encodeGetChannel`, `buildSetChannel`→`encodeSetChannel`, `deriveChannelSecret` (keep name) from `encode.ts`; `parseChannelInfo`→`decodeChannelInfo` + `ChannelInfo` + `CHANNEL_INFO_FRAME_LEN` from `decode.ts`.
- Module state: `const channelByIdx = new Map<number, Channel>(); const devicePresence = new Set<string>();`
- `export function getChannelByIdx(idx: number): Channel | undefined { return channelByIdx.get(idx); }`
- `markChannelPresent(channel)`, `markChannelAbsent(idx)`, `pickFreeSlot()`, `getDevicePresence()`, `clearPresence()` (`devicePresence.clear(); emit.channelPresence([])`), `rebuildIndexes()`, `deriveSecret(name)` — verbatim bodies from session, `this.deps.channelByIdx`→`channelByIdx`, `this.devicePresence`→`devicePresence`, each `emit.channelPresence([...this.devicePresence])`→`emit.channelPresence([...devicePresence])`.
- `setChannel(ctx, idx, name, secretHex): Promise<boolean>`:
  ```ts
  export async function setChannel(ctx: FeatureContext, idx: number, name: string, secretHex: string): Promise<boolean> {
    if (transportManager.getState().state !== 'connected') return false;
    try {
      await ctx.request(encodeSetChannel(idx, name, secretHex), { timeoutMs: SET_CHANNEL_TIMEOUT_MS });
      return true;
    } catch {
      return false;
    }
  }
  ```
  > `ctx.request` (no `expect`) wraps the SAME `pendingAcks` FIFO + same timeout the old `awaitAck(SET_CHANNEL_TIMEOUT_MS)` used; it throws `ProtocolError` on RESP_ERR/timeout, which the `catch` maps back to `false` — behavior-identical. Define `SET_CHANNEL_TIMEOUT_MS = 2000` in this module.
- `channelsFeature`: `handles: [RESP.CHANNEL_INFO]`, `handle` = the verbatim `handleChannelInfo` body (`parseChannelInfo`→`decodeChannelInfo`, `this.deps.channelByIdx`→`channelByIdx`, `this.devicePresence`→`devicePresence`, `stateHolder()`/`emit.*` unchanged).
- Imports: `{ Buffer }`, `Channel` type, `emit`, `child`, `stateHolder`, `transportManager`, `CMD`, `RESP`, `type Feature, FeatureContext`, `createHash` (for deriveChannelSecret).

### - [ ] Step 2: Relocate unit cases for `encodeGetChannel`/`encodeSetChannel`/`deriveChannelSecret`/`decodeChannelInfo` from `encode.test.ts`/`decode.test.ts` into `tests/unit/main/protocol/features/channels.test.ts` (rename, byte assertions preserved). Sweep for orphaned helpers/imports.

### - [ ] Step 3: Update session — delegate + register + delete
- Register `channelsFeature`.
- Delete the legacy `if (code === RESP.CHANNEL_INFO) { this.handleChannelInfo(frame); return; }` branch and the private `handleChannelInfo` method.
- Delete the `deps.channelByIdx` map field + `devicePresence` field + `markChannelPresent`/`markChannelAbsent`/`pickFreeSlot`/`handleChannelInfo`/`rebuildIndexes` private bodies; replace the public methods with thin delegators:
  ```ts
  markChannelPresent(channel: Channel): void { markChannelPresent(channel); }   // module import aliased
  markChannelAbsent(idx: number): void { markChannelAbsent(idx); }
  pickFreeSlot(): number | null { return pickFreeSlot(); }
  getDevicePresence(): string[] { return getDevicePresence(); }
  deriveSecret(name: string): string { return deriveSecret(name); }
  async setChannel(idx, name, secretHex): Promise<boolean> { return setChannel(this.ctx, idx, name, secretHex); }
  ```
  > Alias the module imports to avoid name collisions with the delegating methods, e.g. `import { markChannelPresent as channelsMarkPresent, ... } from './features/channels'`, or keep the session method names distinct. Pick whichever the reviewer finds cleaner; the public method names on `ProtocolSession` MUST stay exactly as today.
- `handshake()` channel-enumeration loop: `buildGetChannel(i)` → `encodeGetChannel(i)`; the loop stays in the handshake (it's connect-orchestration). `rebuildIndexes()` call in `start()` → module `rebuildIndexes()`.
- `onTransportState`: the two `this.devicePresence.clear(); emit.channelPresence([...this.devicePresence])` sites → `clearPresence()`. `getDevicePresence()` public method → module.
- `purgeCorruptedChannels()` stays in session (it cleans persisted storage, not the map).
- Remove `SET_CHANNEL_TIMEOUT_MS` from session if now unused there (grep — it may still be referenced by `awaitAck`'s default; `awaitAck` default is `SET_CHANNEL_TIMEOUT_MS` — KEEP the const in session if `awaitAck` still defaults to it, OR change `awaitAck`'s default. Simplest: leave `awaitAck` and its default const in session untouched; define a separate copy in channels.ts. Confirm no dead-const lint).
- Imports: remove `buildGetChannel`/`buildSetChannel`/`deriveChannelSecret` from `./encode`, `parseChannelInfo`/`ChannelInfo` from `./decode`; add the channels-module imports.

### - [ ] Step 4: Full suite + typecheck 0 + biome. `send-channel.test.ts` green. Verify legacy branch count dropped by 1. Commit: `refactor(protocol): migrate channel slot management to a feature module`.

---

## Task 3: `channelMessages.ts` — channel recv V1/V3 + send (MEDIUM RISK)

**Files:** Create `src/main/protocol/features/channelMessages.ts`. Modify `session.ts`, `encode.ts`, `decode.ts`, `encode.test.ts`, `decode.test.ts`. Regression guards: existing `tests/integration/inbound/channel-message.test.ts` + `tests/integration/outbound/send-channel.test.ts` — keep both green unchanged.

### - [ ] Step 1: Create `channelMessages.ts`
- Move verbatim (renamed): `buildSendChannelText`→`encodeSendChannelText` (encode.ts); `parseChannelMsgV3`→`decodeChannelMsgV3`, `parseChannelMsgV1`→`decodeChannelMsgV1`, `ChannelMsgV3`, and the private `splitSenderPrefix` (decode.ts — confirm `splitSenderPrefix` has no other consumer via `grep -rn splitSenderPrefix src`; it is private to decode.ts and used only by the two channel-msg parsers, so it moves wholesale).
- `export async function sendChannelText(ctx, channelKey, text)`: verbatim body from session `sendChannelText`, `buildSendChannelText`→`encodeSendChannelText`, `this.writeFrame`→`ctx.writeFrame`, `findIdxByKey(channelKey, this.deps.channelByIdx)` → use `getChannelByIdx`/`channelByIdx` from channels. NOTE: the current method reads `channel.idx ?? findIdxByKey(...)`. Move `findIdxByKey` into channels.ts (it scans `channelByIdx`) and export it, or re-express via `getChannelByIdx`. Keep the channelHash return contract (`channelHashOf(channel)`).
- `channelMessagesFeature`: `handles: [RESP.CHANNEL_MSG_RECV_V3, RESP.CHANNEL_MSG_RECV]`, `handle` = verbatim `handleChannelMsg` body. Substitutions: `parseChannelMsgV3/V1`→`decode*`; `this.deps.channelByIdx.get(parsed.channelIdx)`→`getChannelByIdx(parsed.channelIdx)`; `consumeMeshObs`→`consumeMatching`; `if (this.drainBusy) this.pumpNextDrain()`→`if (isDraining()) pumpAfterRecv(ctx)`; `stateHolder()`/`emit.messages`/`createHash`/`buildPath`/`channelHashOf` unchanged.
- Imports: `{ Buffer }`, `createHash`, `Channel`/`Message`/`MessagePath` types, `emit`, `child`, `stateHolder`, `CMD`, `RESP`, `type Feature, FeatureContext`, `getChannelByIdx` (channels), `isDraining`/`pumpAfterRecv` (drain), `consumeMatching` (meshObservations), `channelHashOf`/`buildPath` (paths).

### - [ ] Step 2: Relocate unit cases for `encodeSendChannelText` + `decodeChannelMsgV1/V3` into `tests/unit/main/protocol/features/channelMessages.test.ts`. Preserve byte/field assertions. Sweep orphans.

### - [ ] Step 3: Update session
- Register `channelMessagesFeature`.
- Delete the legacy `if (code === RESP.CHANNEL_MSG_RECV_V3 || code === RESP.CHANNEL_MSG_RECV) { this.handleChannelMsg(...); return; }` branch + private `handleChannelMsg`.
- Replace the public `sendChannelText` method with a thin delegator `return sendChannelText(this.ctx, channelKey, text)`.
- Remove now-unused session imports: `buildSendChannelText` (`./encode`), `parseChannelMsgV1`/`parseChannelMsgV3` (`./decode`), and `consumeMeshObs`/`buildPath`/`channelHashOf` IF no longer referenced in session (grep — `channelHashOf` is also used by `sendChannelText`'s return + nothing else after the move; `buildPath`/`consumeMeshObs` only used by `handleChannelMsg`). Remove `findIdxByKey` from session if moved to channels.
- Add channelMessages import.

### - [ ] Step 4: Full suite + typecheck 0 + biome. `channel-message.test.ts` + `send-channel.test.ts` green. Legacy branch count dropped by 1. Commit: `refactor(protocol): migrate channel messages to a feature module`.

---

## Task 4: `directMessages.ts` — DM recv/send/ack + the admin-hook seam (HIGH RISK — fully test-guarded)

**Files:** Create `src/main/protocol/features/directMessages.ts`, `tests/integration/inbound/dm-send-ack.test.ts`. Modify `session.ts`, `encode.ts`, `decode.ts`, `encode.test.ts`, `decode.test.ts`.

### - [ ] Step 1: Write characterization tests FIRST (`tests/integration/inbound/dm-send-ack.test.ts`)

No existing DM integration test. Pin current behavior, run GREEN against the present session, then keep guarding after the move:
- **Send→sent:** `sendDmText(key,text,id)` → assert a `CMD_SEND_TXT_MSG` (`0x02`) written; emit `RESP_SENT` (`[0x06][flood][ack u32 LE][est u32 LE]`) → assert `emit.messageState(id,'sent')` and an ack-hash entry retained.
- **Sent→ack:** emit `PUSH_SEND_CONFIRMED` (`[0x82][ackHex u32 LE][rtt u32 LE]`) matching the prior ack → `emit.messageState(id,'ack')`.
- **Recv DM:** emit `RESP_CONTACT_MSG_RECV_V3` from an unknown prefix → synth placeholder contact `c:<prefix>` + `emit.messages` + (since `isDraining()`) a follow-up `0x0a`.
- **FIFO:** two `sendDmText` then two `RESP_SENT` → ids flip to 'sent' in send order.
- **Bare RESP_ERR fails the oldest DM:** `sendDmText` then `RESP_ERR` (no pending ack awaiter) → `emit.messageState(id,'failed')`.
- **Admin-first ordering (seam):** register an `onSentTag` hook returning `true`; emit `RESP_SENT` → DM queue NOT advanced (hook consumed it). This guards the Phase 2f seam.

Run `pnpm test:integration -- dm-send-ack` → PASS on current code.

### - [ ] Step 2: Create `directMessages.ts`
- Move verbatim (renamed): `buildSendDmText`→`encodeSendDmText` (encode.ts); `parseContactMsgV3/V1`→`decodeContactMsgV3/V1` + `ContactMsgV3`, `parseSentAck`→`decodeSentAck` + `SentAck`, `parseSendConfirmed`→`decodeSendConfirmed` + `SendConfirmed` (decode.ts).
- Module state: `const dmSendQueue: string[] = []; const pendingDmAcks = new Map<...>();` + `const ACK_RETENTION_MS = 60_000;` + `const PER_ATTEMPT_TIMEOUT_MS = 30_000;`.
- **Admin-hook seam:**
  ```ts
  let adminHooks: {
    onSentTag?: (expectedAckHex: string) => boolean;   // true = admin consumed this RESP_SENT
    onCliReply?: (senderPrefixHex: string, body: string) => boolean; // true = consumed CLI reply
  } = {};
  export function setAdminHooks(hooks: typeof adminHooks): void { adminHooks = hooks; }
  export function enqueueDmSend(id: string): void { dmSendQueue.push(id); }
  export function dequeueDmSend(id: string): void { const i = dmSendQueue.indexOf(id); if (i !== -1) dmSendQueue.splice(i, 1); }
  ```
- `sendDmText(ctx,...)`, `sendDmTextWithRetry(ctx,...)`, `awaitDmOutcome(...)`, `failOldestDmSend(reason)`: verbatim bodies, `this.writeFrame`→`ctx.writeFrame`, `this.dmSendQueue`→`dmSendQueue`, `buildSendDmText`→`encodeSendDmText`, `encodeResetPath` import from `./contacts`, `stateHolder()`/`emit.*`/`bus.on('messageState'...)` unchanged. `sendDmTextWithRetry`'s `emit.pathLearned` block unchanged.
- `resetDmState(reason)`: the disconnect cleanup — `while (dmSendQueue.length) failOldestDmSend(reason); for (const e of pendingDmAcks.values()) clearTimeout(e.timer); pendingDmAcks.clear();`.
- **Handlers** — `directMessagesFeature` over `[RESP.CONTACT_MSG_RECV_V3, RESP.CONTACT_MSG_RECV, RESP.SENT, PUSH.SEND_CONFIRMED]`:
  - `RESP.CONTACT_MSG_RECV(_V3)` = verbatim `handleContactMsg`, except the CLI branch:
    ```ts
    if (parsed.txtType === TXT_TYPE.CLI_DATA) {
      if (adminHooks.onCliReply?.(parsed.senderPubKeyPrefixHex.toLowerCase(), parsed.body)) {
        if (isDraining()) pumpAfterRecv(ctx);
        return;
      }
    }
    ```
    rest unchanged (`parseContactMsgV3/V1`→`decode*`; `if (this.drainBusy) this.pumpNextDrain()`→`if (isDraining()) pumpAfterRecv(ctx)`).
  - `RESP.SENT` = verbatim `handleSent`, except the admin branch:
    ```ts
    const sent = decodeSentAck(frame);
    if (!sent) return;
    if (adminHooks.onSentTag?.(sent.expectedAckHex)) return;   // admin consumed the tag
    const messageId = dmSendQueue.shift();
    ...
    ```
  - `PUSH.SEND_CONFIRMED` = verbatim `handleSendConfirmed` (`parseSendConfirmed`→`decodeSendConfirmed`, `this.pendingDmAcks`→`pendingDmAcks`).
- Imports: `{ Buffer }`, `Message` type, `bus`/`emit`, `child`, `stateHolder`, `TXT_TYPE`/`RESP`/`PUSH`/`CMD`, `type Feature, FeatureContext`, `encodeResetPath` (contacts), `isDraining`/`pumpAfterRecv` (drain).

### - [ ] Step 3: Wire the admin seam + register + delete legacy in session
- Register `directMessagesFeature`.
- Delete legacy branches: `CONTACT_MSG_RECV(_V3)`, `SENT`, `SEND_CONFIRMED` (`failOldestDmSend` on bare RESP_ERR stays — see below), and the private methods `handleContactMsg`/`handleSent`/`handleSendConfirmed`/`failOldestDmSend`/`sendDmText`/`sendDmTextWithRetry`/`awaitDmOutcome`. Delete `dmSendQueue`/`pendingDmAcks` fields + `ACK_RETENTION_MS`/`PER_ATTEMPT_TIMEOUT_MS` consts.
- The RESP_ERR path in onPacket: `if (code === RESP.ERR) this.failOldestDmSend('radio rejected send')` → `if (code === RESP.ERR) failOldestDmSend('radio rejected send')` (module import). Keep the `resolveNextAck` precedence unchanged.
- Public delegators: `sendDmText(...)` → `return sendDmText(this.ctx, ...)`; `sendDmTextWithRetry(...)` → `return sendDmTextWithRetry(this.ctx, ...)`. (Alias module imports vs method names as in Task 2.)
- **Register admin hooks in `start()`** so the session's still-resident admin queues keep first crack:
  ```ts
  setAdminHooks({
    onSentTag: (tagHex) => {
      const a = this.adminSentQueue.shift();
      if (!a) return false;
      clearTimeout(a.timer); a.resolve(tagHex); return true;
    },
    onCliReply: (prefix, body) => {
      const p = this.pendingCli.get(prefix);
      if (!p) return false;
      clearTimeout(p.timer); this.pendingCli.delete(prefix); p.resolve(body); return true;
    },
  });
  ```
- `repeaterSendCli` (Phase 2f code, stays): `this.dmSendQueue.push(syntheticId)` → `enqueueDmSend(syntheticId)`; its write-fail `splice` → `dequeueDmSend(syntheticId)`.
- `onTransportState` disconnect: replace the DM cleanup (the `while (this.dmSendQueue...)` + `pendingDmAcks` clear) with `resetDmState('transport disconnected')`. The `adminSentQueue`/`pendingCli`/`pendingLocalStats`/`pendingTyped` cleanups STAY (Phase 2f).
- Remove now-unused session imports (`buildSendDmText`, `parseContactMsgV1/V3`, `parseSentAck`, `parseSendConfirmed`).

### - [ ] Step 4: Full suite + typecheck 0 + biome. The Step-1 DM tests + all existing messaging/contact/route tests green. Legacy branch count dropped by 3 (CONTACT_MSG, SENT, SEND_CONFIRMED). Commit: `refactor(protocol): migrate direct messages + ack state machine to a feature module`.

---

## Cross-phase note (record, don't fix here)
The `adminSentQueue` / `pendingCli` queues and the `onSentTag`/`onCliReply` hooks are the Phase 2f (repeater-admin) seam. When Phase 2f migrates repeater-admin, the admin module re-registers these hooks (owning the queues) and the session's `start()` registration + the residual queue fields are removed. Add a one-line note to the spec's Open Questions on completion (analogous to the Phase 2d RESP_CONTACT hazard note).

## Self-Review
- **Coverage:** drain (2 codes) + channels (CHANNEL_INFO + 3 encoders + decoder + map/presence/CRUD) + channelMessages (2 recv codes + send + 2 decoders) + directMessages (4 codes + send/retry/ack + 3 decoders) — every messaging inbound code and every messaging encode/decode fn is assigned. ✅
- **Dependency order:** drain → channels → channelMessages (needs channels lookup + drain pump) → directMessages (needs drain pump). Forward-only; suite green each step. ✅
- **Ack-FIFO fidelity:** `setChannel` re-expressed via `ctx.request` which wraps the identical `pendingAcks` FIFO + timeout; OK→true, ERR/timeout→false preserved. ✅
- **Drain fidelity:** module mirrors `scheduleDrain`/`pumpNextDrain`/`drainBusy`/`drainPending` exactly; connected guard via `transportManager.getState()` (the source `this.connected` mirrors). New characterization test pins the pump before the move. ✅
- **Admin coupling:** isolated behind `setAdminHooks` + `enqueue/dequeueDmSend`; `adminSentQueue`/`pendingCli` stay in session; admin-first ordering pinned by a seam test. Analog of the approved Phase 2d bridge. ✅
- **No new untested behavior:** DM send/ack + drain were integration-untested; this phase ADDS `drain.test.ts` + `dm-send-ack.test.ts` as guards before flipping dispatch. ✅
