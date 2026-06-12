# Protocol Completion — Phase 2b: Device Identity Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate the device-identity cluster — `RESP_DEVICE_INFO` (0x0d) and `RESP_SELF_INFO` (0x05), plus their eliciting commands `DEVICE_QUERY` (0x16) and `APP_START` (0x01) — out of the legacy `onPacket` if/else chain and the shared `encode.ts`/`decode.ts` into two focused per-feature modules, with no behavior change.

**Architecture:** Follow the proven Phase 2a migration template (`battStorage.ts` / `autoAdd.ts`). Each feature module co-locates its encoder, decoder, decoded-payload interface, and a `Feature` object (inbound `handles` + `handle()`). Module singletons (`stateHolder`, `emit`, `child` logger) and the `pathHashModeToSize` helper are imported directly. The session registers the two new features in its `FeatureRegistry`, keeps a thin `connected`-guarded `requestDeviceInfo()` method that calls the module encoder, repoints the handshake/liveness call sites, and deletes the two legacy branches. Existing unit tests for the moved symbols relocate into per-feature test files; new integration tests drive the codes through the registry end-to-end.

**Tech Stack:** TypeScript, Vitest (`pnpm test:unit`, `pnpm test:integration`), `pnpm typecheck`, Biome (`pnpm exec biome check src tests`).

**Process constraints (carry forward from Phase 2a):**
- Stay on branch `feat/protocol-completion`. Never `git checkout` another branch/SHA — reviewers inspect via `git diff`/`git show` in place only.
- Never touch `src/renderer/shell/leftnav/OwnerCard.tsx`.
- Commit messages end with `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`. Commit only the files each task lists.
- Biome scope is `src tests` (repo-wide lint fails on pre-existing build artifacts).

---

## File Structure

**New files:**
- `src/main/protocol/features/deviceInfo.ts` — `DeviceInfo` interface, `encodeDeviceQuery`, `decodeDeviceInfo`, `deviceInfoFeature` (handles `RESP_DEVICE_INFO`).
- `src/main/protocol/features/selfInfo.ts` — `SelfInfo` interface, `encodeAppStart`, `decodeSelfInfo`, `selfInfoFeature` (handles `RESP_SELF_INFO`).
- `tests/unit/main/protocol/features/deviceInfo.test.ts` — encode/decode unit tests (relocated from `encode.test.ts` + `decode.test.ts`).
- `tests/unit/main/protocol/features/selfInfo.test.ts` — encode/decode unit tests (relocated).
- `tests/integration/inbound/device-info.test.ts` — RESP_DEVICE_INFO through the registry.
- `tests/integration/inbound/self-info.test.ts` — RESP_SELF_INFO through the registry.

**Modified files:**
- `src/main/protocol/session.ts` — imports, registry list, repointed call sites, deleted legacy branches, dead-import cleanup (`Owner`).
- `src/main/protocol/decode.ts` — remove `DeviceInfo`/`SelfInfo` interfaces + `parseDeviceInfo`/`parseSelfInfo`.
- `src/main/protocol/encode.ts` — remove `buildDeviceQuery`/`buildAppStart`, dead-import cleanup (`APP_PROTOCOL_VERSION`).
- `tests/unit/main/protocol/decode.test.ts` — remove relocated `parseDeviceInfo`/`parseSelfInfo` blocks + imports.
- `tests/unit/main/protocol/encode.test.ts` — remove relocated `buildDeviceQuery`/`buildAppStart` blocks + imports.

---

## Task 1: Migrate DEVICE_INFO → `deviceInfo.ts`

**Files:**
- Create: `src/main/protocol/features/deviceInfo.ts`
- Create: `tests/unit/main/protocol/features/deviceInfo.test.ts`
- Create: `tests/integration/inbound/device-info.test.ts`
- Modify: `src/main/protocol/session.ts`
- Modify: `src/main/protocol/decode.ts`
- Modify: `src/main/protocol/encode.ts`
- Modify: `tests/unit/main/protocol/decode.test.ts`
- Modify: `tests/unit/main/protocol/encode.test.ts`

### - [ ] Step 1: Create the feature module

