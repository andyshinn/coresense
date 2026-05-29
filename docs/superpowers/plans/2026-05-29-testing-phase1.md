# Testing Phase 1 — Harness + Pure Unit Tests — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up Vitest with a `unit` project and lock down CoreSense's highest-risk pure logic — the MeshCore protocol encode/decode/framing/paths functions and the DOM-free renderer `lib/` utilities — against real captured frames.

**Architecture:** Tests live in a separate `tests/` tree mirroring `src/`. Vitest uses the `projects` (workspace) feature with one `unit` project (Node environment) now; the `integration` project is added in Phase 2. Protocol decode tests run against **real frames captured in `coresense.log`** (an initial device-connect session), committed as JSON fixtures with provenance. Encode/framing/paths tests assert against the documented wire-format spec (the byte layouts in the source comments + firmware). All targets are pure functions — zero Electron, zero hardware.

**Tech Stack:** Vitest 3.x, `@vitest/coverage-v8`, TypeScript, pnpm. Node 26 (`node:sqlite`, `crypto.getRandomValues`, `Intl.Segmenter` all available natively).

**Important conventions:**
- Use **pnpm only** (never npm/yarn).
- Test files import `{ describe, it, expect }` explicitly from `vitest` (no global types).
- After code changes run `pnpm typecheck` and `pnpm lint` — both must be clean.
- Commit after each task.
- These are **characterization / contract tests** of existing code: each test is written from the documented wire-format spec, not the implementation, so a passing test confirms the implementation conforms to the spec and guards against regressions. They are expected to pass on first run (the code already exists) — the value is the regression net, not a red→green cycle. The one genuine red→green cycle is the fixture loader in Task 2.

---

### Task 1: Install and configure Vitest

**Files:**
- Modify: `package.json` (devDependencies + scripts)
- Create: `vitest.config.ts`
- Modify: `tsconfig.json:23` (add `tests` to `include`)
- Create: `tests/unit/sanity.test.ts`

- [ ] **Step 1: Install dev dependencies**

Run:
```bash
pnpm add -D vitest @vitest/coverage-v8
```
Expected: `vitest` and `@vitest/coverage-v8` appear in `package.json` devDependencies, `pnpm-lock.yaml` updated.

- [ ] **Step 2: Create the Vitest config**

Create `vitest.config.ts`:
```ts
import path from 'node:path';
import { defineConfig } from 'vitest/config';

// Approach A from the testing design: one config, a `projects` array. Phase 1
// defines only the `unit` project (pure Node, no Electron). Phase 2 adds an
// `integration` project alongside it.
export default defineConfig({
  test: {
    projects: [
      {
        resolve: {
          alias: {
            '@': path.resolve(__dirname, 'src/renderer'),
          },
        },
        test: {
          name: 'unit',
          environment: 'node',
          include: ['tests/unit/**/*.test.ts'],
        },
      },
    ],
    coverage: {
      provider: 'v8',
      reportsDirectory: './coverage',
      include: ['src/**'],
    },
  },
});
```

- [ ] **Step 3: Add test scripts**

In `package.json`, add to the `scripts` block (after `"typecheck"`):
```json
    "test": "vitest run",
    "test:unit": "vitest run --project unit",
    "test:watch": "vitest",
    "test:coverage": "vitest run --coverage"
```

- [ ] **Step 4: Include tests in the typecheck**

In `tsconfig.json`, change the `include` line from:
```json
  "include": ["src", "forge.config.ts", "forge.env.d.ts", "vite.*.config.ts"]
```
to:
```json
  "include": ["src", "tests", "forge.config.ts", "forge.env.d.ts", "vite.*.config.ts", "vitest.config.ts"]
```

- [ ] **Step 5: Write a harness sanity test**

Create `tests/unit/sanity.test.ts`:
```ts
import { describe, expect, it } from 'vitest';

describe('vitest harness', () => {
  it('runs the unit project', () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 6: Run the unit project to verify the harness works**

Run: `pnpm test:unit`
Expected: PASS — 1 test file, 1 test passing, project name shown as `unit`.

- [ ] **Step 7: Verify typecheck and lint are clean**

Run: `pnpm typecheck && pnpm lint`
Expected: both exit 0 (no errors).

- [ ] **Step 8: Commit**

```bash
git add package.json pnpm-lock.yaml vitest.config.ts tsconfig.json tests/unit/sanity.test.ts
git commit -m "test: set up Vitest with unit project and harness sanity test"
```

---

### Task 2: Capture protocol fixtures and build the fixture loader

**Files:**
- Create: `tests/fixtures/frames/connect-session.json`
- Create: `tests/fixtures/frames/README.md`
- Create: `scripts/extract-fixtures.mjs`
- Create: `tests/support/frames.ts`
- Test: `tests/unit/support/frames.test.ts`

The frames below were captured from `coresense.log` (a real BLE device-connect session against a Heltec T114, firmware v1.15.0). The `hex=` value the logger records is the **full de-framed companion frame** (code byte + payload) — exactly what the `parseXxx` functions consume.

- [ ] **Step 1: Commit the captured fixtures**

Create `tests/fixtures/frames/connect-session.json`:
```json
{
  "deviceInfo": {
    "code": "0x0d",
    "name": "RESP_DEVICE_INFO",
    "hex": "0d0baf280000000031392041707220323032360048656c7465632054313134000000000000000000000000000000000000000000000000000000000076312e31352e30000000000000000000000000000001"
  },
  "selfInfo": {
    "code": "0x05",
    "name": "RESP_SELF_INFO",
    "hex": "050114161a3d3c6a09f057457bcf0ae5403e5c60072919d193ed8caff58501b7590dd5d508fdcc0109472cfa00012a00bde40d0024f4000007056567726d652e73682048616e64"
  },
  "meshPacketRaw": {
    "code": "0x88",
    "name": "BLE_RX raw mesh packet (PUSH_RAW_DATA region)",
    "hex": "88dd8f1545f12ef3035a9078cfa4bdcaeb35495532668cdcf0c23a0da1a1ac7343a714f66e55a7307aba0221fccecbfc2017"
  }
}
```

Create `tests/fixtures/frames/README.md`:
```markdown
# Protocol frame fixtures

Real MeshCore companion-protocol frames, used by the `protocol/decode` unit tests.

## Provenance

- **Source:** `coresense.log` in the repo root — a BLE device-connect session.
- **Device:** Heltec T114, firmware `v1.15.0`, app protocol version 4.
- **Frame form:** each `hex` is the full de-framed companion frame (leading
  code byte + payload), i.e. exactly what `src/main/protocol/decode.ts`
  `parseXxx(frame)` receives.

## Regenerating / extending

