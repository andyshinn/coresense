# mDNS Service Advertising Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Advertise all three coresense services over mDNS (`_meshcore._tcp`, `_http._tcp`, `_coresense-ws._tcp`) with SRV targets that resolve to a reachable LAN address.

**Architecture:** Replace the bridge-owned single-service mDNS publisher with a pure record-builder (`buildMdnsServices`) plus a thin multi-service publisher (`startMdns`) in `src/main/bridge/mdns.ts`. Orchestration moves to `src/main/index.ts`, which is called after both the bridge and HTTP/WS server are up so it knows both ports. The HTTP/WS server gains a `bindAddress` so it can bind the LAN interface, and the bridge exposes `setMdnsServiceName` so the status UI reflects what is actually advertised.

**Tech Stack:** TypeScript, Electron main process, `bonjour-service` (^1.4.1), `@hono/node-server`, `ws`, Vitest.

## Global Constraints

- Package manager: **pnpm**. Run scripts with `pnpm <script>` / `pnpm exec <bin>`.
- Lint is **scoped to `src tests`** — repo-wide `biome check` fails on pre-existing build/dist artifacts. Always run `pnpm exec biome check src tests`.
- Typecheck: `pnpm typecheck` (`tsc --noEmit`). Tests: `pnpm exec vitest run <file>` for one file, `pnpm test` for all.
- mDNS host derivation must be **pure** — `os.hostname()` + `.local`, no `child_process`/`scutil`, no platform branching.
- `disableIPv6: true` on every publish (servers bind IPv4 `0.0.0.0`).
- Gating: **`advertise = proxy.bindAll && proxy.mdns`**. When `advertise` is false, publish nothing. `_meshcore` additionally requires `proxy.enabled` (bridge listener up); `_http`/`_coresense-ws` are published whenever advertising.
- The shared SRV host is `os.hostname()` (domain stripped) + `.local`, **identical for dev and prod**. Dev/prod differ only by instance name (`-dev` suffix) and port.
- Commit messages: conventional-commit style (`feat:`/`refactor:`/`test:`), and end every commit message with the trailer:
  `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

---

### Task 1: Rewrite `mdns.ts` — builder + publisher

Replaces the contents of `src/main/bridge/mdns.ts` with a pure record-builder (`buildMdnsServices`) and a thin multi-service publisher (`startMdns`). TDD covers the builder; the publisher is glue verified by typecheck here and manual `dns-sd` in Task 4 (`new Bonjour()` binds UDP 5353, which is blocked under sandboxed/CI unit tests — do not add a network unit test for it).

**Files:**
- Modify: `src/main/bridge/mdns.ts` (replace entire file)
- Test: `tests/unit/main/bridge/mdns.test.ts` (create)

**Interfaces:**
- Produces (consumed by Task 4):
  ```ts
  export interface MdnsServiceDesc { name: string; type: string; port: number; txt: Record<string, string>; }
  export interface MdnsPlan { host: string; serviceName: string; services: MdnsServiceDesc[]; }
  export interface BuildMdnsInput {
    hostname: string;          // raw os.hostname()
    dev: boolean;
    advertise: boolean;        // proxy.bindAll && proxy.mdns
    bridgeEnabled: boolean;    // proxy.enabled
    bridgeTcpPort: number | null;
    httpPort: number;
    serviceNameOverride?: string; // process.env.BRIDGE_MDNS_NAME
  }
  export interface MdnsHandle { serviceName: string; close(): Promise<void>; }
  export function buildMdnsServices(input: BuildMdnsInput): MdnsPlan;
  export function startMdns(plan: MdnsPlan): MdnsHandle;
  ```

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/main/bridge/mdns.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { buildMdnsServices } from '../../../../src/main/bridge/mdns';

const baseInput = {
  hostname: 'AndysMacStudio.lan',
  dev: false,
  advertise: true,
  bridgeEnabled: true,
  bridgeTcpPort: 5000,
  httpPort: 7654,
} as const;

describe('buildMdnsServices', () => {
  it('derives a .local host from the hostname with the domain stripped', () => {
    expect(buildMdnsServices(baseInput).host).toBe('AndysMacStudio.local');
  });

  it('does not double-append .local when the hostname already ends in .local', () => {
    expect(buildMdnsServices({ ...baseInput, hostname: 'box.local' }).host).toBe('box.local');
  });

  it('publishes all three services when advertising with the bridge enabled', () => {
    const plan = buildMdnsServices(baseInput);
    expect(plan.services.map((s) => s.type)).toEqual(['meshcore', 'http', 'coresense-ws']);
  });

  it('shapes the meshcore record with the bridge port and framing TXT', () => {
    const m = buildMdnsServices(baseInput).services.find((s) => s.type === 'meshcore');
    expect(m).toMatchObject({
      name: 'AndysMacStudio',
      port: 5000,
      txt: { version: '1', hostapp: 'coresense', auth: 'none', framing: 'swi3' },
    });
  });

  it('shapes the http and ws records on the http port with path TXT', () => {
    const plan = buildMdnsServices(baseInput);
    expect(plan.services.find((s) => s.type === 'http')).toMatchObject({
      name: 'Coresense (AndysMacStudio)',
      port: 7654,
      txt: { version: '1', hostapp: 'coresense', path: '/' },
    });
    expect(plan.services.find((s) => s.type === 'coresense-ws')).toMatchObject({
      name: 'Coresense (AndysMacStudio)',
      port: 7654,
      txt: { version: '1', hostapp: 'coresense', path: '/ws', auth: 'apikey' },
    });
  });

  it('publishes nothing when not advertising (host still derived)', () => {
    const plan = buildMdnsServices({ ...baseInput, advertise: false });
    expect(plan.services).toEqual([]);
    expect(plan.host).toBe('AndysMacStudio.local');
  });

  it('omits meshcore when the bridge is disabled', () => {
    const plan = buildMdnsServices({ ...baseInput, bridgeEnabled: false });
    expect(plan.services.map((s) => s.type)).toEqual(['http', 'coresense-ws']);
  });

  it('omits meshcore when there is no bridge tcp port', () => {
    const plan = buildMdnsServices({ ...baseInput, bridgeTcpPort: null });
    expect(plan.services.map((s) => s.type)).toEqual(['http', 'coresense-ws']);
  });

  it('appends -dev to the instance name in dev mode but not the host', () => {
    const plan = buildMdnsServices({ ...baseInput, dev: true });
    expect(plan.serviceName).toBe('AndysMacStudio-dev');
    expect(plan.host).toBe('AndysMacStudio.local');
    expect(plan.services.find((s) => s.type === 'meshcore')?.name).toBe('AndysMacStudio-dev');
    expect(plan.services.find((s) => s.type === 'http')?.name).toBe('Coresense (AndysMacStudio-dev)');
  });

  it('uses the service-name override for instance names but keeps the host from the hostname', () => {
    const plan = buildMdnsServices({ ...baseInput, dev: true, serviceNameOverride: 'custom' });
    expect(plan.serviceName).toBe('custom');
    expect(plan.host).toBe('AndysMacStudio.local');
    expect(plan.services.find((s) => s.type === 'http')?.name).toBe('Coresense (custom)');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm exec vitest run tests/unit/main/bridge/mdns.test.ts`