Create `src/main/protocol/features/deviceInfo.ts`. The encoder uses `BufferWriter` (matching `battStorage.ts`); the decoder keeps the original random-access parse body verbatim (it reads fixed offsets `frame[80]`/`frame[81]` and scans trailing printable bytes — clearer with direct indexing than a cursor). The handler is the legacy `RESP_DEVICE_INFO` branch body, moved unchanged, with comments preserved.

```ts
import type { Buffer } from 'node:buffer';
import { emit } from '../../events/bus';
import { stateHolder } from '../../state/holder';
import { BufferWriter } from '../buffer';
import { APP_PROTOCOL_VERSION, CMD, RESP } from '../codes';
import { pathHashModeToSize } from '../encode';
import type { Feature } from '../feature';

// RESP_DEVICE_INFO. The official client treats most of the payload as
// firmware-version-specific metadata; we only need the few fields we surface
// in the UI. Bytes past `firmware_ver_code` evolve across firmware revisions,
// so optional readers fall back to undefined when the frame is too short.
export interface DeviceInfo {
  /** Firmware capability level: 1=v1.x, ..., 9 adds client_repeat,
   *  10 adds path_hash_mode in the device info reply. */
  firmwareVerCode: number;
  /** Firmware reports max_contacts as count/2 (legacy encoding). */
  maxContacts: number;
  maxChannels: number;
  /** Repeat mode echo when firmware >= 9; undefined otherwise. */
  clientRepeat?: boolean;
  /** Path hash mode echo (0|1|2 -> 1|2|3 bytes per hop) when firmware >= 10. */
  pathHashMode?: number;
  /** Best-effort device model string scanned from the trailing printable bytes.
   *  May be empty when the firmware doesn't emit one. */
  deviceModel: string;
}

// CMD_DEVICE_QUERY: [0x16][app_protocol_version u8]. Firmware reads byte [1]
// into app_target_ver, which gates V3-style response frames. Reply is
// RESP_DEVICE_INFO (0x0d) with firmware version + capacity counts.
export function encodeDeviceQuery(version = APP_PROTOCOL_VERSION): Buffer {
  return new BufferWriter().writeByte(CMD.DEVICE_QUERY).writeByte(version & 0xff).toBuffer();
}

export function decodeDeviceInfo(frame: Buffer): DeviceInfo | null {
  if (frame.length < 4) return null;
  const firmwareVerCode = frame[1];
  const maxContacts = frame[2] * 2;
  const maxChannels = frame[3];
  const clientRepeat = frame.length > 80 ? frame[80] !== 0 : undefined;
  const pathHashMode = frame.length > 81 ? frame[81] : undefined;
  let start = frame.length;
  while (start > 4) {
    const b = frame[start - 1];
    if (b >= 0x20 && b < 0x7f) start -= 1;
    else break;
  }
  const deviceModel = frame.subarray(start).toString('utf8').trim();
  return {
    firmwareVerCode,
    maxContacts,
    maxChannels,
    clientRepeat,
    pathHashMode,
    deviceModel,
  };
}

// RESP/PUSH handler: fold firmware version + capacity counts into device info,
// derive capability flags, and sync the radio's path-hash mode into RadioSettings.
export const deviceInfoFeature: Feature = {
  handles: [RESP.DEVICE_INFO],
  handle: (_code, frame) => {
    const parsed = decodeDeviceInfo(frame);
    if (!parsed) return;
    const holder = stateHolder();
    const next = {
      ...holder.getDeviceInfo(),
      firmwareVerCode: parsed.firmwareVerCode,
      maxContacts: parsed.maxContacts,
      maxChannels: parsed.maxChannels,
      deviceModel: parsed.deviceModel || holder.getDeviceInfo().deviceModel,
    };
    holder.setDeviceInfo(next);
    emit.deviceInfo(next);
    // Capabilities follow firmware version codes verbatim — see the
    // meshcore_protocol.dart firmware-version gates. We treat ver >= 9 as
    // unlocking the repeat-mode byte; >= 25 (anecdotal, fw 1.7.0) gates the
    // CLI export/import private-key flow. We pick the conservative cutoff
    // and refine when we learn the actual ver_code that fw 1.7.0 reports.
    const caps = {
      repeatMode: parsed.firmwareVerCode >= 9,
      identityKeyIO: parsed.firmwareVerCode >= 25,
    };
    holder.setDeviceCapabilities(caps);
    emit.deviceCapabilities(caps);
    // Sync the radio's actual path-hash mode into RadioSettings. Firmware
    // >= 10 echoes it in DEVICE_INFO; for older firmware leave whatever the
    // app has stored. The radio is the source of truth when it answers.
    if (parsed.pathHashMode !== undefined) {
      const radioSize = pathHashModeToSize(parsed.pathHashMode);
      const currentRadio = holder.getRadioSettings();
      if (currentRadio.pathHashMode !== radioSize) {
        const nextRadio = { ...currentRadio, pathHashMode: radioSize };
        holder.setRadioSettings(nextRadio);
        emit.radioSettings(nextRadio);
      }
    }
  },
};
```

