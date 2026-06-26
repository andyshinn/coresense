# mDNS service advertising — design

**Date:** 2026-06-25
**Status:** Approved (design)
**Scope:** Fix and complete mDNS advertising for the three coresense services:
`_meshcore._tcp` (bridge TCP), `_http._tcp` (app web UI/API), and
`_coresense-ws._tcp` (WebSocket).

## Problem

A discovery tool on the LAN shows **no usable data** for any coresense service:

1. **`_http._tcp` and `_coresense-ws._tcp` are never published.** The only
   `bonjour.publish()` in the codebase is for `_meshcore._tcp`
   ([src/main/bridge/mdns.ts](../../../src/main/bridge/mdns.ts)).
2. **`_meshcore._tcp` resolves with an empty address ("empty data").**
   bonjour-service sets the SRV target and A-record name to bare `os.hostname()`
   (e.g. `AndysMacStudio`) with **no `.local` TLD**. macOS mDNSResponder only
   resolves names in the `.local.` domain, so a single-label target is punted to
   unicast DNS and returns **No Such Record** — the host address comes back
   blank, even though port and TXT resolve fine.
3. **Reachability.** The HTTP/WS server binds to `127.0.0.1` only
   ([src/main/server.ts](../../../src/main/server.ts)), so even a correct record
   would advertise an address no other machine can reach.

### Evidence (verified against native `dns-sd`)

```
dns-sd -L AndysMacStudio _meshcore._tcp local
  → ...can be reached at AndysMacStudio.:5800   (bare target, no .local)
    version=1 auth=none hostapp=coresense framing=swi3   (TXT + port OK)
dns-sd -G v4 AndysMacStudio          → 0.0.0.0   No Such Record   (address fails)
```

The bug is purely the missing `.local` suffix: a single-label SRV target is
never multicast-queried. The OS does **not** need to own the host name — any
`.local` name gets multicast-queried, and bonjour answers for whatever name it
published A records under.

**Fix proven to work:** set the SRV target host to `os.hostname()` (domain
stripped) **+ `.local`** — no `scutil`, no synthetic prefix:

```
host: 'AndysMacStudio.local'              (os.hostname() base + '.local')
publish → "published OK"
dns-sd -L → ...can be reached at AndysMacStudio.local.:5000   version=1 path=/ws
dns-sd -G → AndysMacStudio.local. → 172.16.20.157, 172.16.20.241   (real LAN IPs)
```

bonjour is the sole responder for this name (the OS owns the hyphenated
`Andys-Mac-Studio.local`, a different name — so no conflict), so it resolves
only while the app is running, which is correct for a service advert. The
advertised name is the concatenated form (`AndysMacStudio.local`) rather than
macOS's canonical hyphenated `Andys-Mac-Studio.local`; it resolves and is
reachable regardless.

## Gating model

All gating reuses the existing `proxy.*` app settings; no new settings.

| Setting | Effect |
|---|---|
| `proxy.enabled` | bridge TCP listener on/off (unchanged) |
| `proxy.bindAll` | binds **both** bridge and HTTP/WS server to `0.0.0.0` (LAN) vs `127.0.0.1` |
| `proxy.mdns` | publish mDNS — only takes effect when `bindAll` is on |

- **`advertise = proxy.bindAll && proxy.mdns`.** When `bindAll` is off, publish
  **nothing** — records can only ever point at LAN addresses, so advertising a
  loopback-only service is misleading.
- Services published while advertising:
  - `_http._tcp` and `_coresense-ws._tcp` — always (the app server always runs).
  - `_meshcore._tcp` — additionally requires `proxy.enabled` (bridge listener up).
- **Behavior change:** today `_meshcore` is advertised even on loopback. Under
  this model it follows the same rule — only advertised when `bindAll` is on.
- **Default impact:** `bindAll` defaults to `false`, so out of the box **no
  services are advertised** until the user enables "bind to all interfaces."
  This replaces the current default of a broken, unreachable `_meshcore` record.

## The fix: append `.local` to the hostname

- One shared A-record host for all services:
  **`os.hostname()` (domain stripped) + `.local`** — e.g. `AndysMacStudio.local`.
  Derivation is a pure one-liner (`hostname().replace(/\..*$/, '') + '.local'`),
  no `child_process`/`scutil` and no platform branching, so it lives inside the
  testable record-builder.