Expected: FAIL — `buildMdnsServices` is not exported yet (the current `mdns.ts` only exports `startMdns` with a different signature).

- [ ] **Step 3: Replace `src/main/bridge/mdns.ts`**

Replace the entire file with:

```ts
import { Bonjour } from 'bonjour-service';

export interface MdnsServiceDesc {
  name: string;
  type: string;
  port: number;
  txt: Record<string, string>;
}

export interface MdnsPlan {
  host: string;
  serviceName: string;
  services: MdnsServiceDesc[];
}

export interface BuildMdnsInput {
  hostname: string;
  dev: boolean;
  advertise: boolean;
  bridgeEnabled: boolean;
  bridgeTcpPort: number | null;
  httpPort: number;
  serviceNameOverride?: string;
}

export interface MdnsHandle {
  serviceName: string;
  close(): Promise<void>;
}

const TXT_COMMON = {
  version: '1',
  hostapp: 'coresense',
};

const SHUTDOWN_TIMEOUT_MS = 1000;

function stripDomain(h: string): string {
  return h.replace(/\..*$/, '');
}

export function buildMdnsServices(input: BuildMdnsInput): MdnsPlan {
  const base = stripDomain(input.hostname);
  const serviceName = input.serviceNameOverride ?? (input.dev ? `${base}-dev` : base);
  const host = `${base}.local`;
  const friendly = `Coresense (${serviceName})`;

  const services: MdnsServiceDesc[] = [];
  if (input.advertise) {
    if (input.bridgeEnabled && input.bridgeTcpPort !== null) {
      services.push({
        name: serviceName,
        type: 'meshcore',
        port: input.bridgeTcpPort,
        txt: { ...TXT_COMMON, auth: 'none', framing: 'swi3' },
      });
    }
    services.push({
      name: friendly,
      type: 'http',
      port: input.httpPort,
      txt: { ...TXT_COMMON, path: '/' },
    });
    services.push({
      name: friendly,
      type: 'coresense-ws',
      port: input.httpPort,
      txt: { ...TXT_COMMON, path: '/ws', auth: 'apikey' },
    });
  }

  return { host, serviceName, services };
}

export function startMdns(plan: MdnsPlan): MdnsHandle {
  const bonjour = new Bonjour();
  for (const desc of plan.services) {
    bonjour.publish({
      name: desc.name,
      type: desc.type,
      protocol: 'tcp',
      port: desc.port,
      host: plan.host,
      disableIPv6: true,
      txt: desc.txt,
    });
  }
  return {
    serviceName: plan.serviceName,
    close: () =>
      new Promise<void>((resolve) => {
        const timer = setTimeout(() => resolve(), SHUTDOWN_TIMEOUT_MS);
        try {
          bonjour.unpublishAll(() => {
            bonjour.destroy(() => {
              clearTimeout(timer);
              resolve();
            });
          });
        } catch {
          clearTimeout(timer);
          resolve();
        }
      }),
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm exec vitest run tests/unit/main/bridge/mdns.test.ts`
Expected: PASS (all builder tests green).