### - [ ] Step 2: Write the unit test (relocated coverage)

Create `tests/unit/main/protocol/features/deviceInfo.test.ts`. Assertions are lifted from the existing `encode.test.ts` `buildDeviceQuery` cases and `decode.test.ts` `parseDeviceInfo` cases, repointed at the new symbols and the real `deviceInfo` fixture.

```ts
import { Buffer } from 'node:buffer';
import { describe, expect, it } from 'vitest';
import { decodeDeviceInfo, encodeDeviceQuery } from '../../../../../src/main/protocol/features/deviceInfo';
import { frameBuf } from '../../../../support/frames';

describe('deviceInfo encode/decode', () => {
  it('encodeDeviceQuery defaults to protocol version 4', () => {
    expect(encodeDeviceQuery().toString('hex')).toBe('1604');
  });

  it('encodeDeviceQuery(3) matches the byte sequence seen on the wire', () => {
    // Cross-checked against coresense.log: PROXY_RX cmd=0x16 hex=1603
    expect(encodeDeviceQuery(3).toString('hex')).toBe('1603');
  });

  it('decodeDeviceInfo reads firmware version, doubled max-contacts, and max-channels', () => {
    const info = decodeDeviceInfo(frameBuf('deviceInfo'));
    expect(info).not.toBeNull();
    expect(info?.firmwareVerCode).toBe(0x0b); // 11
    expect(info?.maxContacts).toBe(0xaf * 2); // firmware reports count/2 → 350
    expect(info?.maxChannels).toBe(0x28); // 40
    expect(info?.pathHashMode).toBe(1); // trailing byte
    expect(info?.clientRepeat).toBe(false);
  });

  it('decodeDeviceInfo returns null for a frame shorter than 4 bytes', () => {
    expect(decodeDeviceInfo(Buffer.from([0x0d, 0x0b]))).toBeNull();
  });
});
```

### - [ ] Step 3: Run the unit test — expect PASS

Run: `pnpm test:unit -- deviceInfo`
Expected: PASS (4 tests). The module compiles and the fixture decodes.

### - [ ] Step 4: Wire the feature into the session and repoint call sites

Modify `src/main/protocol/session.ts`:

1. In the `from './decode'` import block, **remove** the `parseDeviceInfo,` line.
2. In the `from './encode'` import block, **remove** the `buildDeviceQuery,` line.
3. Add a new import near the other feature imports:
   ```ts
   import { deviceInfoFeature, encodeDeviceQuery } from './features/deviceInfo';
   ```
4. Add `deviceInfoFeature` to the `FeatureRegistry([...])` constructor array.
5. Repoint all three `buildDeviceQuery()` call sites to `encodeDeviceQuery()`:
   - `requestDeviceInfo()` method (the `await this.writeFrame(buildDeviceQuery());`)
   - `startLivenessPoll()` (the `this.writeFrame(buildDeviceQuery()).catch(...)`)
   - `handshake()` (the `await this.writeFrame(buildDeviceQuery());`)
6. **Delete** the entire legacy branch:
   ```ts
   if (code === RESP.DEVICE_INFO) {
     const parsed = parseDeviceInfo(frame);
     // ...through...
     return;
   }
   ```

### - [ ] Step 5: Remove the moved definitions from the shared modules

Modify `src/main/protocol/decode.ts`: delete the `export interface DeviceInfo {...}` block and the `export function parseDeviceInfo(...) {...}` function (the RESP_DEVICE_INFO comment block + interface + function).

