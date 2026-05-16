# MeshCore Desktop — Handoff Plan

## Project overview

A desktop client for **MeshCore** LoRa mesh radios, built around the **Field Console** design — warm wood/amber palette, mono-forward typography, information-dense readouts. Goal is feature parity with the official mobile/desktop clients (channels, contacts, map, settings, remote repeater admin) plus desktop-specific extras (LAN HTTP API, web client, mobile-app proxy over WiFi).

The architectural scaffold and renderer UI shell are in place. Radio I/O is stubbed behind an interface. Several feature panels are placeholders.

---

## Stack — non-negotiable

- **pnpm** for package management; `pnpm-workspace.yaml` is set up for a single package today, ready to split if a subsystem warrants it
- **Electron** + **Electron Forge** with the **Vite** plugin
- **TypeScript** everywhere (`tsconfig.json` has path aliases: `@shared/*`, `@main/*`, `@renderer/*`)
- **React 18** + **Zustand** (renderer state cache)
- **Tailwind CSS** with the Field Console palette as CSS variables (theme switches by toggling a class — no rebuild)
- **Radix UI** primitives (Switch, Dialog, Popover) — used sparingly, only where keyboard/a11y matters
- **lucide-react** for general icons; bespoke SVGs for the channel/contact glyphs that are part of the design language
- **Fastify** + **ws** for the optional local-network HTTP+WebSocket API
- **electron-store** for persistent state, **split across multiple files** so a corrupt contact list can't kill app settings
- **tslog** with sub-loggers per subsystem (`radio`, `server`, `ipc`, `store`, `notifications`, `proxy`, `main`)

---

## What's already built

### Build & config (root)
- `package.json` with the full dep list and Forge scripts (`start`, `package`, `make`, `lint`, `typecheck`)
- `forge.config.ts` — Vite plugin wired to main/preload/renderer, AutoUnpackNatives plugin for native deps, **Electron Fuses** enabled (`OnlyLoadAppFromAsar`, `EnableEmbeddedAsarIntegrityValidation`, `RunAsNode: false`, `EnableNodeOptionsEnvironmentVariable: false`, `EnableCookieEncryption: true`)
- Three Vite configs (`vite.main.config.ts`, `vite.preload.config.ts`, `vite.renderer.config.ts`) with proper externals
- `tsconfig.json` with strict mode + `noUnusedLocals` + path aliases
- `tailwind.config.ts` reading the Field Console palette from CSS vars; `postcss.config.js` standard
- `pnpm-workspace.yaml`, `.gitignore`, `static/README.md` placeholder

### Shared types — `src/shared/`
- **`types.ts`** — wire-safe types used by main, preload, renderer, AND the HTTP API. Includes:
  - `Owner`, `RadioSettings`, `Channel`, `Contact`, `Message`, `PacketLogEntry`, `RadioConnectionState`, `RadioTransport`, `AppSettings` (with `DEFAULT_APP_SETTINGS`)
  - `ChannelKind = 'public' | 'hashtag' | 'private'`
  - `ContactKind = 'chat' | 'repeater' | 'sensor' | 'room'` plus `contactKindFromNative()` mapping the firmware's `type` integers (1=companion/chat, 2=repeater, 3=room, 4=sensor)
  - **Key encoding helpers** — `channelKey()`, `contactKey()`, `parseEntityKey()`, `PACKET_LOG_KEY`. UI routing uses a single string keyspace (`ch:<name>`, `c:<pubkey>`, `packetlog`, `settings:<sub>`). **Always use these helpers — never hand-concatenate.**
- **`ipc-channels.ts`** — single source of truth for IPC channel names. Two groups: `IPC.invoke.*` (request/response) and `IPC.events.*` (push). Don't reference channel names by string literal anywhere else.