- [ ] **Step 5: Typecheck and lint**

Run: `pnpm typecheck && pnpm exec biome check src tests`
Expected: errors **only** in `src/main/bridge/index.ts` (it still imports the old `startMdns({serviceName, tcpPort})` shape and uses `MdnsHandle` differently). That file is rewritten in Task 3. No errors in `mdns.ts` or the test file. If anything else errors, fix it before continuing.

- [ ] **Step 6: Commit**

```bash
git add src/main/bridge/mdns.ts tests/unit/main/bridge/mdns.test.ts
git commit -m "feat(mdns): buildMdnsServices builder + multi-service publisher

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

> Note: between this task and Task 3, `src/main/bridge/index.ts` will not typecheck because it still calls the old `startMdns`. This is expected and resolved in Task 3. Do not "fix" `index.ts` here.

---

### Task 2: Bind the HTTP/WS server to a configurable address

Lets the HTTP/WS server bind the LAN interface so advertised records are reachable. Glue change; verified by typecheck + the existing suite (no behavior change until Task 4 passes `bindAddress`).

**Files:**
- Modify: `src/main/server.ts` (`StartServerOptions`, `startServer`, `listenWithFallback`)

**Interfaces:**
- Produces (consumed by Task 4): `startServer(rendererDir, bridge, { dev?: boolean; bindAddress?: string })` — `bindAddress` defaults to `'127.0.0.1'`.

- [ ] **Step 1: Add `bindAddress` to `StartServerOptions`**

In `src/main/server.ts`, change:

```ts
interface StartServerOptions {
  dev?: boolean;
}
```

to:

```ts
interface StartServerOptions {
  dev?: boolean;
  bindAddress?: string;
}
```

- [ ] **Step 2: Resolve and thread the bind address**

In `startServer`, just below `const defaultPort = opts.dev ? DEFAULT_PORT_DEV : DEFAULT_PORT_PROD;` add:

```ts
  const bindAddress = opts.bindAddress ?? '127.0.0.1';
```

Then change the listen call from:

```ts
  const httpServer = await listenWithFallback(app.fetch, defaultPort, (p) => {
    boundPort = p;
  });
```

to:

```ts
  const httpServer = await listenWithFallback(app.fetch, defaultPort, bindAddress, (p) => {
    boundPort = p;
  });
