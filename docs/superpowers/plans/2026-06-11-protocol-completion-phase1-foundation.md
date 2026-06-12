# Protocol Completion — Phase 1: Foundation + Device Time Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the per-feature-module foundation (buffer primitive, `Feature`/registry/context, error model, registry dispatch wired into `onPacket`) and prove it end-to-end with the **Device Time** feature (request/response path) and a one-branch **CONTACTS_FULL** migration (registry handle path).

**Architecture:** A cursor `BufferReader`/`BufferWriter` replaces hardcoded buffer offsets. A `FeatureRegistry` maps inbound wire codes → feature handlers; `ProtocolSession.onPacket` consults (1) `pendingTyped` solicited-reply awaiters, (2) the registry, then (3) the existing legacy `if`-chain as fallback. A `FeatureContext` exposes `writeFrame` + a generic `request()` to feature modules. New feature modules co-locate their own encode/decode (built on the buffer primitive); the central `encode.ts`/`decode.ts` remain for not-yet-migrated code.

**Tech Stack:** TypeScript, Node `Buffer`, Vitest. Electron main process. Firmware truth: `/Users/andy/GitHub/meshcore-dev/MeshCore/examples/companion_radio/MyMesh.cpp`.

**Design source:** [docs/superpowers/specs/2026-06-11-meshcore-protocol-completion-design.md](../specs/2026-06-11-meshcore-protocol-completion-design.md)

**Realization note:** the spec's `Feature.methods(ctx)` re-exposure is realized as **explicit delegating methods** on `ProtocolSession` (calling feature-exported functions) for TypeScript type-safety — not dynamic attachment. The `Feature` interface therefore carries only `handles` + `handle` (inbound dispatch); feature modules export their session-facing functions separately.

**Run all tests with:** `pnpm test:unit` (unit) and `pnpm test:integration` (integration). Lint with `pnpm lint` scoped via `pnpm exec biome check src tests`.

---

### Task 1: BufferReader / BufferWriter primitive

**Files:**
- Create: `src/main/protocol/buffer.ts`
- Test: `tests/unit/main/protocol/buffer.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/main/protocol/buffer.test.ts`:

```ts
import { Buffer } from 'node:buffer';
import { describe, expect, it } from 'vitest';
import { BufferReader, BufferWriter } from '../../../../src/main/protocol/buffer';

describe('BufferWriter', () => {
  it('writes little-endian integers and bytes in order', () => {
    const buf = new BufferWriter()
      .writeByte(0x06)
      .writeUInt32LE(0x01020304)
      .writeUInt16LE(0x0a0b)
      .writeBytes(Buffer.from([0xff, 0xfe]))
      .toBuffer();
    expect(buf.toString('hex')).toBe('06' + '04030201' + '0b0a' + 'fffe');
  });

  it('writeCString pads to maxLen and always null-terminates', () => {
    const buf = new BufferWriter().writeCString('hi', 4).toBuffer();
    expect([...buf]).toEqual([0x68, 0x69, 0x00, 0x00]);
  });

  it('writeCString truncates and keeps a trailing null', () => {
    const buf = new BufferWriter().writeCString('abcd', 3).toBuffer();
    expect(buf.length).toBe(3);
    expect(buf[2]).toBe(0x00);
  });
});

describe('BufferReader', () => {
  it('round-trips what BufferWriter produced', () => {
    const r = new BufferReader(
      new BufferWriter().writeByte(0x09).writeUInt32LE(0x01020304).toBuffer(),
    );
    expect(r.readByte()).toBe(0x09);
    expect(r.readUInt32LE()).toBe(0x01020304);
    expect(r.remaining).toBe(0);
  });

  it('reads signed 8/16/32 and 24-bit big-endian', () => {
    const r = new BufferReader(Buffer.from([0xff, 0xff, 0xff, 0x80, 0x00, 0x00]));
    expect(r.readInt8()).toBe(-1);
    expect(r.readInt16LE()).toBe(-1);
    expect(r.readInt24BE()).toBe(-0x800000);
  });

  it('readCString stops at the first null and consumes maxLen', () => {
    const r = new BufferReader(Buffer.from([0x68, 0x69, 0x00, 0x7a, 0x55]));
    expect(r.readCString(4)).toBe('hi');
    expect(r.remaining).toBe(1);
    expect(r.readByte()).toBe(0x55);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/unit/main/protocol/buffer.test.ts`
Expected: FAIL — cannot resolve `../../../../src/main/protocol/buffer`.

