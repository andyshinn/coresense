# Protocol Completion — Phase 2a: Device-Config Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate two existing device-config features (battery/storage read, auto-add config get/set) out of the legacy `onPacket` chain and the central `encode.ts`/`decode.ts` tables into self-contained feature modules — establishing the full migration template (encoder, decoder, handler, session method, tests all co-located; decoders rebuilt on the cursor primitive; `request()` replacing bespoke `awaitAck`).

**Architecture:** Each feature becomes `src/main/protocol/features/<name>.ts` owning its `encode*`/`decode*` (built on `BufferReader`/`BufferWriter`), a `Feature` (`handles` + `handle` that updates `stateHolder` + `emit`), and session-facing functions. The function moves out of `encode.ts`/`decode.ts`; its unit tests move into a co-located feature test; the legacy `onPacket` branch is deleted; the feature is registered. Full suite green at every step.

**Tech Stack:** TypeScript, Node `Buffer`, Vitest, Biome. Builds on the Phase 1 foundation (`feature.ts`, `registry.ts`, `buffer.ts`, `ctx.request`).

**Design source:** [docs/superpowers/specs/2026-06-11-meshcore-protocol-completion-design.md](../specs/2026-06-11-meshcore-protocol-completion-design.md) — "Migration strategy" + "New feature modules" sections. Reference template: the Phase 1 `features/contactsFull.ts` migration and `features/time.ts`.

**TYPECHECK BASELINE:** `pnpm typecheck` has 4 pre-existing unrelated errors in `src/renderer/shell/leftnav/OwnerCard.tsx` — never touch that file; "clean" = only those 4.

**Wire facts (from `codes.ts`, firmware-verified):** `CMD.GET_BATT_AND_STORAGE = 0x14`, `RESP.BATT_AND_STORAGE = 0x0c` (`[code][batt_mv u16 LE][used_kb u32 LE][total_kb u32 LE]`, min 11B); `CMD.GET_AUTO_ADD_CONFIG = 0x3b`, `CMD.SET_AUTO_ADD_CONFIG = 0x3a`, `RESP.AUTOADD_CONFIG = 0x19` (`[code][flags u8]`); flag bits `0x01 overwriteOldest | 0x02 chat | 0x04 repeater | 0x08 room | 0x10 sensor`.

---

### Task 1: Migrate the battery/storage feature

**Files:**
- Create: `src/main/protocol/features/battStorage.ts`
- Create: `tests/unit/main/protocol/features/battStorage.test.ts`
- Modify: `src/main/protocol/session.ts` (imports, registry, delegate method, remove legacy branch)
- Modify: `src/main/protocol/encode.ts` (remove `buildGetBattAndStorage`)
- Modify: `src/main/protocol/decode.ts` (remove `BattAndStorage` + `parseBattAndStorage`)
- Modify: `tests/unit/main/protocol/encode.test.ts` (remove the moved encoder test + import)
- Modify: `tests/unit/main/protocol/decode.test.ts` (remove the moved decoder test + import)
- Test: `tests/integration/inbound/batt-storage.test.ts`

- [ ] **Step 1: Create the feature module**

Create `src/main/protocol/features/battStorage.ts`:

```ts
import type { Buffer } from 'node:buffer';
import { emit } from '../../events/bus';
import { stateHolder } from '../../state/holder';
import { BufferReader, BufferWriter } from '../buffer';
import { CMD, RESP } from '../codes';
import type { Feature } from '../feature';

export interface BattAndStorage {
  batteryMv: number;
  storageUsedKb: number;
  storageTotalKb: number;
}

// CMD_GET_BATT_AND_STORAGE: [0x14]. Replies RESP_BATT_AND_STORAGE.
export function encodeGetBattAndStorage(): Buffer {
  return new BufferWriter().writeByte(CMD.GET_BATT_AND_STORAGE).toBuffer();
}

// RESP_BATT_AND_STORAGE: [0x0c][batt_mv u16 LE][used_kb u32 LE][total_kb u32 LE].
export function decodeBattAndStorage(frame: Buffer): BattAndStorage | null {
  const r = new BufferReader(frame);
  r.readByte(); // code
  if (r.remaining < 10) return null;
  return {
    batteryMv: r.readUInt16LE(),
    storageUsedKb: r.readUInt32LE(),
    storageTotalKb: r.readUInt32LE(),
  };
}

// PUSH/RESP handler: fold battery + storage into device info and emit.
export const battStorageFeature: Feature = {
  handles: [RESP.BATT_AND_STORAGE],
  handle: (_code, frame) => {
    const parsed = decodeBattAndStorage(frame);
    if (!parsed) return;
    const holder = stateHolder();
    const next = {
      ...holder.getDeviceInfo(),
      batteryMv: parsed.batteryMv,
      storageUsedKb: parsed.storageUsedKb,
      storageTotalKb: parsed.storageTotalKb,
    };
    holder.setDeviceInfo(next);
    emit.deviceInfo(next);
  },
};
```