```

- [ ] **Step 3: Accept and use the hostname in `listenWithFallback`**

Change the function to:

```ts
function listenWithFallback(
  fetch: FetchHandler,
  startPort: number,
  hostname: string,
  onBound: (port: number) => void,
): Promise<ServerType> {
  return new Promise((resolve, reject) => {
    let attempt = 0;
    const tryPort = (port: number) => {
      const server = serve({ fetch, port, hostname }, (info) => {
        onBound(info.port);
        resolve(server);
      });
      server.on('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'EADDRINUSE' && attempt < MAX_PORT_PROBES) {
          attempt += 1;
          tryPort(port + 1);
        } else {
          reject(err);
        }
      });
    };
    tryPort(startPort);
  });
}
```

- [ ] **Step 4: Typecheck and lint**

Run: `pnpm typecheck && pnpm exec biome check src tests`
Expected: the only remaining error is the pre-existing `src/main/bridge/index.ts` breakage from Task 1 (fixed in Task 3). `server.ts` itself is clean.

- [ ] **Step 5: Run the existing suite to confirm nothing regressed**

Run: `pnpm test`
Expected: PASS (server default still binds `127.0.0.1`).

- [ ] **Step 6: Commit**

```bash
git add src/main/server.ts
git commit -m "feat(server): configurable bind address for HTTP/WS

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Stop publishing mDNS in the bridge; add `setMdnsServiceName`

The bridge no longer owns mDNS. It exposes `setMdnsServiceName` so the orchestrator (Task 4) can report what is actually advertised, keeping the StatusBar/Proxy UI accurate. This task also resolves the `src/main/bridge/index.ts` typecheck breakage left by Task 1.

**Files:**
- Modify: `src/main/bridge/hub.ts` (add `setMdnsServiceName`)
- Modify: `src/main/bridge/index.ts` (remove mDNS publishing, `serviceName`, `enableMdns`; add `setMdnsServiceName` to the handle)
- Test: `tests/unit/main/bridge/hub-status.test.ts` (create)

**Interfaces:**
- Produces (consumed by Task 4):
  - `BridgeHub.setMdnsServiceName(name: string | null): void`
  - `BridgeHandle.setMdnsServiceName(name: string | null): void`
  - `BridgeHandle` no longer has a `serviceName` field.
  - `BridgeOptions` no longer has `serviceName` or `enableMdns`.

- [ ] **Step 1: Write the failing test for the hub status setter**

Create `tests/unit/main/bridge/hub-status.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { BridgeHub } from '../../../../src/main/bridge/hub';

describe('BridgeHub.setMdnsServiceName', () => {
  it('updates the mdnsServiceName surfaced by getStatus and emits statusChanged', () => {
    const hub = new BridgeHub();
    hub.setListeners({ bindAddress: '0.0.0.0', lanAddress: null, tcpPort: 5000, mdnsServiceName: null });
    expect(hub.getStatus().mdnsServiceName).toBe(null);

    let emitted = 0;
    hub.on('statusChanged', () => {
      emitted += 1;
    });
    hub.setMdnsServiceName('AndysMacStudio');
    expect(hub.getStatus().mdnsServiceName).toBe('AndysMacStudio');
    expect(emitted).toBe(1);

    hub.setMdnsServiceName(null);
    expect(hub.getStatus().mdnsServiceName).toBe(null);

    hub.close();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run tests/unit/main/bridge/hub-status.test.ts`
Expected: FAIL — `hub.setMdnsServiceName is not a function`.

- [ ] **Step 3: Add `setMdnsServiceName` to `BridgeHub`**

In `src/main/bridge/hub.ts`, immediately after the `setListeners(...)` method (after its closing `}`, around line 70) add:

```ts
  setMdnsServiceName(name: string | null): void {
    this.mdnsServiceName = name;
    this.emit('statusChanged');
  }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm exec vitest run tests/unit/main/bridge/hub-status.test.ts`
Expected: PASS.

- [ ] **Step 5: Replace `src/main/bridge/index.ts`**

Replace the entire file with:

