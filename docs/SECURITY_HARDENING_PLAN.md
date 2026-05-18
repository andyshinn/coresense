# Security Hardening Plan

Findings from an audit against the [Electron security checklist](https://www.electronjs.org/docs/latest/tutorial/security). Items 1 and 2 (the highest-impact, smallest-diff fixes) have already been applied:

- Renderer HTTP server now binds to `127.0.0.1` only — [src/main/server.ts](../src/main/server.ts)
- `will-navigate` allowlist compares full origins instead of string prefixes — [src/main/index.ts](../src/main/index.ts)

The remaining items are tracked below.

## Medium

### 3. Restrict CORS on the local API

[src/main/server.ts:53-59](../src/main/server.ts#L53-L59) reflects any origin (`origin: (origin) => origin ?? '*'`). Because auth is `Authorization: Bearer`, not cookies, this isn't classic CSRF — but it lets any page the user visits read API responses if it can guess or obtain the key.

**Action**: Restrict the allowed origin list to the renderer origin (`http://127.0.0.1:<port>`) plus the Vite dev URL when `isDev`. Reject all others.

### 4. Avoid `localStorage` for the API key

[src/renderer/lib/apiKey.ts](../src/renderer/lib/apiKey.ts) stores the key in `localStorage`, exfiltratable by any XSS. The strict prod CSP (`script-src 'self'`, `object-src 'none'`, `base-uri 'none'`, `frame-ancestors 'none'`) is the real mitigation and should stay exactly as is.

Additionally, the key is currently passed in the WS URL query string ([App.tsx:234](../src/renderer/App.tsx#L234)), which is more loggable than a header.

**Action**:
- Send the WS key as the first frame after connect, or via `Sec-WebSocket-Protocol`, instead of in the query string. Update [src/main/server.ts:99-113](../src/main/server.ts#L99-L113) to read it from the chosen channel.
- Optional follow-up: move the key out of `localStorage` into a preload-injected global or an HttpOnly cookie. Lower priority given the CSP.

### 5. Don't emit the API key into log files

[src/main/api/middleware/auth.ts:36-44](../src/main/api/middleware/auth.ts#L36-L44) prints the first-run key via `console.log`. Confirm tslog's file transport (`coresense.log`) doesn't capture it; if it does, switch to `process.stderr.write` or gate the printout behind `process.stdout.isTTY`.

## Low / nice-to-have

### 6. Document or gate the bridge LAN exposure

The MeshCore bridge in [src/main/bridge/index.ts:31](../src/main/bridge/index.ts#L31) listens on `0.0.0.0` with no authentication. This is the LAN-sharing feature working as designed, but a user on a hostile network (cafe, hotel) may not realize they're publishing a mesh bridge.

**Action**: Add a user-facing setting that defaults the bridge to loopback and requires explicit opt-in to LAN binding. Surface the current bind address in the UI.

### 7. Tighten the production CSP

[src/main/index.ts:80-89](../src/main/index.ts#L80-L89) is already strong. Add:
- `form-action 'none'`
- `manifest-src 'none'`

### 8. Tighten the static-file path-traversal guard

[src/main/server.ts:73-89](../src/main/server.ts#L73-L89) does `normalize` + `startsWith(rendererDir)`. Safe today, but if `rendererDir` ever becomes a prefix of a sibling directory (`/app/renderer` vs `/app/renderer-old`), the check passes. Append `path.sep` before comparing.

## Already correct — no action needed

- `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`, `webviewTag: false` ([src/main/index.ts:145-151](../src/main/index.ts#L145-L151))
- App-level + window-level `setWindowOpenHandler` deny by default; `shell.openExternal` only for `http(s)://`
- `will-attach-webview` prevented at both app and window scope
- `setPermissionRequestHandler` denies everything by default
- Fuses: `RunAsNode=false`, `EnableNodeOptionsEnvironmentVariable=false`, `EnableNodeCliInspectArguments=false`, `EnableEmbeddedAsarIntegrityValidation=true`, `OnlyLoadAppFromAsar=true`, `EnableCookieEncryption=true` ([forge.config.ts:84-91](../forge.config.ts#L84-L91))
- No preload-exposed Electron APIs; the renderer is effectively a sandboxed web app talking to a local authenticated HTTP/WS server, which sidesteps checklist items 17 (validate IPC sender) and 20 (don't expose Electron APIs)
- API key compared with `timingSafeEqual` ([src/main/api/middleware/auth.ts:58-61](../src/main/api/middleware/auth.ts#L58-L61))
- Electron 42 is current