- bonjour publishes A records for this name and answers the multicast query for
  it itself; the OS only needs the name to end in `.local` to query it. No
  conflict with the OS's own `.local` name (that name is the hyphenated
  `Andys-Mac-Studio.local`, distinct from the concatenated form here).
- The host is **shared by dev and prod** (same machine). Dev and prod are
  differentiated by service **instance name** (`-dev` suffix) and **port**, not
  by host.
- All three service instances set their SRV target to that host. `_meshcore`
  uses the bridge TCP port; `_http` and `_coresense-ws` share the HTTP server
  port (the WebSocket is an HTTP upgrade on `/ws`).
- `disableIPv6: true` is set on the publish: the bridge and HTTP/WS servers bind
  IPv4 (`0.0.0.0`), so advertising AAAA records would point at addresses nothing
  is listening on.

## Records

`<base>` is the instance-name base: `os.hostname()` with the domain stripped,
plus a `-dev` suffix in dev mode (the existing `serviceName` logic, unchanged).
This is the human-readable instance label and is independent of the `.local`
*host* derived above.

| Service | Instance name | Port | TXT |
|---|---|---|---|
| `_meshcore._tcp` | `<base>` (unchanged) | bridge TCP | `version=1 auth=none hostapp=coresense framing=swi3` (unchanged) |
| `_http._tcp` | `Coresense (<base>)` | HTTP | `version=1 hostapp=coresense path=/` |
| `_coresense-ws._tcp` | `Coresense (<base>)` | HTTP | `version=1 hostapp=coresense path=/ws auth=apikey` |

## Architecture

- **Rewrite [src/main/bridge/mdns.ts](../../../src/main/bridge/mdns.ts)** into a
  single publisher:
  - `buildMdnsServices(input)` — **pure** function returning `{ host, services }`
    (services empty when not advertising) from the proxy settings, instance-name
    base, dev flag, and the resolved bridge/HTTP ports. It derives the `.local`
    host inline (`os.hostname()` + `.local`) and holds all the gating and
    record-shaping logic — unit-testable without a network.
  - `startMdns({ host, services })` — thin wrapper that publishes every
    descriptor through one `Bonjour` instance and returns a handle with
    `serviceName` and `close()` (keeping the existing unpublishAll → destroy →
    timeout teardown).
- **Orchestration moves to [src/main/index.ts](../../../src/main/index.ts).**
  The bridge no longer publishes mDNS. After both `startBridge` and
  `startServer` are up, index computes the advertise decision and ports, calls
  `startMdns`, stores the handle, and closes it in `shutdown()` alongside the
  server and bridge handles.
- **HTTP/WS bind.** `startServer` accepts a `bindAddress` derived from
  `proxy.bindAll` instead of the hardcoded `127.0.0.1`. The renderer/preload
  continue to reach the server over `127.0.0.1` (binding `0.0.0.0` still accepts
  loopback connections).
- **Status.** `BridgeStatus.mdnsServiceName` continues to drive the StatusBar
  and Proxy settings UI, set to reflect whether the advertisement is actually
  running. The exact wiring (a setter on the bridge handle vs. relocating the
  field) is decided during planning.

## Security note

When `bindAll` is on, the HTTP API and WebSocket become reachable on the LAN.
Both are already API-key authenticated (`apiKeyAuth` middleware; WS requires
`?key=`), so this widens the existing bridge exposure model rather than
introducing a new unauthenticated surface. The `auth=apikey` TXT key documents
this to clients.

## Testing

- **Unit:** `buildMdnsServices` across the gating matrix (bindAll on/off, mdns
  on/off, bridge enabled/disabled; dev vs prod base; correct host, ports, TXT,
  instance names).
- **Manual:** `dns-sd -B` / `-L` / `-G` for each of the three service types,
  confirming the SRV target is a `.local` host that resolves to a reachable LAN
  address (the harness used to verify the root cause).

## Out of scope

- Switching to the native macOS mDNSResponder (`dns_sd`) instead of the
  userspace bonjour-service responder.
- Re-publishing on network interface changes (publish at startup only, as today).
- Any new UI for mDNS configuration beyond the existing Proxy settings panel.