Run `node scripts/extract-fixtures.mjs <path-to-log>` to dump every `hex=...`
line from a log file (grouped by frame code) for inspection, then copy the
frames you want into `connect-session.json` (or a new fixture file) with a note
about what each one represents.
```

- [ ] **Step 2: Create the fixture-extraction helper script**

Create `scripts/extract-fixtures.mjs`:
```js
#!/usr/bin/env node
// Dump every companion-frame hex string from a CoreSense log file. The logger
// writes `hex=<hexstring>` (full de-framed frame) on BLE_RX / PROXY_TX lines,
// wrapped in ANSI color codes. We strip the ANSI, pull the hex, and print one
// per line prefixed with the leading code byte so you can pick fixtures.
import { readFileSync } from 'node:fs';

const path = process.argv[2];
if (!path) {
  console.error('usage: node scripts/extract-fixtures.mjs <logfile>');
  process.exit(1);
}

const ANSI = /\[[0-9;]*m/g;
const text = readFileSync(path, 'utf8').replace(ANSI, '');
const seen = new Set();
for (const line of text.split('\n')) {
  const m = line.match(/hex=([0-9a-fA-F]+)/);
  if (!m) continue;
  const hex = m[1].toLowerCase();
  if (hex.length < 2 || seen.has(hex)) continue;
  seen.add(hex);
  const code = hex.slice(0, 2);
  console.log(`0x${code}\t${hex.length / 2}B\t${hex}`);
}
console.log(`\n${seen.size} unique frames`);
```

- [ ] **Step 3: Write the failing test for the fixture loader**

Create `tests/unit/support/frames.test.ts`:
```ts
import { Buffer } from 'node:buffer';
import { describe, expect, it } from 'vitest';
import { frameBuf, frameHex } from '../../support/frames';

describe('fixture loader', () => {
  it('returns the hex string for a named frame', () => {
    expect(frameHex('deviceInfo')).toMatch(/^0d0baf28/);
  });

  it('returns a Buffer whose first byte is the frame code', () => {
    const buf = frameBuf('selfInfo');
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf[0]).toBe(0x05);
  });

  it('throws on an unknown fixture name', () => {
    expect(() => frameHex('nope')).toThrow(/unknown frame fixture/i);
  });
});
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `pnpm test:unit -- frames`
Expected: FAIL — cannot resolve `../../support/frames` (module does not exist yet).

- [ ] **Step 5: Implement the fixture loader**

Create `tests/support/frames.ts`:
```ts
import { Buffer } from 'node:buffer';
import connectSession from '../fixtures/frames/connect-session.json' with { type: 'json' };

const FRAMES: Record<string, { hex: string }> = connectSession;

/** The full de-framed companion-frame hex for a named fixture. */
export function frameHex(name: string): string {
  const entry = FRAMES[name];
  if (!entry) throw new Error(`unknown frame fixture: ${name}`);
  return entry.hex;
}

/** The named fixture as a Buffer (first byte = frame code). */
export function frameBuf(name: string): Buffer {
  return Buffer.from(frameHex(name), 'hex');
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `pnpm test:unit -- frames`
Expected: PASS — 3 tests passing.

- [ ] **Step 7: Verify typecheck and lint**

Run: `pnpm typecheck && pnpm lint`
Expected: both exit 0. (If `tsc` complains about the JSON import attribute, confirm `resolveJsonModule` is set — it is, in `tsconfig.json`.)

- [ ] **Step 8: Commit**

```bash
git add tests/fixtures/frames scripts/extract-fixtures.mjs tests/support/frames.ts tests/unit/support/frames.test.ts
git commit -m "test: add captured protocol frame fixtures and loader"
```

---

### Task 3: Unit tests for `protocol/encode`

**Files:**
- Test: `tests/unit/main/protocol/encode.test.ts`

These assert exact byte output against the documented command layouts in `src/main/protocol/encode.ts` and `src/main/protocol/codes.ts`. Two outputs are cross-checked against real bytes seen in `coresense.log` (`buildDeviceQuery(3)` → `1603`, `buildAppStart('meshcore-flutter', 1)` → the logged APP_START frame).

- [ ] **Step 1: Write the test file**

Create `tests/unit/main/protocol/encode.test.ts`:
```ts
import { Buffer } from 'node:buffer';
import { describe, expect, it } from 'vitest';
import {
  autoAddByteToFlags,
  autoAddFlagsToByte,
  buildAppStart,
  buildDeviceQuery,
  buildGetAutoAddConfig,
  buildGetBattAndStorage,
  buildGetChannel,
  buildGetContacts,
  buildGetNextMsg,
  buildReboot,
  buildSendDmText,
  buildSendSelfAdvert,
  buildSetAdvertName,
  buildSetCustomVar,
  buildSetOtherParams,
  buildSetPathHashMode,
  buildSetRadioTxPower,
  deriveChannelSecret,
  pathHashModeToSize,
  pathHashSizeToMode,
} from '../../../../src/main/protocol/encode';

const hex = (b: Buffer) => b.toString('hex');

describe('encode: bare-opcode commands', () => {
  it('buildDeviceQuery defaults to protocol version 4', () => {
    expect(hex(buildDeviceQuery())).toBe('1604');
  });

  it('buildDeviceQuery(3) matches the byte sequence seen on the wire', () => {
    // Cross-checked against coresense.log: PROXY_RX cmd=0x16 hex=1603
    expect(hex(buildDeviceQuery(3))).toBe('1603');
  });

  it('buildGetNextMsg is a single opcode', () => {
    expect(hex(buildGetNextMsg())).toBe('0a');
  });

  it('buildGetBattAndStorage is a single opcode', () => {
    expect(hex(buildGetBattAndStorage())).toBe('14');
  });

  it('buildGetAutoAddConfig is a single opcode', () => {
    expect(hex(buildGetAutoAddConfig())).toBe('3b');
  });

  it('buildGetChannel appends the slot index', () => {
    expect(hex(buildGetChannel(0))).toBe('1f00');
    expect(hex(buildGetChannel(3))).toBe('1f03');
  });

  it('buildSendSelfAdvert encodes the flood flag', () => {
    expect(hex(buildSendSelfAdvert())).toBe('0701');
    expect(hex(buildSendSelfAdvert(false))).toBe('0700');
  });

  it('buildSetRadioTxPower appends dBm', () => {
    expect(hex(buildSetRadioTxPower(20))).toBe('0c14');
  });

  it('buildReboot appends the literal "reboot"', () => {
    expect(hex(buildReboot())).toBe('137265626f6f74');
  });
});