Modify `src/main/protocol/encode.ts`:
- Delete the `export function buildDeviceQuery(...)` function and its leading comment.
- In the top `import { APP_PROTOCOL_VERSION, CMD, type STATS_TYPE, TXT_TYPE } from './codes';` line, **remove `APP_PROTOCOL_VERSION,`** — it was only used by `buildDeviceQuery` and is now dead in this file. (Verify with a grep first; do not remove if another reference appears.)

### - [ ] Step 6: Relocate the unit-test blocks out of the shared test files

Modify `tests/unit/main/protocol/decode.test.ts`: remove `parseDeviceInfo,` from the import list and delete the `describe('parseDeviceInfo (real fixture)', ...)` block.

Modify `tests/unit/main/protocol/encode.test.ts`: remove `buildDeviceQuery,` from the import list and delete the two `it('buildDeviceQuery ...')` cases inside `describe('encode: bare-opcode commands', ...)` (leave the rest of that describe block intact).

### - [ ] Step 7: Write the integration test

Create `tests/integration/inbound/device-info.test.ts`, modeled on `tests/integration/inbound/batt-storage.test.ts`. It injects the real `deviceInfo` fixture frame and asserts the registry path emits `deviceInfo` + `deviceCapabilities` and updates state.

```ts
import { afterEach, describe, expect, it } from 'vitest';
import { bus, emit } from '../../../src/main/events/bus';
import { protocolSession } from '../../../src/main/protocol';
import { stateHolder } from '../../../src/main/state/holder';
import { companionPacket } from '../../support/fake-transport';
import { frameBuf } from '../../support/frames';

describe('RESP_DEVICE_INFO handled via the feature registry', () => {
  afterEach(() => protocolSession().stop());

  it('folds firmware info into device state and emits deviceInfo + deviceCapabilities', async () => {
    const session = protocolSession();
    session.start();

    const info: { firmwareVerCode?: number }[] = [];
    const caps: { repeatMode?: boolean; identityKeyIO?: boolean }[] = [];
    const onInfo = (d: { firmwareVerCode?: number }) => info.push(d);
    const onCaps = (c: { repeatMode?: boolean; identityKeyIO?: boolean }) => caps.push(c);
    bus.on('deviceInfo', onInfo);
    bus.on('deviceCapabilities', onCaps);

    emit.packet(companionPacket(frameBuf('deviceInfo')));
    await Promise.resolve();
    bus.off('deviceInfo', onInfo);
    bus.off('deviceCapabilities', onCaps);

    expect(info.at(-1)?.firmwareVerCode).toBe(0x0b);
    expect(caps.at(-1)?.repeatMode).toBe(true); // ver 11 >= 9
    expect(caps.at(-1)?.identityKeyIO).toBe(false); // ver 11 < 25
    expect(stateHolder().getDeviceInfo().maxContacts).toBe(0xaf * 2);
  });
});
```

> If the `deviceCapabilities` / `deviceInfo` event names differ from the bus's actual emitter keys, check `src/main/events/bus.ts` and match them exactly (the legacy branch used `emit.deviceInfo` / `emit.deviceCapabilities`, so these names are correct).

### - [ ] Step 8: Run the full suite — expect all PASS

Run, in order:
- `pnpm test:unit` — Expected: all pass (the relocated `deviceInfo` unit tests pass; the two shared test files no longer reference the moved symbols).
- `pnpm test:integration` — Expected: all pass including the new `device-info` test.
- `pnpm typecheck` — Expected: 0 errors. (Confirms no dead `parseDeviceInfo`/`buildDeviceQuery`/`APP_PROTOCOL_VERSION` references remain.)
- `pnpm exec biome check src tests` — Expected: clean.

If `typecheck` reports an unused import (e.g. `APP_PROTOCOL_VERSION` still imported, or a now-unused decode/encode symbol), remove it and re-run.

### - [ ] Step 9: Commit