### Main process — `src/main/`
- **`index.ts`** — app lifecycle, BrowserWindow with **all security defaults locked on** (`contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, `webviewTag: false`); `titleBarStyle: 'hiddenInset'` on macOS with `trafficLightPosition: { x: 14, y: 14 }`; `titleBarOverlay` for Windows 11 with theme-matched colors; `frame: false` on Linux. CSP enforced via `onHeadersReceived` (loose in dev for HMR, tight in prod). `setPermissionRequestHandler` denies everything by default. `setWindowOpenHandler` deny-by-default; safe external links go through `shell.openExternal`. `will-navigate` guards against in-window navigation. `nativeTheme.on('updated')` broadcasts to the renderer for `auto` theme tracking. `web-contents-created` blocks `<webview>` attachment as defense in depth.
- **`menu.ts`** — full application menu with platform conventions (mac `app.name` submenu, etc.). **Accelerators wired**: `Cmd-,` settings, `Cmd-K` palette, `Cmd-1..4` view focus, `Cmd-N` new channel, `Cmd-Shift-N` add contact, `Cmd-Shift-A` send advert. Menu items send IPC events the renderer subscribes to.
- **`ipc/index.ts`** — every renderer→main handler registered. Returns a teardown function called from `before-quit`. Bridges radio events (`state-changed`, `message`, `packet`, `message-state`) to renderer via `webContents.send`.
- **`store/index.ts`** — `PersistentStore` class wrapping electron-store. **Four separate files** (`app-settings.json`, `radio-settings.json`, `channels.json`, `contacts.json`) so corruption is isolated. Methods: `get/setAppSettings`, `get/setRadioSettings`, `get/upsert/removeChannel`, `get/upsert/removeContact`. Seeds the Public channel with the well-known shared key.
- **`radio/index.ts`** — `IRadio` interface (the public API every consumer uses) and `StubRadio` impl that synthesizes acks. **`createRadio()` factory** — swap the construction here and the rest of the system doesn't change.
- **`server/index.ts`** — `MeshcoreServer` class wrapping Fastify + WebSocket. Routes: `GET /api/health|channels|contacts|radio/settings|connection`, `PUT /api/radio/settings`, `WS /ws` for push. **Default bind `127.0.0.1`** — only the desktop itself can hit it until the user opts into `0.0.0.0` in App Settings. Toggleable via `start()`/`stop()`.
- **`server/proxy.ts`** — `MobileProxy` class skeleton. WS endpoint at `/proxy`. **TODO**: byte routing once the protocol module exists.
- **`notifications.ts`** — `NotificationRouter` consults user policy per kind: `direct-message`, `channel-mention`, `channel-message`, `repeater-alert`, `sensor-alert`. Silently rejects when policy is off.
- **`logger.ts`** — tslog with sub-loggers, level controlled by `MESHCORE_LOG_LEVEL` env var (default 3 = info).

### Preload — `src/preload/index.ts`
- Exposes a typed, narrow API on `window.meshcore` via `contextBridge.exposeInMainWorld`. Exports `MeshcoreApi = typeof api` for the renderer to import as a type. Generic `on(event, handler)` returns an unsubscribe function.

### Renderer — `src/renderer/`
- **`main.tsx`** — applies pre-mount theme (so the first frame matches the system preference), renders `<App />` in `<React.StrictMode>`. Declares `window.meshcore` typing.
- **`App.tsx`** — top-level shell. Hydrates the store on mount, subscribes to all IPC push events, tracks system theme changes for `auto` mode, listens to menu events (palette, settings, focus, advert, disconnect, theme cycle from the palette). Routes `activeKey` to the right panel: `packetlog` → `PacketLog`, `settings:app` → `AppSettingsPanel`, `settings:radio` → `RadioSettingsPanel`, `settings:identity|channels|notifications|about` → `PlaceholderSettings`, everything else → `ChannelView`. Has its own `Cmd/Ctrl-K` listener as belt-and-suspenders for when the menu accelerator is suppressed.
- **`index.html`** — pre-paint defaults inlined to avoid white flash; `.titlebar-drag` / `.titlebar-no-drag` classes for opt-in window drag regions; loads Inter from rsms.me.
- **`index.css`** — Tailwind + scrollbar styling + a `.bg-accent-soft` utility used everywhere active states render.
- **`theme/index.ts`** — Field Console palettes (dark + light) as RGB triplets; `applyTheme()` writes CSS variables to `:root` and toggles the `.dark` class; `resolveTheme(pref, systemDark)` resolves `auto` → mode.
- **`lib/store.ts`** — Zustand store. Actions: `hydrateFromMain`, `applyMessage`, `applyPacket`, `applyConnection`, `applyChannels`, `applyContacts`, `applyAppSettings`, `setActiveKey`, `setSelectedMessage`. Selector `useMessagesForActive()`. `OwnerWithRadio` type — the owner record returned by `getOwner()` includes radio settings inline so the sidebar metrics render without a second IPC call.
- **`lib/cn.ts`** — `cn()` (clsx + tailwind-merge), `fmtAgo()`, `fmtTime()`, `fmtFreqMHz()`.
- **Components**:
  - `TitleBar` — draggable strip with macOS traffic-light spacer
  - `MessageRow` — single message with self/selected accent rule and state chips
  - `MessageInfoPopover` — right-anchored card with hops, RSSI/SNR per hop, signature/flood metadata
  - `CommandPalette` — Cmd-K launcher for channels/contacts/commands; substring filter; arrow-key navigation
  - `RssiChip` — 4-bar signal indicator + numeric RSSI + hop count
  - `SettingsPrimitives` — `SettingsSection`, `SettingsRow`, `ToggleSwitch` (Radix), `TextInput`, `Select`
  - `glyphs/ChannelGlyph` — public/hashtag/private icons (SVG ported exactly from the design)
  - `glyphs/ContactGlyph` — chat/repeater/sensor/room icons (SVG ported exactly from the design)
  - `popovers/PopoverShell` + `PopoverHeader` + `PopoverItem` + `PopoverDivider` — common shell with click-outside-to-dismiss
  - `popovers/AddChannelMenu`, `AddContactMenu`, `ConnectionMenu`, `SettingsMenu`
- **Panels**:
  - `Sidebar` — 244px wide; owner card with 2x2 radio metrics and battery bar; pinned packet log row; CHANNELS section with + button; CONTACTS section with + button; clickable connection footer
  - `ChannelView` — header, message list, composer with airtime estimate, message info popover overlay
  - `PacketLog` — 6-column mono table (TIMESTAMP / DIR / KIND / SOURCE / PAYLOAD / META)
  - `AppSettingsPanel` — Appearance (theme), Local network server (enable/bind/port/mDNS/proxy), Notifications (5 toggles), Window
  - `RadioSettingsPanel` — Region preset (USA/CA, EU, AU, Custom), Modulation (freq/BW/SF/CR/TX power), Repeat mode. **Stage-and-apply** — draft state separate from saved state, with Apply/Revert buttons.
  - `PlaceholderSettings` — generic stub for unimplemented settings routes

### What's verified
- Every relative and aliased import resolves to a file that actually exists (verified with a static sweep)
- Action names match between zustand store definition and consumer references
- IPC channel names go through the constants file in both main and preload

### What's NOT verified
- `pnpm install && pnpm typecheck` has not been run. First install may surface dep version mismatches or Forge plugin shape changes — fix any errors as they come.

---

## Open architectural decisions — resolve before continuing

These are real choices, not stubs. Pick one for each before the related task:

1. **Map library** — `maplibre-gl` (vector tiles, GPU-accelerated, ~200KB, needs CSP allowance for tile server) vs. `leaflet` (raster, ~half the size, simpler). Recommend MapLibre.

2. **Serial transport** — bring `serialport` in-process (native module, prebuilds available, needs `auto-unpack-natives` already configured) vs. shell out to a `meshcore-cli` sidecar (matches upstream tooling but adds a runtime dep). Recommend in-process.

3. **Mobile-client proxy protocol** — three options:
   - (a) Verbatim BLE byte forwarding — simplest if mobile clients accept a generic transport
   - (b) Higher-level WebSocket protocol — lets us multiplex multiple mobile sessions cleanly
   - (c) Drop from v1 — punt the whole feature

4. **Message persistence** — SQLite ring buffer in main vs. file-per-channel JSON. SQLite is more work upfront but scales; JSON is fine for low-volume mesh use. Recommend SQLite via `better-sqlite3`.

---

## Next tasks — ordered

### Task 1 — Verify the build runs
- `pnpm install`
- `pnpm typecheck` — fix any compilation errors
- `pnpm start` — confirm the window opens, the sidebar renders, the dark theme applies, the placeholder Public channel appears
- Confirm Cmd-K opens the palette, settings panes are reachable, theme toggle works
- Confirm CSP doesn't break the dev server

### Task 2 — Real serial transport
- Add `serialport` to `dependencies`
- Replace `listSerialPorts` stub in `src/main/ipc/index.ts` with `SerialPort.list()`
- Create `src/main/radio/serial.ts` implementing `IRadio` via `SerialPort` open/write/data
- Update `src/main/radio/index.ts` `createRadio()` factory to return the serial impl when a USB transport is selected, stub otherwise
- Verify `auto-unpack-natives` is correctly bundling the prebuilt binary

### Task 3 — MeshCore protocol module
- Create `src/main/radio/protocol.ts` — frame encoder/decoder for the MeshCore wire format. Reference: the firmware source in the upstream MeshCore repo
- Wire encoded frames into the serial transport's `data` handler
- Emit `message`, `packet`, `state-changed`, `message-state` events on the radio instance
- Test against a real radio: receive an advert, see a contact appear in the sidebar

### Task 4 — Message persistence
- Resolve decision #4 above (SQLite recommended)
- Add the chosen dep
- Create `src/main/store/messages.ts` with insert/query/ring-buffer-trim
- Wire `getMessages(key)` IPC handler to the new store
- Wire `radio.on('message')` to insert into the store
- Verify messages survive a window reload

### Task 5 — Map view
- Resolve decision #1 above
- Create `src/renderer/panels/MapView.tsx`
- Add a `map` route to `App.tsx`'s `MainPane` switcher and a sidebar entry to reach it
- Add the tile-server URL to the prod CSP `img-src`
- Plot contacts that have `position` set, with the contact glyph as the marker

### Task 6 — HTTP API web client
- Add `@fastify/static` to deps
- In production builds, pass `rendererDistDir` to `MeshcoreServer` so the renderer is served at `GET /`
- The renderer already uses relative-base imports (`base: './'` in `vite.renderer.config.ts`) so it works either over `file://` or `http://`
- Verify a browser can hit `http://127.0.0.1:5800/` when the server is enabled and see the same UI

### Task 7 — Mobile-client proxy
- Resolve decision #3 above
- If (a) or (b): implement the routing in `src/main/server/proxy.ts`. The radio module needs a raw-frame event for verbatim forwarding — add it to `IRadio` if going with option (a)
- If (c): remove the proxy code and toggle from settings

### Task 8 — Repeater remote-admin terminal UI
- Create `src/renderer/panels/RepeaterAdmin.tsx` — accessible when the active contact is a repeater
- CLI-style transcript: input field at the bottom, scrolling history above, mono throughout
- Wire to the existing `repeaterCommand(pk, cmd)` IPC handler
- Add a sidebar affordance or context-menu entry to open the admin panel for a repeater contact

### Task 9 — QR scan flows
- Add `Add via QR` to `AddChannelMenu` and `AddContactMenu` (entries already in the popovers, need to be functional)
- Use `getUserMedia` + a JS QR decoder (`jsqr` or `@zxing/library`)
- Update CSP `media-src` if needed

### Task 10 — Identity & Keys editor
- Wire `src/renderer/panels/PlaceholderSettings.tsx` route `settings:identity` to a real panel
- Add a key-management section: generate new identity, import/export the private key (with strong "are you sure" UX)
- The owner's `publicKey` already flows through the store — the editor just needs to wire the identity-store side in main (currently the public key is hardcoded in the `getOwner` IPC handler — needs replacing)

### Task 11 — Channels & Keys list editor
- Wire `settings:channels` to a real panel
- List all channels with their kind, secret hash, and unread/muted state
- Edit, delete, regenerate-key, copy-share-link actions

### Task 12 — Real LoRa airtime estimate
- Replace the rough approximation in `ChannelView.tsx` `estimateAirtime()` with the real LoRa airtime formula using the current SF/BW/CR
- The formula is well-documented in the Semtech LoRa app notes — basically `(2^SF / BW) × (preamble_symbols + payload_symbols)`
- Pull current radio settings from the store

---

## Constraints — keep these in mind

- **Never relax the security defaults** in `src/main/index.ts`. `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` are non-negotiable. If a feature seems to need them off, the design is wrong.
- **All IPC goes through the typed `window.meshcore.*` bridge.** Don't add new IPC channels by string literal — always go through `src/shared/ipc-channels.ts`.
- **The renderer is a cache, not a source of truth.** Every mutation goes through main; the store updates from the resulting event. No optimistic local state except in-flight composer drafts.
- **One radio, multiple consumers.** The HTTP API, IPC handlers, and mobile proxy all go through the same `IRadio` instance. Don't open a second connection.
- **Server bind defaults to loopback.** When implementing or modifying the server, the user must explicitly opt into `0.0.0.0`. Don't change that default.
- **The "App settings vs Radio settings" split is structural** — separate stores, separate panes. Don't merge them.
- **Field Console aesthetic is the design.** Warm wood/amber palette, mono-forward typography for anything info-dense, small radii (3-5px), distinct glyphs per channel/contact type, RSSI/hops as visible chips. The palette is in `src/renderer/theme/index.ts` — extend it there, don't sprinkle hex codes in components.

---

## Reference files

When in doubt about how something looks or behaves, the upload bundle includes:
- The original Field Console design (`field-console.jsx`, `app.jsx`, `data.js`)
- A real MeshCore config export (`egrmesh_Hand_meshcore_config_*.json`) — the schema for radio settings, channels, and contacts
- Screenshots of the official mobile/desktop client showing the feature surface to match