describe('encode: APP_START', () => {
  it('matches the logged handshake frame', () => {
    // coresense.log: BLE_TX 24B cmd=0x01 hex=01010000000000006d657368636f72652d666c7574746572
    expect(hex(buildAppStart('meshcore-flutter', 1))).toBe(
      '01010000000000006d657368636f72652d666c7574746572',
    );
  });

  it('lays out [cmd][version][6 reserved zero bytes][name]', () => {
    const out = buildAppStart('mc', 1);
    expect(out[0]).toBe(0x01);
    expect(out[1]).toBe(0x01);
    expect([...out.subarray(2, 8)]).toEqual([0, 0, 0, 0, 0, 0]);
    expect(out.subarray(8).toString('utf8')).toBe('mc');
  });
});

describe('encode: GET_CONTACTS', () => {
  it('is a bare opcode with no `since`', () => {
    expect(hex(buildGetContacts())).toBe('04');
  });

  it('appends `since` as u32 LE', () => {
    expect(hex(buildGetContacts(0x100))).toBe('0400010000');
  });
});

describe('encode: SET_OTHER_PARAMS bit packing', () => {
  it('packs telemetry env<<4 | loc<<2 | base', () => {
    const out = buildSetOtherParams({
      telemetryBase: 1,
      telemetryLoc: 2,
      telemetryEnv: 0,
      advertLocationPolicy: 1,
      multiAcks: 2,
    });
    // [0x26][reserved 0][(0<<4)|(2<<2)|1 = 0x09][0x01][0x02]
    expect(hex(out)).toBe('2600090102');
  });
});

describe('encode: SET_ADVERT_NAME / SET_CUSTOM_VAR', () => {
  it('buildSetAdvertName appends the UTF-8 name', () => {
    expect(hex(buildSetAdvertName('Hand'))).toBe('0848616e64');
  });

  it('buildSetCustomVar formats "key:value" with boolean → 1/0', () => {
    expect(hex(buildSetCustomVar('gps', true))).toBe('296770733a31');
  });
});

describe('encode: SET_PATH_HASH_MODE + size/mode conversions', () => {
  it('emits [0x3d][0x00][mode]', () => {
    expect(hex(buildSetPathHashMode(1))).toBe('3d0001');
  });

  it('round-trips per-hop byte size ↔ mode', () => {
    for (const size of [1, 2, 3] as const) {
      expect(pathHashModeToSize(pathHashSizeToMode(size))).toBe(size);
    }
    expect(pathHashSizeToMode(1)).toBe(0);
    expect(pathHashSizeToMode(3)).toBe(2);
  });
});

describe('encode: auto-add flag bit field round-trip', () => {
  it('all flags set → 0x1f', () => {
    expect(
      autoAddFlagsToByte({
        chat: true,
        repeater: true,
        room: true,
        sensor: true,
        overwriteOldest: true,
      }),
    ).toBe(0x1f);
  });

  it('byte → flags → byte is stable across 0..0x1f', () => {
    for (let b = 0; b <= 0x1f; b++) {
      expect(autoAddFlagsToByte(autoAddByteToFlags(b))).toBe(b);
    }
  });
});

describe('encode: DM text framing + validation', () => {
  it('lays out [cmd][txt_type][attempt][ts u32 LE][6B pubkey prefix][text]', () => {
    const out = buildSendDmText({
      destPublicKeyHex: 'aabbccddeeff00112233445566778899',
      text: 'hi',
      timestampUnix: 1,
    });
    expect(out[0]).toBe(0x02); // SEND_TXT_MSG
    expect(out[1]).toBe(0); // PLAIN
    expect(out[2]).toBe(0); // attempt
    expect(out.readUInt32LE(3)).toBe(1); // timestamp
    expect(out.subarray(7, 13).toString('hex')).toBe('aabbccddeeff'); // first 6 bytes
    expect(out.subarray(13).toString('utf8')).toBe('hi');
  });

  it('rejects a public key shorter than 6 bytes', () => {
    expect(() => buildSendDmText({ destPublicKeyHex: 'aabb', text: 'x' })).toThrow(
      /≥6 bytes/,
    );
  });
});

describe('encode: deriveChannelSecret', () => {
  it('is 16 bytes (32 lowercase hex chars) and deterministic', () => {
    const a = deriveChannelSecret('public');
    const b = deriveChannelSecret('public');
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{32}$/);
  });

  it('differs for different channel names', () => {
    expect(deriveChannelSecret('public')).not.toBe(deriveChannelSecret('private'));
  });
});
```

- [ ] **Step 2: Run the tests**

Run: `pnpm test:unit -- encode`
Expected: PASS — all `encode` tests green.

- [ ] **Step 3: Verify typecheck and lint**

Run: `pnpm typecheck && pnpm lint`
Expected: both exit 0.

- [ ] **Step 4: Commit**

```bash
git add tests/unit/main/protocol/encode.test.ts
git commit -m "test: cover protocol encode command builders"
```

---

### Task 4: Unit tests for `bridge/framing`

**Files:**
- Test: `tests/unit/main/bridge/framing.test.ts`

`FrameDecoder` is a pure stateful reassembler — ideal for chunked/partial/multi-frame tests. Frame layout: `[direction 1][length 2 LE][payload]`.

- [ ] **Step 1: Write the test file**

Create `tests/unit/main/bridge/framing.test.ts`:
```ts
import { Buffer } from 'node:buffer';
import { describe, expect, it } from 'vitest';
import {
  DIR_CLIENT_TO_RADIO,
  FrameDecoder,
  MAX_FRAME_LEN,
  encodeFrame,
} from '../../../../src/main/bridge/framing';

function collect(decoder: FrameDecoder, chunks: Buffer[]): string[] {
  const out: string[] = [];
  for (const c of chunks) decoder.push(c, (p) => out.push(p.toString('hex')));
  return out;
}

describe('encodeFrame', () => {
  it('prepends [direction][len u16 LE] to the payload', () => {
    const out = encodeFrame(DIR_CLIENT_TO_RADIO, Buffer.from([0x16, 0x03]));
    expect(out.toString('hex')).toBe('3c020016 03'.replace(/\s/g, ''));
  });

  it('throws when the payload exceeds MAX_FRAME_LEN', () => {
    const tooBig = Buffer.alloc(MAX_FRAME_LEN + 1);
    expect(() => encodeFrame(DIR_CLIENT_TO_RADIO, tooBig)).toThrow(/exceeds MAX_FRAME_LEN/);
  });
});

