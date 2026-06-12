# Protocol Completion — Phase 2c: Settings-Writes Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate the device-settings write cluster — the custom-var/GPS read-back handler (`RESP_CUSTOM_VARS`) and the outbound setting encoders (custom-var get/set, radio params + tx power, path-hash mode, advert name/lat-lon, other-params) — out of the shared `encode.ts`/`decode.ts` and the legacy `onPacket` chain into focused per-feature modules. No behavior change.

**Architecture:** Follow the Phase 2a/2b template. The substantial session **setter methods** (which orchestrate `awaitAck()` OK/ERR sequences and state updates) STAY in `session.ts`; only the **wire encoders** and the one **inbound handler** (`RESP_CUSTOM_VARS` → GPS sync) move into modules. The session methods repoint to the module `encode*` functions. Only `customVars.ts` registers a `Feature` (the others are outbound-only: encoders + helpers, no inbound code). `pathHashModeToSize`/`pathHashSizeToMode` move into `pathHash.ts`; `deviceInfo.ts`'s import of `pathHashModeToSize` repoints there.

**Tech Stack:** TypeScript, Vitest (`pnpm test:unit`, `pnpm test:integration`), `pnpm typecheck`, Biome (`pnpm exec biome check src tests`).

**Process constraints (carry forward):**
- Stay on branch `feat/protocol-completion`. Never `git checkout`/`switch`/`reset` — reviewers inspect via `git diff`/`git show` in place only.
- Never touch `src/renderer/shell/leftnav/OwnerCard.tsx`.
- Commit messages end with `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`. `git commit` needs the sandbox disabled.
- Biome scope is `src tests`.
- **Encoders move VERBATIM** (rename `build*` → `encode*`, keep the proven `Buffer`-based byte layout exactly — do NOT rewrite with `BufferWriter`). This preserves the wire format the byte-exact unit tests pin.

---

## Module decomposition (4 modules / 4 tasks)

| Module | Owns | Inbound Feature? | Session methods repointed |
|---|---|---|---|
| `customVars.ts` | `encodeGetCustomVar`, `encodeSetCustomVar`, `decodeCustomVars`, `customVarsFeature` (RESP_CUSTOM_VARS → GPS) | **Yes** (`RESP.CUSTOM_VARS`) | `setGpsConfig`, `requestCustomVars` |
| `pathHash.ts` | `encodeSetPathHashMode`, `pathHashSizeToMode`, `pathHashModeToSize` | No | `setPathHashMode`; also `deviceInfo.ts` import repoint |
| `radioParams.ts` | `encodeSetRadioParams`, `encodeSetRadioTxPower` | No | `setRadioParams` |
| `advert.ts` | `encodeSetAdvertName`, `encodeSetAdvertLatLon`, `encodeSetOtherParams`, `OtherParamsInput` | No | `setAdvertName`, `setAdvertLatLon`, `setOtherParams` |

**Test relocation:** each task moves the matching byte-exact cases out of `tests/unit/main/protocol/encode.test.ts` (and `decode.test.ts` for custom-vars) into a new `tests/unit/main/protocol/features/<module>.test.ts`, verbatim except the import path + `build*`→`encode*` rename. `customVars` also gets a new `tests/integration/inbound/custom-vars.test.ts`.

---

## Task 1: `customVars.ts` (GET/SET custom var + RESP_CUSTOM_VARS / GPS)

**Files:** Create `src/main/protocol/features/customVars.ts`, `tests/unit/main/protocol/features/customVars.test.ts`, `tests/integration/inbound/custom-vars.test.ts`. Modify `session.ts`, `encode.ts`, `decode.ts`, `encode.test.ts`, `decode.test.ts`.

### - [ ] Step 1: Create the module

