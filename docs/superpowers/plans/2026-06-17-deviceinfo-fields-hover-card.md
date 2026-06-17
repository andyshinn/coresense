# Device-Info Fields + Hover Card Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `pnpm link` `@andyshinn/meshcore-ts` and use its `decodeDeviceInfo` to surface firmware **version** + **build date** (and an improved fixed-offset **model**) in the owner-info hover card's new "Device" group.

**Architecture:** This is the first, self-contained slice of the larger meshcore-ts migration (spec: `docs/superpowers/specs/2026-06-17-meshcore-ts-migration-design.md`). It adopts the linked package in the **main process only** — replacing coresense's local `decodeDeviceInfo` (which only scrapes a model string) with the library's, which parses the full RESP_DEVICE_INFO fixed layout (ble_pin, build date, model, firmware version). The new fields flow through the existing `DeviceInfo` → `emit.deviceInfo` → WebSocket → Zustand path with no transport/protocol swap. It also validates pnpm-link + main-bundle resolution early, de-risking Plan 2 (the full session swap).

**Tech Stack:** TypeScript, Electron (main process), React 19 + Zustand (renderer), Vitest (unit + integration + jsdom component), Biome, pnpm.

**Scope note:** The renderer keeps `@michaelhart/meshcore-decoder` (meshcore-ts is Node-only; see spec §0). This plan does not touch the packet inspector, BLE transport, or `ProtocolSession`.

---

## File Structure

- `package.json` — add the linked `@andyshinn/meshcore-ts` dependency.
- `src/shared/types.ts` — extend `DeviceInfo` + `DEFAULT_DEVICE_INFO` with `firmwareVersion` and `firmwareBuildDate` (the renderer store and `settingsStore` both derive from these, so the fields propagate automatically).
- `src/main/protocol/features/deviceInfo.ts` — import `decodeDeviceInfo` from the package; remove coresense's local copy; fold the new fields into `DeviceInfo`.
- `src/renderer/shell/leftnav/ownerFormat.ts` — add `fmtFirmware(version, verCode)` formatting helper.
- `src/renderer/shell/leftnav/OwnerCardPopover.tsx` — render a new "Device" group (Model / Firmware / Build).
- `tests/integration/inbound/device-info.test.ts` — add a test asserting the new fields parse from a full frame.
- `tests/unit/renderer/shell/leftnav/ownerFormat.test.ts` — add `fmtFirmware` cases.
- `tests/component/` — add a jsdom test asserting the Device group renders (mirror an existing component test for store seeding).

---

## Task 1: Link the package and add the dependency

**Files:**
- Modify: `package.json` (dependencies)
- Build artifact dependency: `/Users/andy/GitHub/andyshinn/meshcore-ts/dist`

- [ ] **Step 1: Build meshcore-ts so `dist/` is current**

Run:
```bash
cd /Users/andy/GitHub/andyshinn/meshcore-ts && pnpm build
```
Expected: tsup emits `dist/index.js`, `dist/index.cjs`, `dist/index.d.ts` (and `.cts`) without errors.

- [ ] **Step 2: Link it into coresense**

Run (from the coresense repo root):
```bash
cd /Users/andy/GitHub/andyshinn/coresense && pnpm link /Users/andy/GitHub/andyshinn/meshcore-ts
```
Expected: `package.json` gains a `"@andyshinn/meshcore-ts"` entry under `dependencies` (recorded as a `link:` specifier) and `node_modules/@andyshinn/meshcore-ts` resolves to the linked repo.

- [ ] **Step 3: Verify the package resolves and exports `decodeDeviceInfo`**

Run:
```bash
cd /Users/andy/GitHub/andyshinn/coresense && node -e "const m = require('@andyshinn/meshcore-ts'); if (typeof m.decodeDeviceInfo !== 'function') { throw new Error('decodeDeviceInfo missing'); } console.log('ok: decodeDeviceInfo resolved');"
```
Expected: prints `ok: decodeDeviceInfo resolved`.

- [ ] **Step 4: Typecheck still passes**

Run: `pnpm typecheck`
Expected: no errors (the package ships its own `.d.ts`).