```bash
git add src/main/protocol/features/deviceInfo.ts \
  tests/unit/main/protocol/features/deviceInfo.test.ts \
  tests/integration/inbound/device-info.test.ts \
  src/main/protocol/session.ts \
  src/main/protocol/decode.ts \
  src/main/protocol/encode.ts \
  tests/unit/main/protocol/decode.test.ts \
  tests/unit/main/protocol/encode.test.ts
git commit -m "$(cat <<'EOF'
refactor(protocol): migrate device-info to a feature module

Move RESP_DEVICE_INFO + CMD_DEVICE_QUERY out of the legacy onPacket
chain and shared encode/decode into src/main/protocol/features/deviceInfo.ts.
Register the feature, repoint the 3 DEVICE_QUERY call sites, and relocate
the unit coverage. No behavior change.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Migrate SELF_INFO → `selfInfo.ts`

**Files:**
- Create: `src/main/protocol/features/selfInfo.ts`
- Create: `tests/unit/main/protocol/features/selfInfo.test.ts`
- Create: `tests/integration/inbound/self-info.test.ts`
- Modify: `src/main/protocol/session.ts`
- Modify: `src/main/protocol/decode.ts`
- Modify: `src/main/protocol/encode.ts`
- Modify: `tests/unit/main/protocol/decode.test.ts`
- Modify: `tests/unit/main/protocol/encode.test.ts`

### - [ ] Step 1: Create the feature module

Create `src/main/protocol/features/selfInfo.ts`. `encodeAppStart` keeps the original `Buffer.alloc`/`copy` body verbatim (the 6 reserved zero bytes are awkward to express with `BufferWriter`; the proven byte layout is what the handshake test pins). `decodeSelfInfo` keeps the original trailing-printable scan. The handler is the legacy `RESP_SELF_INFO` branch body, moved unchanged.

```ts
import { Buffer } from 'node:buffer';
import type { Owner } from '../../../shared/types';
import { emit } from '../../events/bus';
import { child } from '../../log';
import { stateHolder } from '../../state/holder';
import { CMD, RESP } from '../codes';
import type { Feature } from '../feature';

const log = child('protocol');

// RESP_SELF_INFO [0x05][adv_type u8][tx_power u8][max_tx_power u8]
//   [public_key 32B][...adv lat/lon + radio params, firmware-version-specific...]
//   [name, trailing printable ASCII]. We only surface the two fields the
//   identity card needs — the 32B pubkey at a fixed offset and the name via the
//   same trailing-printable scan parseNodeNameFromSelfInfo / decodeDeviceInfo use,
//   which is firmware-version tolerant.
export interface SelfInfo {
  name: string;
  publicKeyHex: string;
}

// CMD_APP_START payload (per src/main/bridge/identity.ts):
//   [0x01][version u8][6 reserved bytes][app name UTF-8]. Reply is RESP_SELF_INFO.
export function encodeAppStart(appName: string, version = 1): Buffer {
  const name = Buffer.from(appName, 'utf8');
  const out = Buffer.alloc(8 + name.length);
  out[0] = CMD.APP_START;
  out[1] = version;
  // bytes 2..7 stay zero
  name.copy(out, 8);
  return out;
}

export function decodeSelfInfo(frame: Buffer): SelfInfo | null {
  if (frame.length < 36 || frame[0] !== 0x05) return null;
  const publicKeyHex = frame.subarray(4, 36).toString('hex');
  let start = frame.length;
  while (start > 36) {
    const b = frame[start - 1];
    if (b >= 0x20 && b < 0x7f) start -= 1;
    else break;
  }
  const name = frame.subarray(start).toString('utf8').trim();
  return { name, publicKeyHex };
}

// RESP handler: surface the radio's identity as the app Owner.
export const selfInfoFeature: Feature = {
  handles: [RESP.SELF_INFO],
  handle: (_code, frame) => {
    const parsed = decodeSelfInfo(frame);
    if (!parsed) return;
    const owner: Owner = {
      name: parsed.name,
      publicKeyHex: parsed.publicKeyHex,
      // Codebase convention for pubkey prefixes is the first 12 hex chars
      // (6 bytes); the identity card shows fewer but stores the full key.
      publicKeyShort: parsed.publicKeyHex.slice(0, 12),
    };
    stateHolder().setOwner(owner);
    emit.owner(owner);
    log.debug(`self-info: "${owner.name}" (${owner.publicKeyShort})`);
  },
};
```

### - [ ] Step 2: Write the unit test (relocated coverage)

Create `tests/unit/main/protocol/features/selfInfo.test.ts`. Assertions lifted from `encode.test.ts` `APP_START` cases and `decode.test.ts` `parseSelfInfo` cases.

```ts
import { Buffer } from 'node:buffer';
import { describe, expect, it } from 'vitest';
import { decodeSelfInfo, encodeAppStart } from '../../../../../src/main/protocol/features/selfInfo';
import { frameBuf } from '../../../../support/frames';