describe('FrameDecoder', () => {
  it('decodes a single whole frame', () => {
    const d = new FrameDecoder();
    const frame = encodeFrame(DIR_CLIENT_TO_RADIO, Buffer.from([0xde, 0xad]));
    expect(collect(d, [frame])).toEqual(['dead']);
  });

  it('reassembles a frame split across chunk boundaries', () => {
    const d = new FrameDecoder();
    const frame = encodeFrame(DIR_CLIENT_TO_RADIO, Buffer.from([0x01, 0x02, 0x03, 0x04]));
    // Split mid-header and again mid-payload.
    const chunks = [frame.subarray(0, 1), frame.subarray(1, 4), frame.subarray(4)];
    expect(collect(d, chunks)).toEqual(['01020304']);
  });

  it('decodes two frames delivered in one chunk', () => {
    const d = new FrameDecoder();
    const a = encodeFrame(DIR_CLIENT_TO_RADIO, Buffer.from([0xaa]));
    const b = encodeFrame(DIR_CLIENT_TO_RADIO, Buffer.from([0xbb, 0xcc]));
    expect(collect(d, [Buffer.concat([a, b])])).toEqual(['aa', 'bbcc']);
  });

  it('resyncs past leading garbage before a valid direction byte', () => {
    const d = new FrameDecoder();
    const frame = encodeFrame(DIR_CLIENT_TO_RADIO, Buffer.from([0x42]));
    const noisy = Buffer.concat([Buffer.from([0x00, 0xff, 0x3e]), frame]);
    expect(collect(d, [noisy])).toEqual(['42']);
  });

  it('drops a zero-length frame and resyncs', () => {
    const d = new FrameDecoder();
    // [0x3c][00 00] is treated as garbage; a real frame after it still decodes.
    const zero = Buffer.from([DIR_CLIENT_TO_RADIO, 0x00, 0x00]);
    const real = encodeFrame(DIR_CLIENT_TO_RADIO, Buffer.from([0x99]));
    expect(collect(d, [Buffer.concat([zero, real])])).toEqual(['99']);
  });

  it('reset() clears partial state', () => {
    const d = new FrameDecoder();
    const frame = encodeFrame(DIR_CLIENT_TO_RADIO, Buffer.from([0x01, 0x02]));
    d.push(frame.subarray(0, 3), () => {}); // header only, payload pending
    d.reset();
    // After reset, a fresh whole frame decodes cleanly with no leftover bytes.
    expect(collect(d, [encodeFrame(DIR_CLIENT_TO_RADIO, Buffer.from([0x07]))])).toEqual(['07']);
  });
});
```

- [ ] **Step 2: Run the tests**

Run: `pnpm test:unit -- framing`
Expected: PASS — all `framing` tests green.

- [ ] **Step 3: Verify typecheck and lint**

Run: `pnpm typecheck && pnpm lint`
Expected: both exit 0.

- [ ] **Step 4: Commit**

```bash
git add tests/unit/main/bridge/framing.test.ts
git commit -m "test: cover TCP frame encoder and FrameDecoder reassembly"
```

---

### Task 5: Unit tests for `protocol/paths`

**Files:**
- Test: `tests/unit/main/protocol/paths.test.ts`

`channelHashOf` = `sha256(secretBytes)[0]`; `buildPath` builds an origin → hops → sink list. SHA outputs aren't hand-computable, so tests assert structure, determinism, ranges, and null cases.

- [ ] **Step 1: Write the test file**

Create `tests/unit/main/protocol/paths.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import type { Channel } from '../../../../src/shared/types';
import { buildPath, channelHashOf } from '../../../../src/main/protocol/paths';

function channel(secretHex?: string): Channel {
  return { key: 'ch:test', name: 'test', kind: 'public', secretHex };
}

describe('channelHashOf', () => {
  it('returns null when there is no secret', () => {
    expect(channelHashOf(channel(undefined))).toBeNull();
    expect(channelHashOf(channel(''))).toBeNull();
  });

  it('returns a single byte (0..255), deterministic for the same secret', () => {
    const h1 = channelHashOf(channel('00112233445566778899aabbccddeeff'));
    const h2 = channelHashOf(channel('00112233445566778899aabbccddeeff'));
    expect(h1).toBe(h2);
    expect(h1).toBeGreaterThanOrEqual(0);
    expect(h1).toBeLessThanOrEqual(255);
  });
});

describe('buildPath', () => {
  it('builds origin → one hop per (hashSize*2) hex chars → sink', () => {
    const path = buildPath('aabb', 1, -7.5, 'Alice', 'My Node');
    expect(path.hops.map((h) => h.kind)).toEqual(['origin', 'hop', 'hop', 'sink']);
    expect(path.hops[0].name).toBe('Alice');
    expect(path.hops[0].shortId).toBe('al'); // first 2 chars, lowercased
    expect(path.hops[1].shortId).toBe('aa');
    expect(path.hops[2].shortId).toBe('bb');
    expect(path.hops[3].kind).toBe('sink');
    expect(path.hops[3].name).toBe('My Node');
    expect(path.hashMode).toBe(1);
    expect(path.finalSnr).toBe(-7.5);
    expect(path.id).toMatch(/^[0-9a-f]{16}$/);
  });

  it('marks the origin unnamed when there is no sender name', () => {
    const path = buildPath('', 1, 0, null, undefined);
    expect(path.hops[0].unnamed).toBe(true);
    expect(path.hops[0].shortId).toBe('??');
    // No path bytes → just origin + sink.
    expect(path.hops.map((h) => h.kind)).toEqual(['origin', 'sink']);
    expect(path.hops[1].shortId).toBe('me');
  });

  it('groups hop hex by a 2-byte hash size', () => {
    const path = buildPath('aabbccdd', 2, 0, 'X', 'Y');
    const hops = path.hops.filter((h) => h.kind === 'hop');
    expect(hops.map((h) => h.shortId)).toEqual(['aabb', 'ccdd']);
  });
});
```

- [ ] **Step 2: Run the tests**

Run: `pnpm test:unit -- paths`
Expected: PASS — all `paths` tests green.

- [ ] **Step 3: Verify typecheck and lint**

Run: `pnpm typecheck && pnpm lint`
Expected: both exit 0.

- [ ] **Step 4: Commit**

```bash
git add tests/unit/main/protocol/paths.test.ts
git commit -m "test: cover channel hash and path builder"
```

---

### Task 6: Unit tests for `protocol/decode`

**Files:**
- Test: `tests/unit/main/protocol/decode.test.ts`

Two real frames (`deviceInfo`, `selfInfo`) come from the fixtures. The rest are constructed from the documented byte layouts in `src/main/protocol/decode.ts` so each test validates the parser against its spec, and every parser's truncation guard is exercised.

- [ ] **Step 1: Write the test file**

Create `tests/unit/main/protocol/decode.test.ts`:
```ts
import { Buffer } from 'node:buffer';
import { describe, expect, it } from 'vitest';
import {
  parseAutoAddConfig,
  parseBattAndStorage,
  parseChannelInfo,
  parseChannelMsgV1,
  parseChannelMsgV3,
  parseContact,
  parseContactMsgV3,
  parseContactsStart,
  parseDeviceInfo,
  parseEndOfContacts,
  parseSelfInfo,
  parseSendConfirmed,
  parseSentAck,
} from '../../../../src/main/protocol/decode';
import { frameBuf } from '../../support/frames';