```ts
import { Buffer } from 'node:buffer';
import { emit } from '../../events/bus';
import { stateHolder } from '../../state/holder';
import { CMD, RESP } from '../codes';
import type { Feature } from '../feature';

// CMD_GET_CUSTOM_VAR: variable-length key. Empty key returns the full set.
export function encodeGetCustomVar(key = ''): Buffer {
  const k = Buffer.from(key, 'utf8');
  const out = Buffer.alloc(1 + k.length);
  out[0] = CMD.GET_CUSTOM_VAR;
  k.copy(out, 1);
  return out;
}

// CMD_SET_CUSTOM_VAR: "key:value" UTF-8. Used for GPS enable / interval and
// other firmware tunables the user-facing UI may surface in the future.
export function encodeSetCustomVar(key: string, value: string | number | boolean): Buffer {
  const v = typeof value === 'boolean' ? (value ? '1' : '0') : String(value);
  const body = Buffer.from(`${key}:${v}`, 'utf8');
  const out = Buffer.alloc(1 + body.length);
  out[0] = CMD.SET_CUSTOM_VAR;
  body.copy(out, 1);
  return out;
}

// RESP_CUSTOM_VARS: newline-separated "key:value" pairs. The firmware may also
// use a NUL between entries on some older builds — we split on both to stay
// compatible.
export function decodeCustomVars(frame: Buffer): Record<string, string> {
  if (frame.length < 2) return {};
  const text = frame.subarray(1).toString('utf8');
  const out: Record<string, string> = {};
  for (const line of text.split(/[\n\0]/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const colon = trimmed.indexOf(':');
    if (colon === -1) continue;
    out[trimmed.slice(0, colon).trim()] = trimmed.slice(colon + 1).trim();
  }
  return out;
}

// RESP handler: fold the gps / gps_interval custom vars into GpsConfig + emit.
export const customVarsFeature: Feature = {
  handles: [RESP.CUSTOM_VARS],
  handle: (_code, frame) => {
    const kv = decodeCustomVars(frame);
    if (kv.gps === undefined && kv.gps_interval === undefined) return;
    const holder = stateHolder();
    const current = holder.getGpsConfig();
    const next = {
      enabled: kv.gps !== undefined ? kv.gps === '1' || kv.gps === 'true' : current.enabled,
      intervalSec:
        kv.gps_interval !== undefined
          ? Number.parseInt(kv.gps_interval, 10) || current.intervalSec
          : current.intervalSec,
    };
    holder.setGpsConfig(next);
    emit.gpsConfig(next);
  },
};
```
> Note: the handler inverts the legacy `if (gps || gps_interval) {...}` guard to an early-return `if (both undefined) return;` — behavior-identical, flatter.

### - [ ] Step 2: Unit test

Create `tests/unit/main/protocol/features/customVars.test.ts`. Move the `parseCustomVars` cases from `decode.test.ts` and the `encodeGetCustomVar`/`encodeSetCustomVar` cases from `encode.test.ts`, renamed:

```ts
import { Buffer } from 'node:buffer';
import { describe, expect, it } from 'vitest';
import {
  decodeCustomVars,
  encodeGetCustomVar,
  encodeSetCustomVar,
} from '../../../../../src/main/protocol/features/customVars';

const hex = (b: Buffer) => b.toString('hex');

describe('customVars encode/decode', () => {
  it('encodeGetCustomVar appends the key, or bare opcode for empty key', () => {
    expect(hex(encodeGetCustomVar())).toBe('28');
    expect(hex(encodeGetCustomVar('gps'))).toBe('28677073');
  });

  it('encodeSetCustomVar formats "key:value" with boolean → 1/0', () => {
    expect(hex(encodeSetCustomVar('gps', true))).toBe('296770733a31');
  });

  it('decodeCustomVars parses newline/NUL-separated key:value pairs', () => {
    const frame = Buffer.from([0x15, ...Buffer.from('gps:1\ngps_interval:30', 'utf8')]);
    expect(decodeCustomVars(frame)).toEqual({ gps: '1', gps_interval: '30' });
  });

  it('decodeCustomVars returns {} for a too-short frame', () => {
    expect(decodeCustomVars(Buffer.from([0x15]))).toEqual({});
  });
});
```
> Verify the moved assertions match what's currently in `encode.test.ts` (lines ~145-147, ~91-92) and `decode.test.ts` (the `parseCustomVars` describe, ~235-245). Use the existing fixture bytes verbatim.