describe('selfInfo encode/decode', () => {
  it('encodeAppStart matches the logged handshake frame', () => {
    // coresense.log: BLE_TX 24B cmd=0x01 hex=01010000000000006d657368636f72652d666c7574746572
    expect(encodeAppStart('meshcore-flutter', 1).toString('hex')).toBe(
      '01010000000000006d657368636f72652d666c7574746572',
    );
  });

  it('encodeAppStart lays out [cmd][version][6 reserved zero bytes][name]', () => {
    const out = encodeAppStart('mc', 1);
    expect(out[0]).toBe(0x01);
    expect(out[1]).toBe(0x01);
    expect([...out.subarray(2, 8)]).toEqual([0, 0, 0, 0, 0, 0]);
    expect(out.subarray(8).toString('utf8')).toBe('mc');
  });

  it('decodeSelfInfo extracts the 32-byte public key at offset 4', () => {
    const self = decodeSelfInfo(frameBuf('selfInfo'));
    expect(self).not.toBeNull();
    expect(self?.publicKeyHex).toBe(
      '1a3d3c6a09f057457bcf0ae5403e5c60072919d193ed8caff58501b7590dd5d5',
    );
    expect(self?.name).toContain('Hand'); // trailing printable name region
  });

  it('decodeSelfInfo returns null when the code byte is not 0x05', () => {
    const bad = Buffer.alloc(40);
    bad[0] = 0x06;
    expect(decodeSelfInfo(bad)).toBeNull();
  });

  it('decodeSelfInfo returns null below 36 bytes', () => {
    expect(decodeSelfInfo(Buffer.alloc(35))).toBeNull();
  });
});
```

### - [ ] Step 3: Run the unit test — expect PASS

Run: `pnpm test:unit -- selfInfo`
Expected: PASS (5 tests).

### - [ ] Step 4: Wire the feature into the session and repoint the call site

Modify `src/main/protocol/session.ts`:

1. In the `from './decode'` import block, **remove** the `parseSelfInfo,` line.
2. In the `from './encode'` import block, **remove** the `buildAppStart,` line.
3. In the `import type { ... } from '../../shared/types'` block, **remove `Owner,`** — after the SELF_INFO branch is deleted, the only explicit `Owner` annotation in the file is gone. (Verify with a grep: the remaining `holder.getOwner()` usages do not annotate `Owner` explicitly. If any explicit `Owner` annotation remains, keep the import.)
4. Add a new import near the other feature imports:
   ```ts
   import { encodeAppStart, selfInfoFeature } from './features/selfInfo';
   ```
5. Add `selfInfoFeature` to the `FeatureRegistry([...])` constructor array.
6. Repoint the `handshake()` call site `buildAppStart(APP_NAME, APP_VERSION)` → `encodeAppStart(APP_NAME, APP_VERSION)`.
7. **Delete** the entire legacy branch:
   ```ts
   if (code === RESP.SELF_INFO) {
     const parsed = parseSelfInfo(frame);
     // ...through...
     return;
   }
   ```

### - [ ] Step 5: Remove the moved definitions from the shared modules

Modify `src/main/protocol/decode.ts`: delete the `export interface SelfInfo {...}` block and the `export function parseSelfInfo(...) {...}` function (the RESP_SELF_INFO comment block + interface + function).

Modify `src/main/protocol/encode.ts`: delete the `export function buildAppStart(...)` function and its leading comment.

### - [ ] Step 6: Relocate the unit-test blocks out of the shared test files

Modify `tests/unit/main/protocol/decode.test.ts`: remove `parseSelfInfo,` from the import list and delete the `describe('parseSelfInfo (real fixture)', ...)` block.

Modify `tests/unit/main/protocol/encode.test.ts`: remove `buildAppStart,` from the import list and delete the entire `describe('encode: APP_START', ...)` block.

### - [ ] Step 7: Write the integration test

Create `tests/integration/inbound/self-info.test.ts`, modeled on `batt-storage.test.ts`. Injects the real `selfInfo` fixture and asserts the registry path emits `owner` and sets owner state.

```ts
import { afterEach, describe, expect, it } from 'vitest';
import { bus, emit } from '../../../src/main/events/bus';
import { protocolSession } from '../../../src/main/protocol';
import { stateHolder } from '../../../src/main/state/holder';
import { companionPacket } from '../../support/fake-transport';
import { frameBuf } from '../../support/frames';