- [ ] **Step 2: Create the feature unit test**

Create `tests/unit/main/protocol/features/battStorage.test.ts`:

```ts
import { Buffer } from 'node:buffer';
import { describe, expect, it } from 'vitest';
import {
  decodeBattAndStorage,
  encodeGetBattAndStorage,
} from '../../../../../src/main/protocol/features/battStorage';

describe('battStorage encode/decode', () => {
  it('encodeGetBattAndStorage is the bare opcode', () => {
    expect(encodeGetBattAndStorage().toString('hex')).toBe('14');
  });

  it('decodeBattAndStorage reads batt mv (u16) and storage kb (u32 ×2)', () => {
    // [0x0c][batt 0x0e10=3600][used 0x00000100=256][total 0x00001000=4096]
    const frame = Buffer.from([0x0c, 0x10, 0x0e, 0x00, 0x01, 0x00, 0x00, 0x00, 0x10, 0x00, 0x00]);
    const b = decodeBattAndStorage(frame);
    expect(b).toEqual({ batteryMv: 3600, storageUsedKb: 256, storageTotalKb: 4096 });
  });

  it('decodeBattAndStorage returns null for a short frame', () => {
    expect(decodeBattAndStorage(Buffer.from([0x0c, 0x10, 0x0e]))).toBeNull();
  });
});
```

- [ ] **Step 3: Run the feature unit test — expect PASS**

Run: `pnpm exec vitest run tests/unit/main/protocol/features/battStorage.test.ts`
Expected: PASS (3 tests). The module is self-contained, so it passes immediately.

- [ ] **Step 4: Wire into the session, remove the legacy branch**

In `src/main/protocol/session.ts`:

(a) Add the import (biome will order it):
```ts
import { battStorageFeature, encodeGetBattAndStorage } from './features/battStorage';
```