### - [ ] Step 3: Run unit test — `pnpm test:unit -- customVars` → PASS.

### - [ ] Step 4: Wire session + repoint

In `src/main/protocol/session.ts`:
1. decode import block: remove `parseCustomVars,`.
2. encode import block: remove `buildGetCustomVar,` and `buildSetCustomVar,`.
3. Add `import { customVarsFeature, encodeGetCustomVar, encodeSetCustomVar } from './features/customVars';` (biome will sort it into place).
4. Add `customVarsFeature` to the `FeatureRegistry([...])`.
5. In `setGpsConfig`: `buildSetCustomVar('gps', cfg.enabled)` → `encodeSetCustomVar('gps', cfg.enabled)`, and `buildSetCustomVar('gps_interval', interval)` → `encodeSetCustomVar('gps_interval', interval)`.
6. In `requestCustomVars`: `buildGetCustomVar(key)` → `encodeGetCustomVar(key)`.
7. Delete the legacy `if (code === RESP.CUSTOM_VARS) {...}` branch.

### - [ ] Step 5: Remove moved defs

- `decode.ts`: remove `parseCustomVars` (+ its comment).
- `encode.ts`: remove `buildGetCustomVar` and `buildSetCustomVar` (+ comments).

### - [ ] Step 6: Relocate tests out of shared files

- `decode.test.ts`: remove `parseCustomVars` from imports + delete its `describe`. **Check if `Buffer` / other imports become unused** and drop if so.
- `encode.test.ts`: remove `buildGetCustomVar`, `buildSetCustomVar` from imports + delete their `it` cases.

### - [ ] Step 7: Integration test

Create `tests/integration/inbound/custom-vars.test.ts` (model on `batt-storage.test.ts`): inject a `RESP_CUSTOM_VARS` frame `[0x15]gps:1\ngps_interval:45` and assert `bus.emit('gpsConfig', ...)` fires with `{ enabled: true, intervalSec: 45 }` and `stateHolder().getGpsConfig()` matches.

```ts
import { Buffer } from 'node:buffer';
import { afterEach, describe, expect, it } from 'vitest';
import { bus, emit } from '../../../src/main/events/bus';
import { protocolSession } from '../../../src/main/protocol';
import { stateHolder } from '../../../src/main/state/holder';
import { companionPacket } from '../../support/fake-transport';

describe('RESP_CUSTOM_VARS handled via the feature registry', () => {
  afterEach(() => protocolSession().stop());

  it('folds gps + gps_interval into GpsConfig and emits gpsConfig', async () => {
    const session = protocolSession();
    session.start();
    const seen: { enabled?: boolean; intervalSec?: number }[] = [];
    const onGps = (c: { enabled?: boolean; intervalSec?: number }) => seen.push(c);
    bus.on('gpsConfig', onGps);

    emit.packet(
      companionPacket(Buffer.from([0x15, ...Buffer.from('gps:1\ngps_interval:45', 'utf8')])),
    );
    await Promise.resolve();
    bus.off('gpsConfig', onGps);

    expect(seen.at(-1)).toEqual({ enabled: true, intervalSec: 45 });
    expect(stateHolder().getGpsConfig().intervalSec).toBe(45);
  });
});
```
> Confirm `RESP.CUSTOM_VARS` is `0x15` in `codes.ts`; if not, use the correct opcode byte.

### - [ ] Step 8: Full suite — `pnpm test:unit && pnpm test:integration && pnpm typecheck && pnpm exec biome check src tests` (auto-fix format with `--write` if needed). All green / 0 errors.

### - [ ] Step 9: Commit (`refactor(protocol): migrate custom-vars/GPS to a feature module`).

---

## Task 2: `pathHash.ts` (SET_PATH_HASH_MODE + size/mode conversions)

**Files:** Create `src/main/protocol/features/pathHash.ts`, `tests/unit/main/protocol/features/pathHash.test.ts`. Modify `session.ts`, `encode.ts`, `encode.test.ts`, **and `src/main/protocol/features/deviceInfo.ts`** (import repoint).