describe('RESP_SELF_INFO handled via the feature registry', () => {
  afterEach(() => protocolSession().stop());

  it('surfaces the radio identity as the app Owner and emits owner', async () => {
    const session = protocolSession();
    session.start();

    const owners: { name?: string; publicKeyHex?: string; publicKeyShort?: string }[] = [];
    const onOwner = (o: { name?: string; publicKeyHex?: string; publicKeyShort?: string }) =>
      owners.push(o);
    bus.on('owner', onOwner);

    emit.packet(companionPacket(frameBuf('selfInfo')));
    await Promise.resolve();
    bus.off('owner', onOwner);

    expect(owners.at(-1)?.publicKeyHex).toBe(
      '1a3d3c6a09f057457bcf0ae5403e5c60072919d193ed8caff58501b7590dd5d5',
    );
    expect(owners.at(-1)?.publicKeyShort).toBe('1a3d3c6a09f0');
    expect(stateHolder().getOwner()?.name).toContain('Hand');
  });
});
```

> Confirm the bus event key is `owner` (the legacy branch called `emit.owner(owner)`), and that `stateHolder().getOwner()` is the accessor. Match exactly to `src/main/events/bus.ts` / `src/main/state/holder.ts` if they differ.

### - [ ] Step 8: Run the full suite — expect all PASS

Run, in order:
- `pnpm test:unit` — Expected: all pass.
- `pnpm test:integration` — Expected: all pass including new `self-info` test.
- `pnpm typecheck` — Expected: 0 errors (confirms `Owner`, `parseSelfInfo`, `buildAppStart` are fully removed/repointed, no dead imports).
- `pnpm exec biome check src tests` — Expected: clean.

### - [ ] Step 9: Commit

```bash
git add src/main/protocol/features/selfInfo.ts \
  tests/unit/main/protocol/features/selfInfo.test.ts \
  tests/integration/inbound/self-info.test.ts \
  src/main/protocol/session.ts \
  src/main/protocol/decode.ts \
  src/main/protocol/encode.ts \
  tests/unit/main/protocol/decode.test.ts \
  tests/unit/main/protocol/encode.test.ts
git commit -m "$(cat <<'EOF'
refactor(protocol): migrate self-info to a feature module

Move RESP_SELF_INFO + CMD_APP_START out of the legacy onPacket chain
and shared encode/decode into src/main/protocol/features/selfInfo.ts.
Register the feature, repoint the APP_START handshake call site, relocate
the unit coverage, and drop the now-unused Owner import. No behavior change.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Self-Review (writing-plans checklist)

**Spec coverage:** Phase 2b covers the device-identity cluster named in the spec's migration roadmap — `RESP_DEVICE_INFO` (0x0d), `RESP_SELF_INFO` (0x05), and their eliciting commands `DEVICE_QUERY` (0x16), `APP_START` (0x01). Both inbound handlers move to the registry; both encoders + decoders move to feature modules; the session keeps its thin `requestDeviceInfo()` and handshake wiring. ✅

**Placeholder scan:** Every code step contains the full file/function body. No TBD/TODO. ✅

**Type consistency:** Interfaces keep their original names (`DeviceInfo`, `SelfInfo`) so no downstream type rename is needed. Functions renamed consistently per the `encode*`/`decode*` module convention: `buildDeviceQuery`→`encodeDeviceQuery`, `parseDeviceInfo`→`decodeDeviceInfo`, `buildAppStart`→`encodeAppStart`, `parseSelfInfo`→`decodeSelfInfo`. Feature objects: `deviceInfoFeature`, `selfInfoFeature`. All references in later steps match these. ✅

**Dead-import cleanups identified up front:** `Owner` (session.ts, after SELF_INFO branch removal) and `APP_PROTOCOL_VERSION` (encode.ts, after `buildDeviceQuery` removal). Each step instructs a grep-verify before removing. ✅

**Ordering hazard:** `deviceInfo.ts` imports `pathHashModeToSize` from `../encode`; `encode.ts` does not import from `features/` — no circular dependency. ✅