- [ ] **Step 3: Write minimal implementation**

Create `src/main/protocol/buffer.ts`:

```ts
import { Buffer } from 'node:buffer';

/** Cursor-based reader for MeshCore companion frames. Replaces hardcoded
 *  absolute offsets (e.g. `frame.readUInt32LE(132)`) so variable-length frames
 *  decode without off-by-one risk. Ported from meshcore.js's BufferReader. */
export class BufferReader {
  private pos = 0;
  constructor(private readonly buf: Buffer) {}

  get remaining(): number {
    return this.buf.length - this.pos;
  }

  readByte(): number {
    return this.buf.readUInt8(this.pos++);
  }
  readInt8(): number {
    return this.buf.readInt8(this.pos++);
  }
  readUInt16LE(): number {
    const v = this.buf.readUInt16LE(this.pos);
    this.pos += 2;
    return v;
  }
  readInt16LE(): number {
    const v = this.buf.readInt16LE(this.pos);
    this.pos += 2;
    return v;
  }
  readUInt32LE(): number {
    const v = this.buf.readUInt32LE(this.pos);
    this.pos += 4;
    return v;
  }
  readInt32LE(): number {
    const v = this.buf.readInt32LE(this.pos);
    this.pos += 4;
    return v;
  }
  /** 24-bit big-endian signed — used by CayenneLPP GPS fields. */
  readInt24BE(): number {
    let v = (this.readByte() << 16) | (this.readByte() << 8) | this.readByte();
    if ((v & 0x800000) !== 0) v -= 0x1000000;
    return v;
  }
  readBytes(n: number): Buffer {
    const v = this.buf.subarray(this.pos, this.pos + n);
    this.pos += n;
    return v;
  }
  readRemaining(): Buffer {
    return this.readBytes(this.remaining);
  }
  readString(): string {
    return this.readRemaining().toString('utf8');
  }
  /** Fixed-width null-padded string: consumes exactly `maxLen` bytes, returns
   *  the text up to the first null. */
  readCString(maxLen: number): string {
    const slice = this.readBytes(maxLen);
    const nul = slice.indexOf(0);
    return slice.subarray(0, nul === -1 ? maxLen : nul).toString('utf8');
  }
}

/** Cursor-based writer producing MeshCore companion frames. Methods chain. */
export class BufferWriter {
  private readonly bytes: number[] = [];

  writeByte(b: number): this {
    this.bytes.push(b & 0xff);
    return this;
  }
  writeInt8(b: number): this {
    this.bytes.push(b & 0xff);
    return this;
  }
  writeUInt16LE(n: number): this {
    this.bytes.push(n & 0xff, (n >>> 8) & 0xff);
    return this;
  }
  writeUInt32LE(n: number): this {
    const v = n >>> 0;
    this.bytes.push(v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff);
    return this;
  }
  writeInt32LE(n: number): this {
    return this.writeUInt32LE(n >>> 0);
  }
  writeBytes(b: Buffer | readonly number[]): this {
    for (const x of b) this.bytes.push(x & 0xff);
    return this;
  }
  writeString(s: string): this {
    return this.writeBytes(Buffer.from(s, 'utf8'));
  }
  /** Fixed-width null-padded string: writes exactly `maxLen` bytes, always
   *  null-terminated (last byte forced to 0). */
  writeCString(s: string, maxLen: number): this {
    const out = Buffer.alloc(maxLen);
    Buffer.from(s, 'utf8').copy(out, 0, 0, maxLen - 1);
    out[maxLen - 1] = 0;
    return this.writeBytes(out);
  }
  toBuffer(): Buffer {
    return Buffer.from(this.bytes);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run tests/unit/main/protocol/buffer.test.ts`