```ts
import { networkInterfaces } from 'node:os';
import { BRIDGE_DEFAULT_TCP_PORT, BRIDGE_DEFAULT_TCP_PORT_DEV, type BridgeStatus } from '../../shared/types';
import { emit } from '../events/bus';
import { BridgeHub } from './hub';
import { startTcpListener, type TcpListenerHandle } from './tcp';

export interface BridgeOptions {
  tcpPort?: number;
  bindAddress?: string;
  enableTcp?: boolean;
  dev?: boolean;
}

export interface BridgeHandle {
  tcpPort: number | null;
  getStatus(): BridgeStatus;
  setMdnsServiceName(name: string | null): void;
  on(ev: 'statusChanged', fn: () => void): void;
  off(ev: 'statusChanged', fn: () => void): void;
  close(): Promise<void>;
}

const DEFAULT_BIND = '127.0.0.1';

export async function startBridge(opts: BridgeOptions = {}): Promise<BridgeHandle> {
  const defaultTcp = opts.dev ? BRIDGE_DEFAULT_TCP_PORT_DEV : BRIDGE_DEFAULT_TCP_PORT;
  const tcpPort = opts.tcpPort ?? readNumberEnv('BRIDGE_TCP_PORT', defaultTcp);
  const bindAddress = opts.bindAddress ?? process.env.BRIDGE_BIND ?? DEFAULT_BIND;
  const enableTcp = opts.enableTcp ?? readBoolEnv('BRIDGE_TCP_ENABLED', true);

  const hub = new BridgeHub();

  let tcp: TcpListenerHandle | null = null;

  if (enableTcp) {
    try {
      tcp = await startTcpListener(hub, bindAddress, tcpPort);
    } catch (err) {
      emit.error(`Bridge: TCP listener failed: ${(err as Error).message}`);
    }
  }

  hub.setListeners({
    bindAddress,
    lanAddress: resolveLanAddress(bindAddress),
    tcpPort: tcp?.port ?? null,
    mdnsServiceName: null,
  });

  return {
    tcpPort: tcp?.port ?? null,
    getStatus: () => hub.getStatus(),
    setMdnsServiceName: (name) => hub.setMdnsServiceName(name),
    on: (ev, fn) => hub.on(ev, fn),
    off: (ev, fn) => hub.off(ev, fn),
    close: async () => {
      await Promise.allSettled([tcp?.close() ?? Promise.resolve()]);
      hub.close();
    },
  };
}

function readNumberEnv(key: string, fallback: number): number {
  const raw = process.env[key];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed) || parsed <= 0 || parsed > 65535) {
    emit.error(`Bridge: invalid ${key}=${raw}, using ${fallback}`);
    return fallback;
  }
  return parsed;
}

function readBoolEnv(key: string, fallback: boolean): boolean {
  const raw = process.env[key];
  if (raw === undefined) return fallback;
  return !/^(0|false|no|off)$/i.test(raw);
}

function resolveLanAddress(bindAddress: string): string | null {
  // If the user pinned a real bind address, that's the answer.
  if (bindAddress !== '0.0.0.0' && bindAddress !== '::' && bindAddress !== '') {
    return bindAddress;
  }
  // Pick the first non-internal IPv4 address; macOS Wi-Fi (en0) typically wins.
  const ifaces = networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const info of ifaces[name] ?? []) {
      if (info.family === 'IPv4' && !info.internal) {
        return info.address;
      }
    }
  }
  return null;
}
```

> This removes the `startMdns`/`MdnsHandle` import, the `mdns` variable and `if (enableMdns && tcp)` block, the `serviceName`/`baseHost`/`enableMdns` derivations, the `hostname` import, the `serviceName` handle field, and the `mdns?.close()` in `close()`. The mDNS error path (`Bridge: mDNS publish failed`) moves to Task 4.

- [ ] **Step 6: Typecheck — expect only index.ts to break (fixed in Task 4)**

Run: `pnpm typecheck`
Expected: errors **only** in `src/main/index.ts` referencing `enableMdns` and `bridgeHandle.serviceName`. No errors in `src/main/bridge/*` or `src/main/server.ts`. (If any `bridge/*` file errors, fix it before continuing.)

- [ ] **Step 7: Lint and run the bridge tests**

Run: `pnpm exec biome check src tests && pnpm exec vitest run tests/unit/main/bridge/`
Expected: lint clean; tests PASS (`framing`, `mdns`, `hub-status`).