describe('parseDeviceInfo (real fixture)', () => {
  it('reads firmware version, doubled max-contacts, and max-channels', () => {
    const info = parseDeviceInfo(frameBuf('deviceInfo'));
    expect(info).not.toBeNull();
    expect(info?.firmwareVerCode).toBe(0x0b); // 11
    expect(info?.maxContacts).toBe(0xaf * 2); // firmware reports count/2 → 350
    expect(info?.maxChannels).toBe(0x28); // 40
    expect(info?.pathHashMode).toBe(1); // trailing byte
    expect(info?.clientRepeat).toBe(false);
  });

  it('returns null for a frame shorter than 4 bytes', () => {
    expect(parseDeviceInfo(Buffer.from([0x0d, 0x0b]))).toBeNull();
  });
});

describe('parseSelfInfo (real fixture)', () => {
  it('extracts the 32-byte public key at offset 4', () => {
    const self = parseSelfInfo(frameBuf('selfInfo'));
    expect(self).not.toBeNull();
    expect(self?.publicKeyHex).toBe(
      '1a3d3c6a09f057457bcf0ae5403e5c60072919d193ed8caff58501b7590dd5d5',
    );
    expect(self?.name).toContain('Hand'); // trailing printable name region
  });

  it('returns null when the code byte is not 0x05', () => {
    const bad = Buffer.alloc(40);
    bad[0] = 0x06;
    expect(parseSelfInfo(bad)).toBeNull();
  });
});

describe('parseChannelInfo', () => {
  it('reads idx, null-terminated name, and 16-byte key', () => {
    const frame = Buffer.alloc(50);
    frame[0] = 0x12;
    frame[1] = 2; // idx
    Buffer.from('General', 'utf8').copy(frame, 2); // name region (null-padded)
    Buffer.alloc(16, 0xab).copy(frame, 34); // 16-byte key, all 0xab
    const info = parseChannelInfo(frame);
    expect(info?.idx).toBe(2);
    expect(info?.name).toBe('General');
    expect(info?.secretHex).toBe('ab'.repeat(16));
    expect(info?.empty).toBe(false);
  });

  it('flags an all-zero key as empty', () => {
    const frame = Buffer.alloc(50);
    frame[0] = 0x12;
    expect(parseChannelInfo(frame)?.empty).toBe(true);
  });

  it('returns null below the 50-byte frame length', () => {
    expect(parseChannelInfo(Buffer.alloc(49))).toBeNull();
  });
});

describe('parseChannelMsgV3', () => {
  it('decodes snr/4, channel idx, timestamp, and splits the "name: " prefix', () => {
    const body = Buffer.from('Alice: hello', 'utf8');
    const frame = Buffer.alloc(11 + body.length);
    frame[0] = 0x11;
    frame.writeInt8(50, 1); // snr*4 = 50 → 12.5 dB
    frame[4] = 3; // channel idx
    frame[5] = 0xff; // path_len (direct)
    frame[6] = 0; // txt_type
    frame.writeUInt32LE(1_700_000_000, 7);
    body.copy(frame, 11);
    const msg = parseChannelMsgV3(frame);
    expect(msg?.snrDb).toBe(12.5);
    expect(msg?.channelIdx).toBe(3);
    expect(msg?.pathLen).toBe(0xff);
    expect(msg?.timestampUnix).toBe(1_700_000_000);
    expect(msg?.body).toBe('Alice: hello');
    expect(msg?.senderName).toBe('Alice');
    expect(msg?.cleanBody).toBe('hello');
  });

  it('returns null below 12 bytes', () => {
    expect(parseChannelMsgV3(Buffer.alloc(11))).toBeNull();
  });
});

describe('parseChannelMsgV1 (legacy, no snr prefix)', () => {
  it('reports snrDb 0 and reads the older layout', () => {
    const body = Buffer.from('hi', 'utf8');
    const frame = Buffer.alloc(8 + body.length);
    frame[0] = 0x08;
    frame[1] = 1; // channel idx
    frame[2] = 2; // path_len
    frame[3] = 0; // txt_type
    frame.writeUInt32LE(42, 4);
    body.copy(frame, 8);
    const msg = parseChannelMsgV1(frame);
    expect(msg?.snrDb).toBe(0);
    expect(msg?.channelIdx).toBe(1);
    expect(msg?.timestampUnix).toBe(42);
    expect(msg?.body).toBe('hi');
  });
});

describe('parseContactMsgV3', () => {
  it('reads the 6-byte sender prefix and body (no name prefix)', () => {
    const body = Buffer.from('ping', 'utf8');
    const frame = Buffer.alloc(16 + body.length);
    frame[0] = 0x10;
    frame.writeInt8(-4, 1); // snr*4 = -4 → -1 dB
    Buffer.from('aabbccddeeff', 'hex').copy(frame, 4); // sender prefix
    frame[10] = 0xff; // path_len
    frame[11] = 0; // txt_type
    frame.writeUInt32LE(99, 12);
    body.copy(frame, 16);
    const msg = parseContactMsgV3(frame);
    expect(msg?.snrDb).toBe(-1);
    expect(msg?.senderPubKeyPrefixHex).toBe('aabbccddeeff');
    expect(msg?.timestampUnix).toBe(99);
    expect(msg?.body).toBe('ping');
  });
});

describe('parseContact', () => {
  it('reads pubkey, type/flags, out_path, name, gps, timestamps', () => {
    const frame = Buffer.alloc(148);
    frame[0] = 0x03;
    Buffer.alloc(32, 0x11).copy(frame, 1); // pubkey
    frame[33] = 2; // type (repeater)
    frame[34] = 0x05; // flags
    frame[35] = 2; // out_path_len
    Buffer.from([0xa1, 0xb2]).copy(frame, 36); // out_path
    Buffer.from('Repeater-1', 'utf8').copy(frame, 100); // name
    frame.writeUInt32LE(1000, 132); // last_advert
    frame.writeInt32LE(37_123456, 136); // gps_lat → 37.123456
    frame.writeInt32LE(-122_654321, 140); // gps_lon → -122.654321
    frame.writeUInt32LE(2000, 144); // lastmod
    const c = parseContact(frame);
    expect(c?.publicKeyHex).toBe('11'.repeat(32));
    expect(c?.type).toBe(2);
    expect(c?.flags).toBe(0x05);
    expect(c?.outPathLen).toBe(2);
    expect(c?.outPathHex).toBe('a1b2');
    expect(c?.name).toBe('Repeater-1');
    expect(c?.lastAdvertUnix).toBe(1000);
    expect(c?.gpsLat).toBeCloseTo(37.123456, 5);
    expect(c?.gpsLon).toBeCloseTo(-122.654321, 5);
    expect(c?.lastmod).toBe(2000);
  });

  it('returns null below 148 bytes', () => {
    expect(parseContact(Buffer.alloc(147))).toBeNull();
  });
});