- [ ] **Step 5: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "build: link @andyshinn/meshcore-ts for device-info adoption"
```

---

## Task 2: Extend the shared `DeviceInfo` type and default

**Files:**
- Modify: `src/shared/types.ts` (the `DeviceInfo` interface at ~644 and `DEFAULT_DEVICE_INFO` at ~655)

- [ ] **Step 1: Add the two fields to the interface**

In `src/shared/types.ts`, change the `DeviceInfo` interface to:

```ts
export interface DeviceInfo {
  firmwareVerCode: number;
  deviceModel: string;
  /** Human-readable firmware version, e.g. "v1.15.0". Empty until DEVICE_INFO. */
  firmwareVersion: string;
  /** Firmware build date, e.g. "19 Apr 2026". Empty until DEVICE_INFO. */
  firmwareBuildDate: string;
  maxContacts: number;
  maxChannels: number;
  channelsUsed: number;
  contactsUsed: number;
  storageUsedKb: number;
  storageTotalKb: number;
  batteryMv: number;
}
```

- [ ] **Step 2: Add the fields to the default**

Change `DEFAULT_DEVICE_INFO` to include the new keys:

```ts
export const DEFAULT_DEVICE_INFO: DeviceInfo = {
  firmwareVerCode: 0,
  deviceModel: '',
  firmwareVersion: '',
  firmwareBuildDate: '',
  maxContacts: 0,
  maxChannels: 0,
  channelsUsed: 0,
  contactsUsed: 0,
  storageUsedKb: 0,
  storageTotalKb: 0,
  batteryMv: 0,
};
```

- [ ] **Step 3: Typecheck to confirm no consumer breaks**

Run: `pnpm typecheck`
Expected: PASS. (`settingsStore.loadDeviceInfo` uses `mergeDefaults(..., DEFAULT_DEVICE_INFO)` so persisted `device-info.json` files missing the keys backfill automatically; the renderer store seeds from `DEFAULT_DEVICE_INFO`.)

- [ ] **Step 4: Commit**

```bash
git add src/shared/types.ts
git commit -m "feat(types): add firmwareVersion + firmwareBuildDate to DeviceInfo"
```

---

## Task 3: Adopt the package's `decodeDeviceInfo` in the device-info feature

**Files:**
- Modify: `src/main/protocol/features/deviceInfo.ts`
- Test: `tests/integration/inbound/device-info.test.ts`

- [ ] **Step 1: Write the failing test (new fields parse from a full frame)**

Append this test inside the existing `describe(...)` block in `tests/integration/inbound/device-info.test.ts` (it already imports `bus`, `emit`, `protocolSession`, `stateHolder`, and `companionPacket`; add `Buffer` from `node:buffer` to the imports):

```ts
it('parses firmware version + build date from a full DEVICE_INFO frame', async () => {
  const session = protocolSession();
  session.start();

  const info: Array<{ firmwareVersion?: string; firmwareBuildDate?: string }> = [];
  const onInfo = (d: { firmwareVersion?: string; firmwareBuildDate?: string }) => info.push(d);
  bus.on('deviceInfo', onInfo);

  // RESP_DEVICE_INFO fixed layout (firmware MyMesh.cpp CMD_DEVICE_QUERY):
  //   [0]=code 0x0d, [1]=verCode, [2]=maxContacts/2, [3]=maxChannels,
  //   [4..7]=ble_pin u32LE, [8..19]=build date, [20..59]=model,
  //   [60..79]=firmware version, [80]=client_repeat
  const frame = Buffer.alloc(82);
  frame[0] = 0x0d;
  frame[1] = 0x0b; // ver 11
  frame[2] = 0xaf; // maxContacts / 2
  frame[3] = 0x28; // maxChannels
  frame.writeUInt32LE(0, 4); // ble_pin unset
  frame.write('19 Apr 2026', 8, 'ascii');
  frame.write('Heltec T096', 20, 'ascii');
  frame.write('v1.15.0', 60, 'ascii');
  frame[80] = 1;

  emit.packet(companionPacket(frame));
  await Promise.resolve();
  bus.off('deviceInfo', onInfo);

  expect(info.at(-1)?.firmwareVersion).toBe('v1.15.0');
  expect(info.at(-1)?.firmwareBuildDate).toBe('19 Apr 2026');
  expect(stateHolder().getDeviceInfo().deviceModel).toBe('Heltec T096');
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm test:integration -- device-info`
Expected: FAIL — `firmwareVersion` is `undefined`/`''` (coresense's local `decodeDeviceInfo` doesn't parse offsets 8..79).

- [ ] **Step 3: Replace the local decoder with the package's**

In `src/main/protocol/features/deviceInfo.ts`:

1. Add the import at the top:
```ts
import { decodeDeviceInfo } from '@andyshinn/meshcore-ts';
```
2. Delete coresense's local `decodeDeviceInfo` function **and** the local `DeviceInfoFrame` interface (the package provides both). Keep `encodeDeviceQuery` and `deviceInfoFeature`.
3. Change the `deviceInfoFeature.handle` body's fold to carry the new fields:

```ts
export const deviceInfoFeature: Feature = {
  handles: [RESP.DEVICE_INFO],
  handle: (_code, frame) => {
    const parsed = decodeDeviceInfo(frame);
    if (!parsed) return;
    const holder = stateHolder();
    const prev = holder.getDeviceInfo();
    const next = {
      ...prev,
      firmwareVerCode: parsed.firmwareVerCode,
      maxContacts: parsed.maxContacts,
      maxChannels: parsed.maxChannels,
      // Empty / undefined means a short frame didn't carry the field — keep what
      // we already knew rather than clobbering it.
      deviceModel: parsed.deviceModel || prev.deviceModel,
      firmwareVersion: parsed.firmwareVersion || prev.firmwareVersion,
      firmwareBuildDate: parsed.firmwareBuildDate || prev.firmwareBuildDate,
    };
    holder.setDeviceInfo(next);
    emit.deviceInfo(next);
    const caps = {
      repeatMode: parsed.firmwareVerCode >= 9,
      identityKeyIO: parsed.firmwareVerCode >= 25,
    };
    holder.setDeviceCapabilities(caps);
    emit.deviceCapabilities(caps);
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

- [ ] **Step 4: Confirm no other file imported the removed symbols**

Run: `grep -rn "decodeDeviceInfo\|DeviceInfoFrame" src tests`
Expected: the only references are the package import in `deviceInfo.ts`. If any other file imported the local copy, repoint it to `@andyshinn/meshcore-ts`. (`encodeDeviceQuery` is unchanged and still local.)

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm test:integration -- device-info`
Expected: PASS — both the new test and the existing `folds firmware info...` test are green (the existing one only asserts `firmwareVerCode`/`maxContacts`/caps, all unaffected).

- [ ] **Step 6: Typecheck + commit**

```bash
pnpm typecheck
git add src/main/protocol/features/deviceInfo.ts tests/integration/inbound/device-info.test.ts
git commit -m "feat(deviceInfo): adopt meshcore-ts decodeDeviceInfo for version + build date"
```

---

## Task 4: Add the `fmtFirmware` formatting helper

**Files:**
- Modify: `src/renderer/shell/leftnav/ownerFormat.ts`
- Test: `tests/unit/renderer/shell/leftnav/ownerFormat.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `tests/unit/renderer/shell/leftnav/ownerFormat.test.ts` — extend the import to include `fmtFirmware`, and add:

```ts
it('formats firmware version with its capability code', () => {
  expect(fmtFirmware('v1.15.0', 11)).toBe('v1.15.0 (ver 11)');
});
it('falls back to just the code when no version string is known', () => {
  expect(fmtFirmware('', 11)).toBe('ver 11');
});
it('shows an em dash before the first DEVICE_INFO', () => {
  expect(fmtFirmware('', 0)).toBe('—');
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm test:unit -- ownerFormat`
Expected: FAIL — `fmtFirmware is not a function`.

- [ ] **Step 3: Implement the helper**

Add to `src/renderer/shell/leftnav/ownerFormat.ts`:

```ts
/** Firmware line for the device card: version string plus the numeric
 *  capability code, e.g. "v1.15.0 (ver 11)". Falls back to just the code when
 *  the version string is unknown, or an em dash before the first DEVICE_INFO. */
export function fmtFirmware(version: string, verCode: number): string {
  if (!version) return verCode > 0 ? `ver ${verCode}` : '—';
  return `${version} (ver ${verCode})`;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test:unit -- ownerFormat`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/shell/leftnav/ownerFormat.ts tests/unit/renderer/shell/leftnav/ownerFormat.test.ts
git commit -m "feat(ownerFormat): add fmtFirmware helper"
```

---

## Task 5: Render the "Device" group in the hover card

**Files:**
- Modify: `src/renderer/shell/leftnav/OwnerCardPopover.tsx`
- Test: `tests/component/owner-card-device.test.tsx` (new; mirror an existing component test)

- [ ] **Step 1: Write the failing component test**

First read `tests/component/setup.ts` and one existing test in `tests/component/` to copy the render + store-seeding pattern (how `useStore`/`useStore.setState` is reset and seeded, and the RTL `render`/`screen` imports). Then create `tests/component/owner-card-device.test.tsx` that:

1. Seeds the store's `deviceInfo` with `{ ...DEFAULT_DEVICE_INFO, deviceModel: 'Heltec T096', firmwareVersion: 'v1.15.0', firmwareVerCode: 11, firmwareBuildDate: '19 Apr 2026' }` (import `DEFAULT_DEVICE_INFO` from `src/shared/types`).
2. Renders `<OwnerCardPopover />`.
3. Asserts the rendered text contains `Heltec T096`, `v1.15.0 (ver 11)`, and `19 Apr 2026`.

Assertion bodies (adapt the render/seed boilerplate to the existing pattern):

```tsx
expect(screen.getByText('Device')).toBeTruthy();
expect(screen.getByText('Heltec T096')).toBeTruthy();
expect(screen.getByText('v1.15.0 (ver 11)')).toBeTruthy();
expect(screen.getByText('19 Apr 2026')).toBeTruthy();
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm test:dom -- owner-card-device`
Expected: FAIL — no "Device" group / no matching text is rendered yet.

- [ ] **Step 3: Render the Device group**

In `src/renderer/shell/leftnav/OwnerCardPopover.tsx`:

1. Extend the `ownerFormat` import to include `fmtFirmware`:
```ts
import { fmtBandwidth, fmtFirmware, fmtFreqMhz, fmtGpsInterval, fmtStorageKb } from './ownerFormat';
```
2. Add a "Device" group as the first child of the outer `<div className="flex flex-col gap-3">`, immediately above the `{/* Gauges */}` block:

```tsx
<Group title="Device">
  <div className="grid grid-cols-1 gap-y-0.5">
    <KV k="Model" v={deviceInfo.deviceModel || '—'} />
    <KV k="Firmware" v={fmtFirmware(deviceInfo.firmwareVersion, deviceInfo.firmwareVerCode)} accent />
    <KV k="Build" v={deviceInfo.firmwareBuildDate || '—'} />
  </div>
</Group>
```

(`deviceInfo` is already read from the store at the top of the component; `Group` and `KV` are already defined in this file.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test:dom -- owner-card-device`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/shell/leftnav/OwnerCardPopover.tsx tests/component/owner-card-device.test.tsx
git commit -m "feat(owner-card): show device model, firmware version, build date"
```

---

## Task 6: Full verification

- [ ] **Step 1: Typecheck**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 2: Lint (scoped to source + tests)**

Run: `pnpm lint src tests`
Expected: PASS. (Repo-wide `pnpm lint` trips on pre-existing build artifacts; scope to `src tests`.)

- [ ] **Step 3: Full test suite**

Run: `pnpm test`
Expected: PASS — including the new integration, unit, and component tests.

- [ ] **Step 4: Manual hardware smoke (optional but recommended)**

Run `pnpm start`, connect to the device, open the owner hover card, and confirm the **Device** group shows the real model, `vX.Y.Z (ver N)`, and build date matching `npm run example examples/ble-get-device-info.ts`.

---

## Self-Review

- **Spec coverage:** Implements the spec's §4.5 "Device group" feature and the `DeviceInfo` extension (§4.3), sourced from the package per §0/§2. Defers the full session/transport swap (§3–§4.2, §4.4 already out of scope) to Plan 2.
- **Placeholder scan:** No TBD/TODO; every code step shows complete code. The one "mirror existing pattern" instruction (Task 5 store-seeding) names exact files to read and gives the concrete assertions.
- **Type consistency:** `decodeDeviceInfo` returns `DeviceInfoFrame` with `firmwareVersion?`/`firmwareBuildDate?` (package); folded into `DeviceInfo` (now non-optional `string`, defaulted `''`). `fmtFirmware(version: string, verCode: number)` used consistently in helper, test, and JSX.

---

## Next: Plan 2 (the full swap)

After this ships, Plan 2 replaces `ProtocolSession` with `MeshCoreSession` + a `StateHolder`-reconciling adapter, bridges `ble.ts` through `createBleTransport` (keeping the noble lifecycle and the inspector's `emit.packet` tap), delegates the command surface, deletes the now-dead `src/main/protocol/*` modules + internal tests, and keeps/adapts the flow tests. At that point this task's `decodeDeviceInfo` import is superseded by the session's own `deviceInfo` event (same fields), and the device-info feature module is deleted with the rest. Plan 2 needs its own detailed pass (notably the contacts + messages state reconciliation).