(b) Remove `buildGetBattAndStorage` from the `./encode` import list and `parseBattAndStorage` from the `./decode` import list (they're being deleted). Also remove the now-unused `BattAndStorage`/`ContactRecord`-style type import if `parseBattAndStorage` was the only consumer of `BattAndStorage` from `./decode` (check: only remove `BattAndStorage` from the decode import if it appears there; it may not be imported by name).

(c) Add `battStorageFeature` to the registry array:
```ts
private readonly registry = new FeatureRegistry([contactsFullFeature, battStorageFeature]);
```

(d) Replace the body of the existing `requestBattAndStorage()` method (which called `buildGetBattAndStorage()`) — change only the encoder call:
```ts
  async requestBattAndStorage(): Promise<void> {
    if (!this.connected) return;
    try {
      await this.writeFrame(encodeGetBattAndStorage());
    } catch (err) {
      log.warn(`requestBattAndStorage write failed: ${(err as Error).message}`);
    }
  }
```

(e) Delete the legacy `onPacket` branch:
```ts
    if (code === RESP.BATT_AND_STORAGE) {
      const parsed = parseBattAndStorage(frame);
      if (parsed) {
        const holder = stateHolder();
        const next = {
          ...holder.getDeviceInfo(),
          batteryMv: parsed.batteryMv,
          storageUsedKb: parsed.storageUsedKb,
          storageTotalKb: parsed.storageTotalKb,
        };
        holder.setDeviceInfo(next);
        emit.deviceInfo(next);
      }
      return;
    }
```

- [ ] **Step 5: Remove the moved functions from the central tables**

In `src/main/protocol/encode.ts`, delete:
```ts
export function buildGetBattAndStorage(): Buffer {
  return Buffer.from([CMD.GET_BATT_AND_STORAGE]);
}
```

In `src/main/protocol/decode.ts`, delete the `BattAndStorage` interface and `parseBattAndStorage` function:
```ts
export interface BattAndStorage {
  batteryMv: number;
  storageUsedKb: number;
  storageTotalKb: number;
}
export function parseBattAndStorage(frame: Buffer): BattAndStorage | null {
  if (frame.length < 11) return null;
  return {
    batteryMv: frame.readUInt16LE(1),
    storageUsedKb: frame.readUInt32LE(3),
    storageTotalKb: frame.readUInt32LE(7),
  };
}
```

- [ ] **Step 6: Relocate the old unit tests**

In `tests/unit/main/protocol/encode.test.ts`: remove `buildGetBattAndStorage` from the import list and delete its test assertion (search for `buildGetBattAndStorage` — it appears in a bare-opcode `describe`; remove just that `it(...)` and the import).

In `tests/unit/main/protocol/decode.test.ts`: remove `parseBattAndStorage` from the import list and delete the `parseBattAndStorage` assertions inside the `describe('parseBattAndStorage / parseAutoAddConfig', ...)` block (leave the `parseAutoAddConfig` assertions — those migrate in Task 2; for now rename the describe to `describe('parseAutoAddConfig', ...)` and keep only the autoadd `it(...)`).

- [ ] **Step 7: Add the inbound integration test**

Create `tests/integration/inbound/batt-storage.test.ts`:

```ts
import { Buffer } from 'node:buffer';
import { afterEach, describe, expect, it } from 'vitest';
import { bus, emit } from '../../../src/main/events/bus';
import { protocolSession } from '../../../src/main/protocol';
import { stateHolder } from '../../../src/main/state/holder';
import { companionPacket } from '../../support/fake-transport';

describe('RESP_BATT_AND_STORAGE handled via the feature registry', () => {
  afterEach(() => protocolSession().stop());

  it('folds battery + storage into device info and emits deviceInfo', async () => {
    const session = protocolSession();
    session.start();

    let emitted: { batteryMv?: number; storageUsedKb?: number } | null = null;
    const onInfo = (info: { batteryMv?: number; storageUsedKb?: number }) => {
      emitted = info;
    };
    bus.on('deviceInfo', onInfo);

    // [0x0c][batt 3600][used 256][total 4096]
    emit.packet(
      companionPacket(Buffer.from([0x0c, 0x10, 0x0e, 0x00, 0x01, 0x00, 0x00, 0x00, 0x10, 0x00, 0x00])),
    );
    await Promise.resolve();
    bus.off('deviceInfo', onInfo);

    expect(emitted?.batteryMv).toBe(3600);
    expect(emitted?.storageUsedKb).toBe(256);
    expect(stateHolder().getDeviceInfo().storageTotalKb).toBe(4096);
  });
});
```

- [ ] **Step 8: Verify — feature test + integration + full suite + typecheck + biome**

Run each, all must pass / be clean:
- `pnpm exec vitest run tests/unit/main/protocol/features/battStorage.test.ts tests/integration/inbound/batt-storage.test.ts` → PASS
- `pnpm test:unit` → PASS (the relocated tests still cover the same behavior)
- `pnpm test:integration` → PASS
- `pnpm typecheck` → only the 4 OwnerCard.tsx errors (in particular, no "buildGetBattAndStorage is not exported" / "parseBattAndStorage" dangling references)
- `pnpm exec biome check src/main/protocol tests/unit/main/protocol tests/integration/inbound/batt-storage.test.ts` → clean

If `pnpm test:unit`/`typecheck` reports a missing `buildGetBattAndStorage`/`parseBattAndStorage`/`BattAndStorage` reference, you missed a consumer — grep the repo (`grep -rn "buildGetBattAndStorage\|parseBattAndStorage\|BattAndStorage" src tests`) and update/remove each. The ONLY remaining references should be in the new feature module + its test.

- [ ] **Step 9: Commit**

```bash
git add src/main/protocol/features/battStorage.ts tests/unit/main/protocol/features/battStorage.test.ts tests/integration/inbound/batt-storage.test.ts src/main/protocol/session.ts src/main/protocol/encode.ts src/main/protocol/decode.ts tests/unit/main/protocol/encode.test.ts tests/unit/main/protocol/decode.test.ts
git commit -m "refactor(protocol): migrate battery/storage to a feature module"
```

---

### Task 2: Migrate the auto-add config feature

**Files:**
- Create: `src/main/protocol/features/autoAdd.ts`
- Create: `tests/unit/main/protocol/features/autoAdd.test.ts`
- Modify: `src/main/protocol/session.ts` (imports, registry, two delegate methods, remove legacy branch)
- Modify: `src/main/protocol/encode.ts` (remove `AutoAddFlagsInput`, `buildGetAutoAddConfig`, `buildSetAutoAddConfig`, `autoAddByteToFlags`, `autoAddFlagsToByte`)
- Modify: `src/main/protocol/decode.ts` (remove `parseAutoAddConfig`)
- Modify: `tests/unit/main/protocol/encode.test.ts` (remove the moved encoder/flag tests + imports)
- Modify: `tests/unit/main/protocol/decode.test.ts` (remove the moved decoder test + import)
- Test: `tests/integration/inbound/auto-add.test.ts`

- [ ] **Step 1: Create the feature module**

Create `src/main/protocol/features/autoAdd.ts`:

```ts
import type { Buffer } from 'node:buffer';
import { emit } from '../../events/bus';
import { stateHolder } from '../../state/holder';
import { BufferReader, BufferWriter } from '../buffer';
import { CMD, RESP } from '../codes';
import type { Feature, FeatureContext } from '../feature';

export interface AutoAddFlagsInput {
  chat: boolean;
  repeater: boolean;
  room: boolean;
  sensor: boolean;
  overwriteOldest: boolean;
}

// Auto-add flag bits (firmware companion_radio): overwriteOldest | chat | repeater | room | sensor.
export function autoAddFlagsToByte(flags: AutoAddFlagsInput): number {
  return (
    (flags.overwriteOldest ? 0x01 : 0) |
    (flags.chat ? 0x02 : 0) |
    (flags.repeater ? 0x04 : 0) |
    (flags.room ? 0x08 : 0) |
    (flags.sensor ? 0x10 : 0)
  );
}

export function autoAddByteToFlags(byte: number): AutoAddFlagsInput {
  return {
    overwriteOldest: (byte & 0x01) !== 0,
    chat: (byte & 0x02) !== 0,
    repeater: (byte & 0x04) !== 0,
    room: (byte & 0x08) !== 0,
    sensor: (byte & 0x10) !== 0,
  };
}

// CMD_GET_AUTO_ADD_CONFIG: [0x3b]. Replies RESP_AUTOADD_CONFIG.
export function encodeGetAutoAddConfig(): Buffer {
  return new BufferWriter().writeByte(CMD.GET_AUTO_ADD_CONFIG).toBuffer();
}

// CMD_SET_AUTO_ADD_CONFIG: [0x3a][flags u8]. Replies RESP_OK/ERR.
export function encodeSetAutoAddConfig(flags: AutoAddFlagsInput): Buffer {
  return new BufferWriter()
    .writeByte(CMD.SET_AUTO_ADD_CONFIG)
    .writeByte(autoAddFlagsToByte(flags))
    .toBuffer();
}

// RESP_AUTOADD_CONFIG: [0x19][flags u8].
export function decodeAutoAddConfig(frame: Buffer): number | null {
  const r = new BufferReader(frame);
  r.readByte(); // code
  if (r.remaining < 1) return null;
  return r.readByte();
}

// Handler: merge the radio's reported flags into the app's auto-add config.
export const autoAddFeature: Feature = {
  handles: [RESP.AUTOADD_CONFIG],
  handle: (_code, frame) => {
    const byte = decodeAutoAddConfig(frame);
    if (byte === null) return;
    const flags = autoAddByteToFlags(byte);
    const holder = stateHolder();
    const current = holder.getAutoAddConfig();
    const next = {
      ...current,
      chat: flags.chat,
      repeater: flags.repeater,
      room: flags.room,
      sensor: flags.sensor,
      overwriteOldest: flags.overwriteOldest,
    };
    holder.setAutoAddConfig(next);
    emit.autoAddConfig(next);
  },
};

/** Ask the radio for its current auto-add flags (RESP_AUTOADD_CONFIG lands via the handler). */
export async function requestAutoAddConfig(ctx: FeatureContext): Promise<void> {
  await ctx.writeFrame(encodeGetAutoAddConfig());
}

/** Push auto-add flags to the radio. Resolves true on RESP_OK, false on RESP_ERR/timeout. */
export async function setAutoAddConfig(ctx: FeatureContext, flags: AutoAddFlagsInput): Promise<boolean> {
  try {
    await ctx.request(encodeSetAutoAddConfig(flags));
    return true;
  } catch {
    return false;
  }
}
```

- [ ] **Step 2: Create the feature unit test**

Create `tests/unit/main/protocol/features/autoAdd.test.ts`:

```ts
import { Buffer } from 'node:buffer';
import { describe, expect, it } from 'vitest';
import {
  autoAddByteToFlags,
  autoAddFlagsToByte,
  decodeAutoAddConfig,
  encodeGetAutoAddConfig,
  encodeSetAutoAddConfig,
} from '../../../../../src/main/protocol/features/autoAdd';

describe('autoAdd encode/decode', () => {
  it('encodeGetAutoAddConfig is the bare opcode', () => {
    expect(encodeGetAutoAddConfig().toString('hex')).toBe('3b');
  });

  it('encodeSetAutoAddConfig appends the packed flags byte', () => {
    // chat(0x02) | repeater(0x04) | room(0x08) | sensor(0x10) | overwriteOldest(0x01) = 0x1f
    expect(
      encodeSetAutoAddConfig({
        chat: true,
        repeater: true,
        room: true,
        sensor: true,
        overwriteOldest: true,
      }).toString('hex'),
    ).toBe('3a1f');
  });

  it('flag byte ↔ struct round-trips', () => {
    for (const b of [0x00, 0x01, 0x12, 0x1f]) {
      expect(autoAddFlagsToByte(autoAddByteToFlags(b))).toBe(b);
    }
  });

  it('decodeAutoAddConfig returns the flags byte, null on short frame', () => {
    expect(decodeAutoAddConfig(Buffer.from([0x19, 0x1f]))).toBe(0x1f);
    expect(decodeAutoAddConfig(Buffer.from([0x19]))).toBeNull();
  });
});
```

- [ ] **Step 3: Run the feature unit test — expect PASS**

Run: `pnpm exec vitest run tests/unit/main/protocol/features/autoAdd.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 4: Wire into the session, remove the legacy branch**

In `src/main/protocol/session.ts`:

(a) Add the import:
```ts
import {
  type AutoAddFlagsInput,
  autoAddFeature,
  requestAutoAddConfig,
  setAutoAddConfig,
} from './features/autoAdd';
```

(b) Remove from the `./encode` import list: `type AutoAddFlagsInput`, `autoAddByteToFlags`, `buildGetAutoAddConfig`, `buildSetAutoAddConfig` (and `autoAddFlagsToByte` if imported). Remove `parseAutoAddConfig` from the `./decode` import list.

(c) Register the feature:
```ts
private readonly registry = new FeatureRegistry([contactsFullFeature, battStorageFeature, autoAddFeature]);
```

(d) Replace the two session methods with thin delegates (keeping their public signatures + the connected guard):
```ts
  async setAutoAddConfig(flags: AutoAddFlagsInput): Promise<boolean> {
    if (!this.connected) return false;
    return setAutoAddConfig(this.ctx, flags);
  }

  async requestAutoAddConfig(): Promise<void> {
    if (!this.connected) return;
    await requestAutoAddConfig(this.ctx);
  }
```

(e) Delete the legacy `onPacket` branch:
```ts
    if (code === RESP.AUTOADD_CONFIG) {
      const byte = parseAutoAddConfig(frame);
      if (byte !== null) {
        const flags = autoAddByteToFlags(byte);
        const holder = stateHolder();
        const current = holder.getAutoAddConfig();
        const next = {
          ...current,
          chat: flags.chat,
          repeater: flags.repeater,
          room: flags.room,
          sensor: flags.sensor,
          overwriteOldest: flags.overwriteOldest,
        };
        holder.setAutoAddConfig(next);
        emit.autoAddConfig(next);
      }
      return;
    }
```

- [ ] **Step 5: Remove the moved functions from the central tables**

In `src/main/protocol/encode.ts`, delete: the `AutoAddFlagsInput` interface, `autoAddFlagsToByte`, `autoAddByteToFlags`, `buildGetAutoAddConfig`, and `buildSetAutoAddConfig`.

In `src/main/protocol/decode.ts`, delete `parseAutoAddConfig`.

- [ ] **Step 6: Relocate the old unit tests**

In `tests/unit/main/protocol/encode.test.ts`: remove `autoAddByteToFlags`, `autoAddFlagsToByte`, `buildGetAutoAddConfig`, `buildSetAutoAddConfig` from the imports and delete their test assertions (the `buildGetAutoAddConfig` bare-opcode `it`, the `buildSetAutoAddConfig` `it`, and the flag round-trip `it`).

In `tests/unit/main/protocol/decode.test.ts`: remove `parseAutoAddConfig` from the imports and delete the remaining `parseAutoAddConfig` `describe`/`it` (the block that Task 1 reduced to autoadd-only).

- [ ] **Step 7: Add the inbound integration test**

Create `tests/integration/inbound/auto-add.test.ts`:

```ts
import { Buffer } from 'node:buffer';
import { afterEach, describe, expect, it } from 'vitest';
import { bus, emit } from '../../../src/main/events/bus';
import { protocolSession } from '../../../src/main/protocol';
import { companionPacket } from '../../support/fake-transport';

describe('RESP_AUTOADD_CONFIG handled via the feature registry', () => {
  afterEach(() => protocolSession().stop());

  it('maps the flags byte into auto-add config and emits autoAddConfig', async () => {
    const session = protocolSession();
    session.start();

    let cfg: { chat?: boolean; repeater?: boolean; overwriteOldest?: boolean } | null = null;
    const onCfg = (c: { chat?: boolean; repeater?: boolean; overwriteOldest?: boolean }) => {
      cfg = c;
    };
    bus.on('autoAddConfig', onCfg);

    emit.packet(companionPacket(Buffer.from([0x19, 0x06]))); // chat(0x02)|repeater(0x04)
    await Promise.resolve();
    bus.off('autoAddConfig', onCfg);

    expect(cfg?.chat).toBe(true);
    expect(cfg?.repeater).toBe(true);
    expect(cfg?.overwriteOldest).toBe(false);
  });
});
```

- [ ] **Step 8: Verify — feature test + integration + full suite + typecheck + biome**

- `pnpm exec vitest run tests/unit/main/protocol/features/autoAdd.test.ts tests/integration/inbound/auto-add.test.ts` → PASS
- `pnpm test:unit` → PASS
- `pnpm test:integration` → PASS
- `pnpm typecheck` → only the 4 OwnerCard.tsx errors
- `pnpm exec biome check src/main/protocol tests/unit/main/protocol tests/integration/inbound/auto-add.test.ts` → clean

If anything references the removed `AutoAddFlagsInput`/`autoAddByteToFlags`/`autoAddFlagsToByte`/`buildGetAutoAddConfig`/`buildSetAutoAddConfig`/`parseAutoAddConfig` from the old locations, grep (`grep -rn "autoAddByteToFlags\|autoAddFlagsToByte\|buildGetAutoAddConfig\|buildSetAutoAddConfig\|parseAutoAddConfig\|AutoAddFlagsInput" src tests`) and repoint each to `./features/autoAdd`. The only references should be the new feature module + its test + session's delegates.

- [ ] **Step 9: Commit**

```bash
git add src/main/protocol/features/autoAdd.ts tests/unit/main/protocol/features/autoAdd.test.ts tests/integration/inbound/auto-add.test.ts src/main/protocol/session.ts src/main/protocol/encode.ts src/main/protocol/decode.ts tests/unit/main/protocol/encode.test.ts tests/unit/main/protocol/decode.test.ts
git commit -m "refactor(protocol): migrate auto-add config to a feature module"
```

---

## Self-Review

**1. Spec coverage:** This plan covers the "Migrate existing features into modules" strategy for 2 of ~17 features (battery/storage, auto-add), establishing the decoder-co-location + `request()`-replaces-`awaitAck` template the rest will copy. Remaining clusters (device-info/self-info, contacts iterator, messaging, channels, repeater admin, drain) get their own Phase-2b…2f plans.

**2. Placeholder scan:** Every code step shows complete code. Test-relocation steps reference the exact functions/describe-blocks to remove and provide the full new test content. No "TBD"/"handle edge cases".

**3. Type consistency:** `BattAndStorage`/`AutoAddFlagsInput` shapes match their old definitions exactly (verified against `decode.ts`/`encode.ts`). `decodeBattAndStorage` uses `remaining < 10` after reading the code byte (equivalent to the old `frame.length < 11`). `setAutoAddConfig` preserves the `Promise<boolean>` contract (true on RESP_OK, false on RESP_ERR/timeout) via `ctx.request`'s throw-on-ERR. Registry array accumulates `[contactsFullFeature, battStorageFeature, autoAddFeature]` consistently across both tasks. Session delegates keep the original public signatures + `connected` guard.

**Migration invariant:** after each task, the moved function exists in exactly ONE place (the feature module); `grep` for the old name must show no references to the old `encode.ts`/`decode.ts` location. Full suite green proves behavior preserved.