### - [ ] Step 1: Create the module (move verbatim, rename)

```ts
import { Buffer } from 'node:buffer';
import { CMD } from '../codes';

// CMD_SET_PATH_HASH_MODE: [0x3d][0x00][mode u8]. The 0x00 is a required
// discriminator byte — firmware MyMesh.cpp:1431 gates the handler on
// `cmd_frame[1] == 0 && len >= 3`. mode is 0/1/2 (1/2/3 bytes per hop hash).
// Persists across reboots on the radio side. (Firmware sends
// `_prefs.path_hash_mode + 1` bytes per hop — see MyMesh.cpp:487.)
export function encodeSetPathHashMode(mode: number): Buffer {
  const m = mode & 0x03;
  return Buffer.from([CMD.SET_PATH_HASH_MODE, 0x00, m]);
}

/** Convert our per-hop byte size (1|2|3) to the firmware's mode byte (0|1|2). */
export function pathHashSizeToMode(size: 1 | 2 | 3): 0 | 1 | 2 {
  return (size - 1) as 0 | 1 | 2;
}
/** Inverse of pathHashSizeToMode. */
export function pathHashModeToSize(mode: number): 1 | 2 | 3 {
  const m = Math.max(0, Math.min(2, mode));
  return (m + 1) as 1 | 2 | 3;
}
```

### - [ ] Step 2: Unit test

Create `tests/unit/main/protocol/features/pathHash.test.ts` — move the `buildSetPathHashMode` + conversion cases from `encode.test.ts` (~98-106):

```ts
import { Buffer } from 'node:buffer';
import { describe, expect, it } from 'vitest';
import {
  encodeSetPathHashMode,
  pathHashModeToSize,
  pathHashSizeToMode,
} from '../../../../../src/main/protocol/features/pathHash';

const hex = (b: Buffer) => b.toString('hex');

describe('pathHash encode + conversions', () => {
  it('encodeSetPathHashMode wraps mode with the 0x00 discriminator', () => {
    expect(hex(encodeSetPathHashMode(1))).toBe('3d0001');
  });

  it('size↔mode conversions round-trip', () => {
    for (const size of [1, 2, 3] as const) {
      expect(pathHashModeToSize(pathHashSizeToMode(size))).toBe(size);
    }
    expect(pathHashSizeToMode(1)).toBe(0);
    expect(pathHashSizeToMode(3)).toBe(2);
  });
});
```

### - [ ] Step 3: Run — `pnpm test:unit -- pathHash` → PASS.

### - [ ] Step 4: Repoint imports & session
1. `deviceInfo.ts`: change `import { pathHashModeToSize } from '../encode';` → `from './pathHash';`.
2. `session.ts`: remove `buildSetPathHashMode,` and `pathHashSizeToMode,` from the encode import; add `import { encodeSetPathHashMode, pathHashSizeToMode } from './features/pathHash';`.
3. `session.ts` `setPathHashMode`: `buildSetPathHashMode(pathHashSizeToMode(size))` → `encodeSetPathHashMode(pathHashSizeToMode(size))`.

### - [ ] Step 5: Remove from `encode.ts`: `buildSetPathHashMode`, `pathHashSizeToMode`, `pathHashModeToSize` (+ comments).

### - [ ] Step 6: `encode.test.ts`: remove `buildSetPathHashMode`, `pathHashModeToSize`, `pathHashSizeToMode` from imports + delete the `SET_PATH_HASH_MODE + size/mode conversions` describe block.

### - [ ] Step 7: Full suite green (typecheck will confirm the `deviceInfo.ts` repoint). Auto-fix biome.

### - [ ] Step 8: Commit (`refactor(protocol): migrate path-hash-mode to a feature module`).

---

## Task 3: `radioParams.ts` (SET_RADIO_PARAMS + SET_RADIO_TX_POWER)

**Files:** Create `src/main/protocol/features/radioParams.ts`, `tests/unit/main/protocol/features/radioParams.test.ts`. Modify `session.ts`, `encode.ts`, `encode.test.ts`.