describe('parseContactsStart / parseEndOfContacts', () => {
  it('read a u32 LE count / lastmod at offset 1', () => {
    const start = Buffer.from([0x02, 0x05, 0x00, 0x00, 0x00]);
    const end = Buffer.from([0x04, 0x10, 0x00, 0x00, 0x00]);
    expect(parseContactsStart(start)).toBe(5);
    expect(parseEndOfContacts(end)).toBe(16);
    expect(parseContactsStart(Buffer.alloc(4))).toBeNull();
  });
});

describe('parseSentAck / parseSendConfirmed', () => {
  it('parseSentAck reads flood flag, expected ack, and est timeout', () => {
    const frame = Buffer.alloc(10);
    frame[0] = 0x06;
    frame[1] = 1; // flood
    Buffer.from('deadbeef', 'hex').copy(frame, 2); // expected ack
    frame.writeUInt32LE(1500, 6); // est timeout ms
    const ack = parseSentAck(frame);
    expect(ack?.flood).toBe(true);
    expect(ack?.expectedAckHex).toBe('deadbeef');
    expect(ack?.estTimeoutMs).toBe(1500);
  });

  it('parseSendConfirmed reads ack hash and trip time', () => {
    const frame = Buffer.alloc(9);
    frame[0] = 0x82;
    Buffer.from('cafebabe', 'hex').copy(frame, 1);
    frame.writeUInt32LE(321, 5);
    const c = parseSendConfirmed(frame);
    expect(c?.ackHex).toBe('cafebabe');
    expect(c?.tripTimeMs).toBe(321);
  });
});