Expected: PASS (3 + 4 assertions across 6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/protocol/buffer.ts tests/unit/main/protocol/buffer.test.ts
git commit -m "feat(protocol): cursor BufferReader/BufferWriter primitive"
```

---

### Task 2: Error model + ERR_CODE expansion

**Files:**
- Modify: `src/main/protocol/errors.ts` (append two classes)
- Modify: `src/main/protocol/codes.ts:156-158` (expand `ERR_CODE`)
- Test: `tests/unit/main/protocol/errors.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/main/protocol/errors.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { ERR_CODE } from '../../../../src/main/protocol/codes';
import { FeatureDisabledError, ProtocolError } from '../../../../src/main/protocol/errors';

describe('ERR_CODE', () => {
  it('covers the firmware error set', () => {
    expect(ERR_CODE).toMatchObject({
      UNSUPPORTED_CMD: 0x01,
      NOT_FOUND: 0x02,
      TABLE_FULL: 0x03,
      BAD_STATE: 0x04,
      FILE_IO_ERROR: 0x05,
      ILLEGAL_ARG: 0x06,
    });
  });
});

describe('ProtocolError', () => {
  it('carries the firmware error code and renders it in the message', () => {
    const err = new ProtocolError(0x06);
    expect(err).toBeInstanceOf(Error);
    expect(err.errorCode).toBe(0x06);
    expect(err.message).toMatch(/0x06/);
  });

  it('tolerates an undefined error code', () => {
    expect(new ProtocolError().errorCode).toBeUndefined();
  });
});

describe('FeatureDisabledError', () => {
  it('is an Error subclass', () => {
    expect(new FeatureDisabledError()).toBeInstanceOf(Error);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/unit/main/protocol/errors.test.ts`
Expected: FAIL — `ProtocolError`/`FeatureDisabledError` not exported; `ERR_CODE` missing keys.

- [ ] **Step 3a: Expand ERR_CODE**

In `src/main/protocol/codes.ts`, replace the `ERR_CODE` block (lines 156-158):

```ts
export const ERR_CODE = {
  TABLE_FULL: 0x03,
} as const;
```

with:

```ts
export const ERR_CODE = {
  UNSUPPORTED_CMD: 0x01,
  NOT_FOUND: 0x02,
  TABLE_FULL: 0x03,
  BAD_STATE: 0x04,
  FILE_IO_ERROR: 0x05,
  ILLEGAL_ARG: 0x06,
} as const;
```

- [ ] **Step 3b: Add error classes**

Append to `src/main/protocol/errors.ts`:

```ts
/** Thrown when a companion command is answered with RESP_ERR. `errorCode` is
 *  the firmware error byte (ERR_CODE_*); undefined on a bare RESP_ERR. */
export class ProtocolError extends Error {
  constructor(public readonly errorCode?: number) {
    super(
      errorCode !== undefined
        ? `radio returned error 0x${errorCode.toString(16).padStart(2, '0')}`
        : 'radio returned an error',
    );
    this.name = 'ProtocolError';
  }
}

/** Thrown when a build-flag-gated command (e.g. private-key export/import) is
 *  answered with RESP_DISABLED on this firmware build. */
export class FeatureDisabledError extends Error {
  constructor() {
    super('feature disabled on this firmware build');
    this.name = 'FeatureDisabledError';
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run tests/unit/main/protocol/errors.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the full unit suite to confirm no regression from the ERR_CODE change**

Run: `pnpm test:unit`
Expected: PASS (existing `ERR_CODE.TABLE_FULL` consumers still resolve to `0x03`).

- [ ] **Step 6: Commit**

```bash
git add src/main/protocol/errors.ts src/main/protocol/codes.ts tests/unit/main/protocol/errors.test.ts
git commit -m "feat(protocol): ProtocolError/FeatureDisabledError + full ERR_CODE set"
```

---

### Task 3: Feature interface + FeatureRegistry

**Files:**
- Create: `src/main/protocol/feature.ts`
- Create: `src/main/protocol/registry.ts`
- Test: `tests/unit/main/protocol/registry.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/main/protocol/registry.test.ts`:

```ts
import { Buffer } from 'node:buffer';
import { describe, expect, it, vi } from 'vitest';
import type { Feature } from '../../../../src/main/protocol/feature';
import { FeatureRegistry } from '../../../../src/main/protocol/registry';

function fakeFeature(handles: number[], handle = vi.fn()): Feature {
  return { handles, handle };
}

describe('FeatureRegistry', () => {
  it('maps each handled code to its feature', () => {
    const a = fakeFeature([0x80]);
    const b = fakeFeature([0x90, 0x91]);
    const reg = new FeatureRegistry([a, b]);
    expect(reg.get(0x80)).toBe(a);
    expect(reg.get(0x91)).toBe(b);
    expect(reg.get(0x07)).toBeUndefined();
  });

  it('throws when two features claim the same code', () => {
    expect(() => new FeatureRegistry([fakeFeature([0x80]), fakeFeature([0x80])])).toThrow(
      /duplicate/i,
    );
  });

  it('dispatches a frame to the right handler', () => {
    const handle = vi.fn();
    const reg = new FeatureRegistry([fakeFeature([0x90], handle)]);
    const ctx = { writeFrame: vi.fn(), request: vi.fn() };
    reg.get(0x90)?.handle(0x90, Buffer.from([0x90, 0x01]), ctx);
    expect(handle).toHaveBeenCalledWith(0x90, Buffer.from([0x90, 0x01]), ctx);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/unit/main/protocol/registry.test.ts`
Expected: FAIL — cannot resolve `feature` / `registry`.

- [ ] **Step 3a: Create the Feature interface**

Create `src/main/protocol/feature.ts`:

```ts
import type { Buffer } from 'node:buffer';

/** The controlled slice of ProtocolSession a feature module may touch. Module
 *  singletons the legacy branches already import (stateHolder, emit,
 *  adminSessions, discoveredStore) are imported directly, not threaded here. */
export interface FeatureContext {
  /** Write a raw companion frame to the radio. */
  writeFrame(frame: Buffer): Promise<void>;
  /** Send a frame and await its reply. With `expect`, resolves the next inbound
   *  frame whose code === expect (a typed GET reply). Without `expect`, awaits
   *  the next RESP_OK/RESP_ERR and rejects with ProtocolError on RESP_ERR. */
  request(frame: Buffer, opts?: { expect?: number; timeoutMs?: number }): Promise<Buffer>;
}

/** A protocol feature: owns the inbound wire codes it reacts to. Feature
 *  modules also export their own encode*/decode* functions and session-facing
 *  functions; those are wired explicitly by ProtocolSession. */
export interface Feature {
  /** Inbound RESP_*/PUSH_* codes this feature decodes & reacts to. */
  readonly handles: readonly number[];
  /** React to an inbound frame whose code is one of `handles`. */
  handle(code: number, frame: Buffer, ctx: FeatureContext): void;
}
```

- [ ] **Step 3b: Create the registry**

Create `src/main/protocol/registry.ts`:

```ts
import type { Feature } from './feature';

/** Maps inbound companion wire codes to the feature that handles them, so
 *  ProtocolSession.onPacket can dispatch instead of switching. */
export class FeatureRegistry {
  private readonly byCode = new Map<number, Feature>();

  constructor(features: readonly Feature[]) {
    for (const feature of features) {
      for (const code of feature.handles) {
        if (this.byCode.has(code)) {
          throw new Error(
            `duplicate feature handler for code 0x${code.toString(16).padStart(2, '0')}`,
          );
        }
        this.byCode.set(code, feature);
      }
    }
  }

  get(code: number): Feature | undefined {
    return this.byCode.get(code);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run tests/unit/main/protocol/registry.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/protocol/feature.ts src/main/protocol/registry.ts tests/unit/main/protocol/registry.test.ts
git commit -m "feat(protocol): Feature interface + FeatureRegistry"
```

---

### Task 4: Wire registry + pendingTyped + request() into ProtocolSession (no behavior change)

**Files:**
- Modify: `src/main/protocol/session.ts` (imports, fields, `request()`, `onPacket` interception)

This task adds the dispatch plumbing with an **empty** registry, so behavior is unchanged and the entire existing suite stays green.

- [ ] **Step 1: Add imports**

In `src/main/protocol/session.ts`, add to the existing import block (after the `./errors` import on line 83):

```ts
import { ContactTableFullError, ProtocolError, UnknownContactError } from './errors';
import type { FeatureContext } from './feature';
import { FeatureRegistry } from './registry';
```

(Replace the existing `import { ContactTableFullError, UnknownContactError } from './errors';` line with the first line above; add the two new lines.)

- [ ] **Step 2: Add the typed-pending interface and timeout constant**

After the `PendingCli` interface (ends line 178), add:

```ts
// Awaiter for a solicited typed reply (a GET command's RESP_* frame), keyed by
// expected code in `pendingTyped`. FIFO per code.
interface PendingTyped {
  resolve: (frame: Buffer) => void;
  timer: NodeJS.Timeout;
}
```

Near the other timeout constants (after line 187), add:

```ts
// Default wait for a typed RESP_* reply to a feature ctx.request({ expect }).
const REQUEST_TIMEOUT_MS = 5_000;
```

- [ ] **Step 3: Add fields (context, registry, pendingTyped)**

After the `pendingLocalStats` field block (ends line 247), add:

```ts
  /** FIFO of awaiters per expected RESP_* code, for ctx.request({ expect }). */
  private readonly pendingTyped = new Map<number, PendingTyped[]>();
  /** The capability surface handed to feature modules. */
  private readonly ctx: FeatureContext = {
    writeFrame: (frame) => this.writeFrame(frame),
    request: (frame, opts) => this.request(frame, opts),
  };
  /** Inbound-frame handlers, keyed by wire code. Empty until features migrate. */
  private readonly registry = new FeatureRegistry([]);
```

- [ ] **Step 4: Add the request() method**

Immediately after `private async writeFrame(frame: Buffer): Promise<void> { ... }` (ends line 1165), add:

```ts
  /** Generic send→await for feature modules. See FeatureContext.request. */
  private async request(
    frame: Buffer,
    opts?: { expect?: number; timeoutMs?: number },
  ): Promise<Buffer> {
    if (opts?.expect === undefined) {
      // RESP_OK / RESP_ERR path — reuse the shared ack FIFO (resolveNextAck).
      const { promise, entry } = this.awaitAck();
      try {
        await this.writeFrame(frame);
      } catch (err) {
        this.popPendingAck(entry);
        throw err;
      }
      const ack = await promise;
      if (!ack.ok) throw new ProtocolError(ack.errorCode);
      return Buffer.alloc(0);
    }
    // Typed-reply path — resolve the next inbound frame whose code === expect.
    const expect = opts.expect;
    const timeoutMs = opts.timeoutMs ?? REQUEST_TIMEOUT_MS;
    return new Promise<Buffer>((resolve, reject) => {
      const queue = this.pendingTyped.get(expect) ?? [];
      const remove = () => {
        const q = this.pendingTyped.get(expect);
        if (!q) return;
        const i = q.indexOf(entry);
        if (i !== -1) q.splice(i, 1);
      };
      const timer = setTimeout(() => {
        remove();
        reject(new Error(`timeout waiting for frame 0x${expect.toString(16).padStart(2, '0')}`));
      }, timeoutMs);
      const entry: PendingTyped = { resolve, timer };
      queue.push(entry);
      this.pendingTyped.set(expect, queue);
      this.writeFrame(frame).catch((err) => {
        clearTimeout(timer);
        remove();
        reject(err as Error);
      });
    });
  }
```

- [ ] **Step 5: Insert the dispatch interception at the top of onPacket**

In `onPacket`, immediately after the `log.trace(...)` call (ends line 1429) and **before** `if (code === RESP.CHANNEL_INFO) {`, insert:

```ts
    // (1) Solicited typed replies (ctx.request with `expect`) get first crack.
    const typedQueue = this.pendingTyped.get(code);
    if (typedQueue && typedQueue.length > 0) {
      const entry = typedQueue.shift();
      if (entry) {
        clearTimeout(entry.timer);
        entry.resolve(frame);
        return;
      }
    }
    // (2) Modular feature handlers. Falls through to the legacy chain below for
    //     any code no feature has claimed yet.
    const feature = this.registry.get(code);
    if (feature) {
      feature.handle(code, frame, this.ctx);
      return;
    }
```

- [ ] **Step 6: Typecheck + run the full suite to confirm no behavior change**

Run: `pnpm typecheck`
Expected: PASS (no type errors).

Run: `pnpm test:unit && pnpm test:integration`
Expected: PASS — empty registry and empty `pendingTyped` mean the interception block is inert; every frame still reaches the legacy chain exactly as before.

- [ ] **Step 7: Commit**

```bash
git add src/main/protocol/session.ts
git commit -m "feat(protocol): registry + pendingTyped dispatch + ctx.request (inert; legacy fallback intact)"
```

---

### Task 5: Device Time codes + feature module (encode/decode)

**Files:**
- Modify: `src/main/protocol/codes.ts` (add `GET_DEVICE_TIME`, `SET_DEVICE_TIME` to `CMD`; `CURR_TIME` to `RESP`)
- Create: `src/main/protocol/features/time.ts`
- Test: `tests/unit/main/protocol/features/time.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/main/protocol/features/time.test.ts`:

```ts
import { Buffer } from 'node:buffer';
import { describe, expect, it } from 'vitest';
import {
  decodeCurrTime,
  encodeGetDeviceTime,
  encodeSetDeviceTime,
} from '../../../../../src/main/protocol/features/time';

describe('time feature encode/decode', () => {
  it('encodeGetDeviceTime is the bare opcode', () => {
    expect(encodeGetDeviceTime().toString('hex')).toBe('05');
  });

  it('encodeSetDeviceTime is [0x06][epoch u32 LE]', () => {
    expect(encodeSetDeviceTime(0x01020304).toString('hex')).toBe('06' + '04030201');
  });

  it('decodeCurrTime reads the little-endian epoch after the code byte', () => {
    expect(decodeCurrTime(Buffer.from([0x09, 0x04, 0x03, 0x02, 0x01]))).toBe(0x01020304);
  });

  it('decodeCurrTime returns null for a short frame', () => {
    expect(decodeCurrTime(Buffer.from([0x09, 0x04]))).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/unit/main/protocol/features/time.test.ts`
Expected: FAIL — cannot resolve `features/time`.

- [ ] **Step 3a: Add the wire codes**

In `src/main/protocol/codes.ts`, inside the `CMD` object, after `APP_START: 0x01,` (line 13) add:

```ts
  GET_DEVICE_TIME: 0x05,
  SET_DEVICE_TIME: 0x06,
```

Inside the `RESP` object, after `SENT: 0x06,` (line 125) add:

```ts
  // RESP_CURR_TIME [0x09][epoch u32 LE] — reply to CMD_GET_DEVICE_TIME.
  CURR_TIME: 0x09,
```

- [ ] **Step 3b: Create the time feature module**

Create `src/main/protocol/features/time.ts`:

```ts
import type { Buffer } from 'node:buffer';
import { BufferReader, BufferWriter } from '../buffer';
import { CMD, RESP } from '../codes';
import type { FeatureContext } from '../feature';

// CMD_GET_DEVICE_TIME: [0x05]. Replies RESP_CURR_TIME.
export function encodeGetDeviceTime(): Buffer {
  return new BufferWriter().writeByte(CMD.GET_DEVICE_TIME).toBuffer();
}

// CMD_SET_DEVICE_TIME: [0x06][epoch u32 LE]. Firmware rejects with
// ERR_CODE_ILLEGAL_ARG when epoch < its current clock. Replies RESP_OK/ERR.
export function encodeSetDeviceTime(epochSecs: number): Buffer {
  return new BufferWriter().writeByte(CMD.SET_DEVICE_TIME).writeUInt32LE(epochSecs).toBuffer();
}

// RESP_CURR_TIME: [0x09][epoch u32 LE].
export function decodeCurrTime(frame: Buffer): number | null {
  const r = new BufferReader(frame);
  r.readByte(); // code
  if (r.remaining < 4) return null;
  return r.readUInt32LE();
}

/** Read the radio's RTC clock (unix seconds). */
export async function getDeviceTime(ctx: FeatureContext): Promise<number> {
  const frame = await ctx.request(encodeGetDeviceTime(), { expect: RESP.CURR_TIME });
  const t = decodeCurrTime(frame);
  if (t === null) throw new Error('malformed RESP_CURR_TIME');
  return t;
}

/** Set the radio's RTC clock (unix seconds). Throws ProtocolError on rejection. */
export async function setDeviceTime(ctx: FeatureContext, epochSecs: number): Promise<void> {
  await ctx.request(encodeSetDeviceTime(epochSecs));
}

/** Push the host's current time to the radio. */
export async function syncDeviceTime(ctx: FeatureContext): Promise<void> {
  await setDeviceTime(ctx, Math.floor(Date.now() / 1000));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run tests/unit/main/protocol/features/time.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/protocol/codes.ts src/main/protocol/features/time.ts tests/unit/main/protocol/features/time.test.ts
git commit -m "feat(protocol): device-time wire codes + time feature encode/decode"
```

---

### Task 6: Expose device-time methods on ProtocolSession + integration tests

**Files:**
- Modify: `src/main/protocol/session.ts` (import + three delegating methods)
- Test: `tests/integration/outbound/device-time.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/integration/outbound/device-time.test.ts`:

```ts
import { Buffer } from 'node:buffer';
import { afterEach, describe, expect, it } from 'vitest';
import { emit } from '../../../src/main/events/bus';
import { protocolSession } from '../../../src/main/protocol';
import { ProtocolError } from '../../../src/main/protocol/errors';
import { transportManager } from '../../../src/main/transport/manager';
import { companionPacket, FakeTransport } from '../../support/fake-transport';

describe('device time round-trips', () => {
  afterEach(() => protocolSession().stop());

  it('getDeviceTime sends [0x05] and resolves RESP_CURR_TIME', async () => {
    const session = protocolSession();
    session.start();
    const transport = new FakeTransport();
    transportManager.setTransport(transport);

    const p = session.getDeviceTime();
    await Promise.resolve();
    expect(transport.sent[0]?.toString('hex')).toBe('05');
    emit.packet(companionPacket(Buffer.from([0x09, 0x04, 0x03, 0x02, 0x01]))); // RESP_CURR_TIME
    await expect(p).resolves.toBe(0x01020304);
  });

  it('setDeviceTime resolves on RESP_OK', async () => {
    const session = protocolSession();
    session.start();
    transportManager.setTransport(new FakeTransport());

    const p = session.setDeviceTime(1_700_000_000);
    await Promise.resolve();
    emit.packet(companionPacket(Buffer.from([0x00]))); // RESP_OK
    await expect(p).resolves.toBeUndefined();
  });

  it('setDeviceTime rejects with ProtocolError on RESP_ERR[ILLEGAL_ARG]', async () => {
    const session = protocolSession();
    session.start();
    transportManager.setTransport(new FakeTransport());

    const p = session.setDeviceTime(1);
    await Promise.resolve();
    emit.packet(companionPacket(Buffer.from([0x01, 0x06]))); // RESP_ERR + ERR_CODE_ILLEGAL_ARG
    const err = await p.catch((e) => e);
    expect(err).toBeInstanceOf(ProtocolError);
    expect((err as ProtocolError).errorCode).toBe(0x06);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/integration/outbound/device-time.test.ts`
Expected: FAIL — `session.getDeviceTime` is not a function.

- [ ] **Step 3: Add the delegating methods**

In `src/main/protocol/session.ts`, add to the import block (near the other feature/protocol imports added in Task 4):

```ts
import { getDeviceTime, setDeviceTime, syncDeviceTime } from './features/time';
```

Inside the `ProtocolSession` class, add three public methods (place them after `reboot()` near line 924, with the other device-command methods):

```ts
  /** Read the radio's RTC clock (unix seconds). */
  getDeviceTime(): Promise<number> {
    return getDeviceTime(this.ctx);
  }

  /** Set the radio's RTC clock (unix seconds). Rejects ProtocolError on a
   *  firmware ILLEGAL_ARG (the radio refuses a clock earlier than its own). */
  setDeviceTime(epochSecs: number): Promise<void> {
    return setDeviceTime(this.ctx, epochSecs);
  }

  /** Push the host's current time to the radio. */
  syncDeviceTime(): Promise<void> {
    return syncDeviceTime(this.ctx);
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run tests/integration/outbound/device-time.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Typecheck**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/main/protocol/session.ts tests/integration/outbound/device-time.test.ts
git commit -m "feat(protocol): expose getDeviceTime/setDeviceTime/syncDeviceTime"
```

---

### Task 7: Migrate CONTACTS_FULL into a feature module (prove the registry handle path)

**Files:**
- Create: `src/main/protocol/features/contactsFull.ts`
- Modify: `src/main/protocol/session.ts` (register the feature; remove the legacy branch)
- Test: `tests/integration/inbound/contacts-full.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/integration/inbound/contacts-full.test.ts`:

```ts
import { Buffer } from 'node:buffer';
import { afterEach, describe, expect, it } from 'vitest';
import { bus, emit } from '../../../src/main/events/bus';
import { protocolSession } from '../../../src/main/protocol';
import { companionPacket } from '../../support/fake-transport';

describe('PUSH_CONTACTS_FULL handled via the feature registry', () => {
  afterEach(() => protocolSession().stop());

  it('emits a user-facing error when the radio reports its contact store full', async () => {
    const session = protocolSession();
    session.start();

    const messages: string[] = [];
    const onError = (m: string) => messages.push(m);
    bus.on('errorMessage', onError);

    emit.packet(companionPacket(Buffer.from([0x90]))); // PUSH_CODE_CONTACTS_FULL
    await Promise.resolve();
    bus.off('errorMessage', onError);

    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatch(/contact store is full/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/integration/inbound/contacts-full.test.ts`
Expected: PASS unexpectedly *if run before migration* — the legacy branch still emits the error. To make this a true red→green for the migration, first **delete the legacy branch** (Step 3a) and re-run: it should still PASS only once the feature is registered (Step 3b–3c). Run Step 2 again **after Step 3a alone** to see it FAIL (no handler emits the error), then proceed.

- [ ] **Step 3a: Remove the legacy CONTACTS_FULL branch**

In `src/main/protocol/session.ts`, delete the legacy branch (lines 1518-1522):

```ts
    if (code === PUSH.CONTACTS_FULL) {
      log.warn('radio contact store is full');
      emit.error('Radio contact store is full — remove or favourite contacts to make room.');
      return;
    }
```

- [ ] **Step 3b: Create the feature module**

Create `src/main/protocol/features/contactsFull.ts`:

```ts
import type { Buffer } from 'node:buffer';
import { emit } from '../../events/bus';
import { child } from '../../log';
import { PUSH } from '../codes';
import type { Feature } from '../feature';

const log = child('protocol');

// PUSH_CODE_CONTACTS_FULL (0x90): the radio's contact store is full and a new
// advert could not be auto-added (overwrite-oldest off / all favourites).
export const contactsFullFeature: Feature = {
  handles: [PUSH.CONTACTS_FULL],
  handle: () => {
    log.warn('radio contact store is full');
    emit.error('Radio contact store is full — remove or favourite contacts to make room.');
  },
};
```

- [ ] **Step 3c: Register the feature**

In `src/main/protocol/session.ts`, add the import (near the other feature imports):

```ts
import { contactsFullFeature } from './features/contactsFull';
```

Change the registry field (added in Task 4) from:

```ts
  private readonly registry = new FeatureRegistry([]);
```

to:

```ts
  private readonly registry = new FeatureRegistry([contactsFullFeature]);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run tests/integration/inbound/contacts-full.test.ts`
Expected: PASS — the frame now routes through the registry to `contactsFullFeature.handle`.

- [ ] **Step 5: Typecheck + full suite (migration guard)**

Run: `pnpm typecheck && pnpm test:unit && pnpm test:integration`
Expected: PASS — the existing `contact-evicted`/contacts tests and everything else stay green with the branch removed.

- [ ] **Step 6: Commit**

```bash
git add src/main/protocol/features/contactsFull.ts src/main/protocol/session.ts tests/integration/inbound/contacts-full.test.ts
git commit -m "refactor(protocol): migrate CONTACTS_FULL to feature module via registry"
```

---

### Task 8: Phase wrap-up — lint + final verification

**Files:** none (verification only)

- [ ] **Step 1: Lint the touched scope**

Run: `pnpm exec biome check src tests`
Expected: PASS (no lint errors in new files). If biome reports formatting, run `pnpm exec biome check --write src tests` and re-commit.

- [ ] **Step 2: Full suite green**

Run: `pnpm test:unit && pnpm test:integration && pnpm typecheck`
Expected: ALL PASS.

- [ ] **Step 3: Commit any lint fixups**

```bash
git add -A
git commit -m "chore(protocol): biome fixups for phase-1 foundation" || echo "nothing to commit"
```

---

## Self-Review

**1. Spec coverage (Phase 1 slice):**
- BufferReader/Writer borrow → Task 1. ✅
- Error model (`ProtocolError`, `FeatureDisabledError`) + full `ERR_CODE` → Task 2. ✅
- `Feature` interface + registry + `FeatureContext` → Tasks 3–4. ✅
- `ctx.request()` (OK/ERR via FIFO + typed) → Task 4. ✅
- Registry wired into `onPacket` with legacy fallback → Task 4. ✅
- Device Time (group A: `GET/SET_DEVICE_TIME`, `RESP_CURR_TIME`) as reference feature → Tasks 5–6. ✅
- Migration pattern proven once (CONTACTS_FULL) → Task 7. ✅
- (`ctx.awaitTag` deferred to the path-diagnostics plan — intentional, YAGNI; noted in the design.)

**2. Placeholder scan:** No "TBD/TODO/handle edge cases" — every code step shows complete code; every test step shows the assertions.

**3. Type consistency:** `FeatureContext.request(frame, opts?)` signature matches its use in `time.ts` and the `ctx` field literal. `Feature.handle(code, frame, ctx)` matches the registry test and `contactsFull.ts`. `ProtocolError(errorCode?)` matches Task 2 definition and the Task 6 assertion. `PendingTyped` shape matches `request()` and the `onPacket` interception. `RESP.CURR_TIME` / `CMD.GET_DEVICE_TIME` / `CMD.SET_DEVICE_TIME` defined in Task 5, used in `time.ts`. `emit.error` → `bus.emit('errorMessage', …)` matches the Task 7 listener.

**Out-of-scope (later plans):** migrating the remaining ~17 existing features (Phase 2); new feature groups B–I (Phase 3); CayenneLPP table completion + Advert/ed25519 (Phase 4).