### - [ ] Step 1: Create the module (move verbatim, rename `build*`→`encode*`)

```ts
import { Buffer } from 'node:buffer';
import { CMD } from '../codes';

// CMD_SET_RADIO_PARAMS. firmware ver ≥ 9 accepts a trailing client_repeat byte;
// older firmware rejects the longer frame, so the caller must know the version.
export function encodeSetRadioParams(opts: {
  frequencyHz: number;
  bandwidthHz: number;
  spreadingFactor: number;
  codingRate: number;
  /** Repeat (firmware ver ≥ 9). When undefined, the byte is omitted. */
  clientRepeat?: boolean;
}): Buffer {
  const includeRepeat = opts.clientRepeat !== undefined;
  const out = Buffer.alloc(1 + 4 + 4 + 1 + 1 + (includeRepeat ? 1 : 0));
  out[0] = CMD.SET_RADIO_PARAMS;
  out.writeUInt32LE(opts.frequencyHz >>> 0, 1);
  out.writeUInt32LE(opts.bandwidthHz >>> 0, 5);
  out[9] = opts.spreadingFactor & 0xff;
  out[10] = opts.codingRate & 0xff;
  if (includeRepeat) out[11] = opts.clientRepeat ? 1 : 0;
  return out;
}

// CMD_SET_RADIO_TX_POWER: [0x0c][dBm u8]. Firmware clamps to the per-board max.
export function encodeSetRadioTxPower(dBm: number): Buffer {
  return Buffer.from([CMD.SET_RADIO_TX_POWER, dBm & 0xff]);
}
```

### - [ ] Step 2: Unit test — move `buildSetRadioTxPower` (~53-54) and `buildSetRadioParams` (~239-258) cases from `encode.test.ts` into `tests/unit/main/protocol/features/radioParams.test.ts`, renamed. Preserve the exact byte assertions (the freq/bw/sf/cr layout + the repeat-byte-only-when-set case).

### - [ ] Step 3: Run — `pnpm test:unit -- radioParams` → PASS.

### - [ ] Step 4: Session: remove `buildSetRadioParams,`/`buildSetRadioTxPower,` from encode import; add `import { encodeSetRadioParams, encodeSetRadioTxPower } from './features/radioParams';`. Repoint the two call sites in `setRadioParams`.

### - [ ] Step 5: Remove `buildSetRadioParams`, `buildSetRadioTxPower` from `encode.ts`.

### - [ ] Step 6: `encode.test.ts`: remove the two imports + their `it` cases (the `buildSetRadioTxPower appends dBm` case in the bare-opcode describe, and the `buildSetRadioParams` case).

### - [ ] Step 7: Full suite green. Auto-fix biome.

### - [ ] Step 8: Commit (`refactor(protocol): migrate radio params to a feature module`).

---

## Task 4: `advert.ts` (SET_ADVERT_NAME + SET_ADVERT_LATLON + SET_OTHER_PARAMS)

**Files:** Create `src/main/protocol/features/advert.ts`, `tests/unit/main/protocol/features/advert.test.ts`. Modify `session.ts`, `encode.ts`, `encode.test.ts`.

### - [ ] Step 1: Create the module (move verbatim, rename; carry `OtherParamsInput`)