describe('parseBattAndStorage / parseAutoAddConfig', () => {
  it('parseBattAndStorage reads batt mv (u16) and storage kb (u32 ×2)', () => {
    const frame = Buffer.alloc(11);
    frame[0] = 0x0c;
    frame.writeUInt16LE(4020, 1);
    frame.writeUInt32LE(128, 3);
    frame.writeUInt32LE(4096, 7);
    const b = parseBattAndStorage(frame);
    expect(b?.batteryMv).toBe(4020);
    expect(b?.storageUsedKb).toBe(128);
    expect(b?.storageTotalKb).toBe(4096);
  });

  it('parseAutoAddConfig returns the flags byte', () => {
    expect(parseAutoAddConfig(Buffer.from([0x19, 0x1f]))).toBe(0x1f);
    expect(parseAutoAddConfig(Buffer.from([0x19]))).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests**

Run: `pnpm test:unit -- decode`
Expected: PASS — all `decode` tests green. If the two real-fixture assertions on `pathHashMode`/`clientRepeat` fail, the fixture frame length differs from the assumed 82 bytes; re-derive those two values by logging `parseDeviceInfo(frameBuf('deviceInfo'))` once and updating the expectation (the byte-layout asserts on the other parsers are independent and authoritative).

- [ ] **Step 3: Verify typecheck and lint**

Run: `pnpm typecheck && pnpm lint`
Expected: both exit 0.

- [ ] **Step 4: Commit**

```bash
git add tests/unit/main/protocol/decode.test.ts
git commit -m "test: cover protocol decode parsers against fixtures and spec"
```

---

### Task 7: Unit tests for renderer `lib/` pure utilities

**Files:**
- Test: `tests/unit/renderer/lib/airtime.test.ts`
- Test: `tests/unit/renderer/lib/battery.test.ts`
- Test: `tests/unit/renderer/lib/sortByPinned.test.ts`
- Test: `tests/unit/renderer/lib/contactColor.test.ts`
- Test: `tests/unit/renderer/lib/time.test.ts`
- Test: `tests/unit/renderer/lib/randomSecret.test.ts`
- Test: `tests/unit/renderer/lib/messageContent.test.ts`
- Test: `tests/unit/renderer/lib/meshcoreUri.test.ts`
- Test: `tests/unit/renderer/lib/decodePacket.test.ts`

All run in the Node env. `randomSecret` uses global `crypto.getRandomValues` (present in Node 26); `contactColor` uses `Intl.Segmenter` (present). `meshcoreUri`/`decodePacket` wrap `@michaelhart/meshcore-decoder` — tests assert the robust contract (negative cases + no-throw on a real frame) rather than decoder internals.

- [ ] **Step 1: Write `airtime.test.ts`**

Create `tests/unit/renderer/lib/airtime.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import type { RadioSettings } from '../../../../src/shared/types';
import { loraAirtimeMs } from '../../../../src/renderer/lib/airtime';

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

describe('loraAirtimeMs', () => {
  it('matches the AN1200.13 formula for a known config', () => {
    // SF11, BW250k, CR4/5, 16B payload → ~288.77 ms (hand-derived from the formula).
    expect(loraAirtimeMs(16, settings())).toBeCloseTo(288.77, 1);
  });

  it('increases monotonically with payload size', () => {
    const s = settings();
    expect(loraAirtimeMs(32, s)).toBeGreaterThan(loraAirtimeMs(16, s));
  });

  it('returns 0 for out-of-range spreading factors', () => {
    expect(loraAirtimeMs(16, settings({ spreadingFactor: 5 }))).toBe(0);
    expect(loraAirtimeMs(16, settings({ spreadingFactor: 13 }))).toBe(0);
  });

  it('returns 0 for a negative payload', () => {
    expect(loraAirtimeMs(-1, settings())).toBe(0);
  });
});
```

- [ ] **Step 2: Write `battery.test.ts`**

Create `tests/unit/renderer/lib/battery.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { formatVoltage, lipoPercent } from '../../../../src/renderer/lib/battery';

describe('lipoPercent', () => {
  it('returns null for a missing/zero reading', () => {
    expect(lipoPercent(0)).toBeNull();
    expect(lipoPercent(-5)).toBeNull();
  });

  it('clamps to the curve endpoints', () => {
    expect(lipoPercent(3000)).toBe(0); // ≤ 3.2 V
    expect(lipoPercent(4300)).toBe(100); // ≥ 4.2 V
  });

  it('interpolates between anchor points', () => {
    // 3.6 V sits halfway between (3.5,10) and (3.7,30) → ~20%.
    expect(lipoPercent(3600)).toBe(20);
  });
});

describe('formatVoltage', () => {
  it('formats millivolts as 2-decimal volts', () => {
    expect(formatVoltage(4020)).toBe('4.02 V');
  });
});
```

- [ ] **Step 3: Write `sortByPinned.test.ts`**

Create `tests/unit/renderer/lib/sortByPinned.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { sortByPinned } from '../../../../src/renderer/lib/sortByPinned';

interface Item {
  id: string;
  pinned?: boolean;
  unread?: boolean;
  ord?: number;
}

const sort = (items: Item[], opts: Partial<Parameters<typeof sortByPinned<Item>>[1]> = {}) =>
  sortByPinned(items, {
    key: (i) => i.id,
    isPinned: (i) => !!i.pinned,
    label: (i) => i.id,
    ...opts,
  }).map((i) => i.id);

describe('sortByPinned', () => {
  it('orders unread first, then pinned, then by label', () => {
    const items: Item[] = [
      { id: 'b' },
      { id: 'a', pinned: true },
      { id: 'c', unread: true },
    ];
    expect(sort(items, { isUnread: (i) => !!i.unread })).toEqual(['c', 'a', 'b']);
  });

  it('honors an explicit pinnedOrder', () => {
    const items: Item[] = [
      { id: 'x', pinned: true },
      { id: 'y', pinned: true },
    ];
    expect(sort(items, { pinnedOrder: ['y', 'x'] })).toEqual(['y', 'x']);
  });

  it('falls back to ascending order() then label', () => {
    const items: Item[] = [
      { id: 'b', ord: 2 },
      { id: 'a', ord: 1 },
    ];
    expect(sort(items, { order: (i) => i.ord })).toEqual(['a', 'b']);
  });

  it('does not mutate the input array', () => {
    const items: Item[] = [{ id: 'b' }, { id: 'a' }];
    sort(items);
    expect(items.map((i) => i.id)).toEqual(['b', 'a']);
  });
});
```

- [ ] **Step 4: Write `contactColor.test.ts`**

Create `tests/unit/renderer/lib/contactColor.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { getNameColor, initialsFor } from '../../../../src/renderer/lib/contactColor';

describe('getNameColor', () => {
  it('is deterministic for the same name', () => {
    expect(getNameColor('Alice')).toEqual(getNameColor('Alice'));
  });

  it('returns hsl foreground/background strings', () => {
    const c = getNameColor('Bob');
    expect(c.fg).toMatch(/^hsl\(/);
    expect(c.bg).toMatch(/^hsl\(/);
    expect(c.pillBg).toContain('color-mix');
  });
});

describe('initialsFor', () => {
  it('uses the first letter of the first two words', () => {
    expect(initialsFor('Andy Shinn')).toBe('AS');
  });

  it('uses the first two letters of a single word', () => {
    expect(initialsFor('Repeater')).toBe('Re');
  });

  it('returns ?? for an empty name', () => {
    expect(initialsFor('   ')).toBe('??');
  });

  it('returns the leading emoji as a single grapheme', () => {
    expect(initialsFor('🚀 Rocket')).toBe('🚀');
  });
});
```

- [ ] **Step 5: Write `time.test.ts`**

Create `tests/unit/renderer/lib/time.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { fmtRelative } from '../../../../src/renderer/lib/time';

// Only locale-independent branches are asserted here, so the test is stable
// regardless of the CI runner's locale/timezone.
describe('fmtRelative', () => {
  it('returns "just now" within the 45s window', () => {
    const now = 1_700_000_000_000;
    expect(fmtRelative(now, now)).toBe('just now');
    expect(fmtRelative(now - 30_000, now)).toBe('just now');
  });

  it('returns a non-empty relative string beyond the window', () => {
    const now = 1_700_000_000_000;
    const out = fmtRelative(now - 2 * 60_000, now); // 2 minutes ago
    expect(typeof out).toBe('string');
    expect(out).not.toBe('just now');
  });
});
```

- [ ] **Step 6: Write `randomSecret.test.ts`**

Create `tests/unit/renderer/lib/randomSecret.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { generate16ByteHex } from '../../../../src/renderer/lib/randomSecret';

describe('generate16ByteHex', () => {
  it('returns 32 lowercase hex chars (16 bytes)', () => {
    expect(generate16ByteHex()).toMatch(/^[0-9a-f]{32}$/);
  });

  it('is overwhelmingly unlikely to repeat', () => {
    const seen = new Set(Array.from({ length: 100 }, () => generate16ByteHex()));
    expect(seen.size).toBe(100);
  });
});
```

- [ ] **Step 7: Write `messageContent.test.ts`**

Create `tests/unit/renderer/lib/messageContent.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { parseMessageContent } from '../../../../src/renderer/lib/messageContent';

describe('parseMessageContent', () => {
  it('returns a single text token for plain text', () => {
    expect(parseMessageContent('hello world')).toEqual([{ type: 'text', value: 'hello world' }]);
  });

  it('extracts @[mentions]', () => {
    const tokens = parseMessageContent('hi @[Alice]!');
    expect(tokens).toEqual([
      { type: 'text', value: 'hi ' },
      { type: 'mention', name: 'Alice' },
      { type: 'text', value: '!' },
    ]);
  });

  it('extracts web links and trims trailing sentence punctuation', () => {
    const tokens = parseMessageContent('see https://x.com.');
    expect(tokens).toEqual([
      { type: 'text', value: 'see ' },
      { type: 'link', href: 'https://x.com' },
      { type: 'text', value: '.' },
    ]);
  });

  it('extracts a known custom URI scheme', () => {
    const tokens = parseMessageContent('add meshcore://abcd here');
    expect(tokens[1]).toEqual({ type: 'uri', scheme: 'meshcore', raw: 'meshcore://abcd' });
  });
});
```

- [ ] **Step 8: Write `meshcoreUri.test.ts`**

Create `tests/unit/renderer/lib/meshcoreUri.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { decodeMeshcoreUri } from '../../../../src/renderer/lib/meshcoreUri';

describe('decodeMeshcoreUri', () => {
  it('returns null when the prefix is missing', () => {
    expect(decodeMeshcoreUri('https://example.com')).toBeNull();
  });

  it('returns null for non-hex or odd-length payloads', () => {
    expect(decodeMeshcoreUri('meshcore://zzzz')).toBeNull();
    expect(decodeMeshcoreUri('meshcore://abc')).toBeNull();
  });

  it('returns null for an empty payload', () => {
    expect(decodeMeshcoreUri('meshcore://')).toBeNull();
  });

  it('returns null for well-formed hex that is not a valid advert', () => {
    expect(decodeMeshcoreUri('meshcore://00')).toBeNull();
  });
});
```

- [ ] **Step 9: Write `decodePacket.test.ts`**

Create `tests/unit/renderer/lib/decodePacket.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { summarizePacket } from '../../../../src/renderer/lib/decodePacket';
import { frameHex } from '../../support/frames';

describe('summarizePacket', () => {
  it('returns a structured summary without throwing on a real mesh frame', () => {
    const summary = summarizePacket(frameHex('meshPacketRaw'));
    expect(typeof summary.routeName).toBe('string');
    expect(typeof summary.typeName).toBe('string');
    expect(typeof summary.isValid).toBe('boolean');
  });

  it('reports an invalid result for non-hex input instead of throwing', () => {
    const summary = summarizePacket('zzzz');
    expect(summary.isValid).toBe(false);
    expect(summary.typeName).toBe('invalid');
  });
});
```

- [ ] **Step 10: Run all renderer lib tests**

Run: `pnpm test:unit -- renderer`
Expected: PASS — all nine `lib` test files green. If `decodePacket`'s `meshPacketRaw` frame happens to decode as invalid, the assertions still hold (they only require the right *types*, not validity).

- [ ] **Step 11: Verify typecheck and lint**

Run: `pnpm typecheck && pnpm lint`
Expected: both exit 0.

- [ ] **Step 12: Commit**

```bash
git add tests/unit/renderer/lib
git commit -m "test: cover renderer lib pure utilities"
```

---

### Task 8: Full-suite verification and coverage baseline

**Files:** none (verification only)

- [ ] **Step 1: Run the entire unit project**

Run: `pnpm test:unit`
Expected: PASS — all test files green, zero failures, output pristine (no unhandled errors or warnings).

- [ ] **Step 2: Generate the coverage baseline**

Run: `pnpm test:coverage`
Expected: a coverage table prints and `./coverage` is written. No threshold gate, so it passes regardless of percentage. Confirm `src/main/protocol/decode.ts`, `encode.ts`, `bridge/framing.ts`, `protocol/paths.ts`, and the tested `renderer/lib` files show meaningful coverage.

- [ ] **Step 3: Confirm coverage output is git-ignored**

Run: `git status --porcelain coverage`
Expected: empty output. If `coverage/` shows as untracked, add `coverage/` to `.gitignore` and commit that one-line change:
```bash
git add .gitignore
git commit -m "chore: ignore coverage output"
```

- [ ] **Step 4: Final typecheck + lint sweep**

Run: `pnpm typecheck && pnpm lint`
Expected: both exit 0.

---

## Self-Review

**Spec coverage** (against `docs/superpowers/specs/2026-05-29-testing-infrastructure-design.md`, Phase 1):
- Harness setup (Vitest + coverage + `unit` project + scripts) → Task 1. ✓
- Fixture capture from `coresense.log` + provenance README → Task 2. ✓
- `protocol/decode` all 17 parsers + truncation/null cases → Task 6 (parsers: ChannelInfo, ChannelMsgV3, ChannelMsgV1, StatusResponse*, TelemetryResponse*, Contact, ContactsStart, EndOfContacts, ContactMsgV3, ContactMsgV1*, SentAck, SendConfirmed, BattAndStorage, DeviceInfo, SelfInfo, CustomVars*, AutoAddConfig). *Note: `parseStatusResponse`, `parseTelemetryResponse`, `parseCustomVars` are not in the Task 6 file — see gap below.*
- `protocol/encode` builders + symmetric round-trips + `deriveChannelSecret` → Task 3. ✓
- `bridge/framing` FrameDecoder + encodeFrame → Task 4. ✓
- `protocol/paths` → Task 5. ✓
- `renderer/lib` DOM-free utils → Task 7. ✓
- `pnpm test:unit` green + coverage baseline → Task 8. ✓

**Gap found and resolved inline:** the design lists `parseStatusResponse`, `parseTelemetryResponse`, and `parseCustomVars` among the 17 decode parsers, but Task 6 as written covers 14. These three have non-trivial sub-decoders (status field blob, CayenneLPP, key:value parsing) worth their own tests. Add the following block to `tests/unit/main/protocol/decode.test.ts` in Task 6, Step 1 (before the final closing of the file):

```ts
import {
  parseCustomVars,
  parseStatusResponse,
  parseTelemetryResponse,
} from '../../../../src/main/protocol/decode';

describe('parseStatusResponse', () => {
  it('reads the sender prefix and decodes the leading status fields', () => {
    const payload = Buffer.alloc(8); // battery(4) + tx queue(4)
    payload.writeUInt32LE(4020, 0); // 4.02 V
    payload.writeUInt32LE(2, 4); // TX queue = 2
    const frame = Buffer.concat([Buffer.from([0x87, 0x00]), Buffer.from('aabbccddeeff', 'hex'), payload]);
    const res = parseStatusResponse(frame);
    expect(res?.senderPubKeyPrefixHex).toBe('aabbccddeeff');
    expect(res?.fields[0]).toEqual({ name: 'Battery', value: 4.02, unit: 'V' });
    expect(res?.fields[1]).toEqual({ name: 'TX queue', value: 2, unit: undefined });
  });

  it('returns null below 8 bytes', () => {
    expect(parseStatusResponse(Buffer.alloc(7))).toBeNull();
  });
});

describe('parseTelemetryResponse (CayenneLPP)', () => {
  it('decodes a voltage field', () => {
    // channel 0, type 0x74 (Voltage, u16 BE /100), value 4.20 V → 420 = 0x01a4
    const payload = Buffer.from([0x00, 0x74, 0x01, 0xa4]);
    const frame = Buffer.concat([Buffer.from([0x8b, 0x00]), Buffer.from('aabbccddeeff', 'hex'), payload]);
    const res = parseTelemetryResponse(frame);
    expect(res?.fields[0]).toMatchObject({ channel: 0, name: 'Voltage', value: 4.2, unit: 'V' });
  });
});

describe('parseCustomVars', () => {
  it('parses newline-separated key:value pairs', () => {
    const frame = Buffer.concat([Buffer.from([0x15]), Buffer.from('gps:1\ngps_interval:30', 'utf8')]);
    expect(parseCustomVars(frame)).toEqual({ gps: '1', gps_interval: '30' });
  });

  it('returns an empty object for a too-short frame', () => {
    expect(parseCustomVars(Buffer.from([0x15]))).toEqual({});
  });
});
```
(Merge these imports into the existing import block rather than duplicating the `from` line — combine into the single `decode` import at the top of the file.)

**Placeholder scan:** no TBD/TODO/"add error handling"/"write tests for the above" — every step shows real code or an exact command. ✓

**Type consistency:** function names match the source (`autoAddByteToFlags`, `pathHashModeToSize`, `parseSendConfirmed`, etc.); fixture loader exports (`frameHex`, `frameBuf`) are used consistently in Tasks 2/6/7; `RadioSettings`/`Channel` shapes match `src/shared/types.ts`. ✓

**Known soft assertion to verify at runtime (documented in-step, not a placeholder):**
- Task 6: `parseDeviceInfo` `pathHashMode`/`clientRepeat` depend on the exact fixture length — Step 2 says how to re-derive if they differ.