- [ ] **Step 8: Commit**

```bash
git add src/main/bridge/hub.ts src/main/bridge/index.ts tests/unit/main/bridge/hub-status.test.ts
git commit -m "refactor(bridge): remove mDNS publishing, add setMdnsServiceName

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Orchestrate mDNS from `index.ts`

Wires gating, ports, binding, publishing, status, and shutdown together. Integration glue verified by typecheck, the full suite, and manual `dns-sd`.

**Files:**
- Modify: `src/main/index.ts`

**Interfaces:**
- Consumes: `buildMdnsServices`, `startMdns`, `MdnsHandle` (Task 1); `startServer({ bindAddress })` (Task 2); `bridgeHandle.setMdnsServiceName` (Task 3).

- [ ] **Step 1: Add imports**

In `src/main/index.ts`, add at the top with the other `node:` imports:

```ts
import { hostname } from 'node:os';
```

and below the existing `import { type BridgeHandle, startBridge } from './bridge';` line add:

```ts
import { buildMdnsServices, type MdnsHandle, startMdns } from './bridge/mdns';
```

> If `emit` is not already imported in this file, also add `import { emit } from './events/bus';` (it is used in Step 3).

- [ ] **Step 2: Add the module-level mDNS handle**

Next to `let bridgeHandle: BridgeHandle | null = null;` (around line 74) add:

```ts
let mdnsHandle: MdnsHandle | null = null;
```

- [ ] **Step 3: Replace the bridge/server startup block**

Replace this block (currently around lines 103–116):

```ts
  const proxy = stateHolder().getAppSettings().proxy;
  bridgeHandle = await startBridge({
    dev: isDev,
    enableTcp: proxy.enabled,
    enableMdns: proxy.enabled && proxy.mdns,
    bindAddress: proxy.bindAll ? '0.0.0.0' : '127.0.0.1',
    tcpPort: proxy.port,
  });
  log.info(`bridge: TCP=${bridgeHandle.tcpPort ?? 'off'} mDNS=${bridgeHandle.serviceName ?? 'off'}`);

  const rendererDir = isDev ? null : path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}`);

  serverHandle = await startServer(rendererDir, bridgeHandle, { dev: isDev });
  log.info(`server listening on http://127.0.0.1:${serverHandle.port}`);
```

with:

```ts
  const proxy = stateHolder().getAppSettings().proxy;
  const bindAddress = proxy.bindAll ? '0.0.0.0' : '127.0.0.1';
  bridgeHandle = await startBridge({
    dev: isDev,
    enableTcp: proxy.enabled,
    bindAddress,
    tcpPort: proxy.port,
  });
  log.info(`bridge: TCP=${bridgeHandle.tcpPort ?? 'off'}`);

  const rendererDir = isDev ? null : path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}`);

  serverHandle = await startServer(rendererDir, bridgeHandle, { dev: isDev, bindAddress });
  log.info(`server listening on http://127.0.0.1:${serverHandle.port}`);

  // mDNS is published once both ports are known. Records are only advertised
  // when the servers bind the LAN (bindAll) and mDNS is enabled — otherwise the
  // SRV target would point at an address nothing else can reach.
  const mdnsPlan = buildMdnsServices({
    hostname: hostname(),
    dev: isDev,
    advertise: proxy.bindAll && proxy.mdns,
    bridgeEnabled: proxy.enabled,
    bridgeTcpPort: bridgeHandle.tcpPort,
    httpPort: serverHandle.port,
    serviceNameOverride: process.env.BRIDGE_MDNS_NAME,
  });
  if (mdnsPlan.services.length > 0) {
    try {
      mdnsHandle = startMdns(mdnsPlan);
    } catch (err) {
      emit.error(`Bridge: mDNS publish failed: ${(err as Error).message}`);
    }
  }
  bridgeHandle.setMdnsServiceName(mdnsHandle?.serviceName ?? null);
  log.info(`mDNS=${mdnsHandle?.serviceName ?? 'off'} services=${mdnsPlan.services.length}`);