```ts
import { Buffer } from 'node:buffer';
import { CMD } from '../codes';

// CMD_SET_ADVERT_NAME: [0x08][utf8 name]. Firmware truncates beyond 31B; we
// truncate client-side too so the wire format matches the official client.
export function encodeSetAdvertName(name: string): Buffer {
  const nameBuf = Buffer.from(name, 'utf8').subarray(0, 31);
  const out = Buffer.alloc(1 + nameBuf.length);
  out[0] = CMD.SET_ADVERT_NAME;
  nameBuf.copy(out, 1);
  return out;
}

// CMD_SET_ADVERT_LATLON: lat/lon as signed micro-degrees.
export function encodeSetAdvertLatLon(lat: number, lon: number): Buffer {
  const out = Buffer.alloc(1 + 4 + 4);
  out[0] = CMD.SET_ADVERT_LATLON;
  out.writeInt32LE(Math.round(lat * 1_000_000) | 0, 1);
  out.writeInt32LE(Math.round(lon * 1_000_000) | 0, 5);
  return out;
}

// CMD_SET_OTHER_PARAMS: telemetry policy + advert-location-policy + multi-acks.
// Layout: [0x26][reserved 0][telemetry_flags u8][advert_loc_policy u8][multi_acks u8].
export interface OtherParamsInput {
  telemetryBase: 0 | 1 | 2;
  telemetryLoc: 0 | 1 | 2;
  telemetryEnv: 0 | 1 | 2;
  /** 1 = share GPS in self-adverts, 0 = withhold. */
  advertLocationPolicy: 0 | 1;
  /** Number of duplicate ACKs to emit per inbound DM (0..2 typical). */
  multiAcks: number;
}
export function encodeSetOtherParams(input: OtherParamsInput): Buffer {
  const out = Buffer.alloc(5);
  out[0] = CMD.SET_OTHER_PARAMS;
  out[1] = 0; // reserved
  out[2] =
    ((input.telemetryEnv & 0x03) << 4) |
    ((input.telemetryLoc & 0x03) << 2) |
    (input.telemetryBase & 0x03);
  out[3] = input.advertLocationPolicy & 0x01;
  out[4] = input.multiAcks & 0xff;
  return out;
}
```

### - [ ] Step 2: Unit test — move `buildSetAdvertName` (~87-88), `buildSetAdvertLatLon` (~232-237), `buildSetOtherParams` (~73-78) cases from `encode.test.ts` into `tests/unit/main/protocol/features/advert.test.ts`, renamed, preserving exact byte assertions.

### - [ ] Step 3: Run — `pnpm test:unit -- advert` → PASS.

### - [ ] Step 4: Session: remove `buildSetAdvertLatLon,`/`buildSetAdvertName,`/`buildSetOtherParams,` from encode import; add `import { encodeSetAdvertLatLon, encodeSetAdvertName, encodeSetOtherParams } from './features/advert';`. Repoint the call sites in `setAdvertName`, `setAdvertLatLon`, `setOtherParams`.

### - [ ] Step 5: Remove `buildSetAdvertName`, `buildSetAdvertLatLon`, `buildSetOtherParams`, `OtherParamsInput` from `encode.ts`.

### - [ ] Step 6: `encode.test.ts`: remove the three imports + their `it`/describe cases.

### - [ ] Step 7: Full suite green. Auto-fix biome.

### - [ ] Step 8: Commit (`refactor(protocol): migrate advert/other-params writes to a feature module`).

---

## Final Phase 2c review
After all four commits, dispatch ONE read-only review subagent (strict no-`git checkout` guardrail) over the four commits to confirm behavior-preservation + clean removals, then verify the full suite green and the legacy `onPacket` branch count dropped by 1 (CUSTOM_VARS).

## Self-Review (writing-plans checklist)
- **Spec coverage:** All 8 settings encoders + the `RESP_CUSTOM_VARS` handler named in the roadmap are assigned to a task. ✅
- **Placeholders:** New-module sources are complete and verbatim from current `encode.ts`/`decode.ts`. Test relocations cite the exact source cases to move byte-for-byte. ✅
- **Type consistency:** `build*`→`encode*`, `parseCustomVars`→`decodeCustomVars`; helpers `pathHashSizeToMode`/`pathHashModeToSize` keep their names; `OtherParamsInput` carried intact. `customVarsFeature` is the only `Feature`. ✅
- **Dependency hazard:** `deviceInfo.ts` imports `pathHashModeToSize` — Task 2 Step 4.1 repoints it to `./pathHash`; typecheck (Step 7) catches a miss. No circular dep (`pathHash.ts` imports only `node:buffer` + `../codes`). ✅
- **Dead-import sweep:** Each task's "remove from shared file" step + the final `pnpm typecheck` (noUnusedLocals on) catches orphaned imports (e.g. `Buffer`/`frameBuf` in the shared test files). ✅