```

- [ ] **Step 4: Close the mDNS handle on shutdown**

In `shutdown()` (around line 446), immediately after `const tasks: Promise<unknown>[] = [];` add:

```ts
  if (mdnsHandle) {
    const handle = mdnsHandle;
    mdnsHandle = null;
    tasks.push(handle.close().catch((err) => log.warn(`mdns close failed: ${(err as Error).message}`)));
  }
```

- [ ] **Step 5: Typecheck, lint, full suite**

Run: `pnpm typecheck && pnpm exec biome check src tests && pnpm test`
Expected: all PASS, no type/lint errors.

- [ ] **Step 6: Manual verification with `dns-sd` (macOS)**

Run the app with the proxy set to **bind to all interfaces** and **mDNS enabled** (Settings → Proxy: enable, bind all, mDNS), then in a terminal:

```bash
# All three service types should list a coresense instance:
dns-sd -B _meshcore._tcp local      # → instance present (if bridge enabled)
dns-sd -B _http._tcp local          # → "Coresense (<base>)" present
dns-sd -B _coresense-ws._tcp local  # → "Coresense (<base>)" present

# Resolve a service and confirm a REAL address (not "No Such Record"):
dns-sd -L "Coresense (<base>)" _coresense-ws._tcp local   # → host:port + TXT (path=/ws auth=apikey)
dns-sd -G v4 <base>.local                                 # → 172.x / 192.x LAN IP (not 0.0.0.0)
```

Expected: each `-B` lists the coresense instance; `-L` shows `<base>.local.:<port>` with the TXT keys; `-G` resolves `<base>.local` to a real LAN IPv4. Then toggle **bind all OFF**, relaunch, and confirm all three `-B` browses show **no** coresense instance (advertise-nothing gate).

- [ ] **Step 7: Commit**

```bash
git add src/main/index.ts
git commit -m "feat(mdns): advertise http, ws, and meshcore from one publisher

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

**1. Spec coverage**
- _http/_coresense-ws never published → Task 1 (descriptors + publisher) + Task 4 (wiring). ✓
- "empty data" / `.local` host fix → Task 1 `host` derivation + `host:` on publish. ✓ (covered by `mdns.test.ts` host cases)
- Reachability / bind LAN → Task 2 (`bindAddress`) + Task 4 (`bindAll → 0.0.0.0`). ✓
- Gating `advertise = bindAll && mdns`, meshcore needs `enabled`, advertise-nothing when off → Task 1 logic + tests; Task 4 passes the flags; manual toggle check in Task 4 Step 6. ✓
- Records table (names/ports/TXT) → Task 1 tests assert each. ✓
- `disableIPv6: true` → Task 1 publisher. ✓
- Status `mdnsServiceName` reflects actual advert → Task 3 (`setMdnsServiceName`) + Task 4 call. ✓
- One Bonjour instance / single `close()` on shutdown → Task 1 + Task 4 Step 4. ✓
- Security note (API-key already enforced) → no code change; documented via `auth=apikey` TXT (Task 1). ✓
- Out of scope (native responder, iface-change re-publish, new UI) → not implemented. ✓

**2. Placeholder scan:** No TBD/TODO/"handle edge cases"; every code step shows full code. ✓

**3. Type consistency:** `MdnsPlan`/`MdnsServiceDesc`/`BuildMdnsInput`/`MdnsHandle` defined in Task 1, used unchanged in Task 4. `setMdnsServiceName(name: string | null)` identical in hub (Task 3 Step 3), `BridgeHandle` (Task 3 Step 5), and the call site (Task 4 Step 3). `startServer(..., { bindAddress })` defined in Task 2, called in Task 4. `bridgeHandle.serviceName` removed in Task 3 and no longer referenced after Task 4 Step 3. ✓

## Notes for the implementer

- Tasks 1, 3 are test-first (TDD). Tasks 2, 4 are glue verified by typecheck + the existing suite + manual `dns-sd` (publishing binds UDP 5353, which can't run in sandboxed/CI unit tests — do not add network unit tests for it).
- **Cross-task typecheck:** after Task 1, `src/main/bridge/index.ts` does not typecheck (still calls the old `startMdns`); after Task 3, `src/main/index.ts` does not typecheck (still references `enableMdns`/`serviceName`). Both are expected and resolved by the named later task. Do not pre-fix them.
