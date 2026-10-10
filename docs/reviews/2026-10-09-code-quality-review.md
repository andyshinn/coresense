# Code quality review: 2026-10-09

This report comes from a multi-agent review of `src/` and `tests/` at main `93e7b27`. Fifteen reviewers each covered one subsystem. Five more each looked across the whole codebase for one concern: DRY, types, errors/async, architecture, and tooling. An independent verifier then checked every finding, and 293 of 294 held up.

Batches B1–B15 are implemented on branch `refactor/code-quality`. **This document records what is still open.** Batches D1–D4 were deferred because each one needs your decision, a manual or packaged-app check, or a large change that cuts across many files. Some findings were handled only in part: helpers were adopted inside each batch's own files, and the leftover call sites were finished in the final integration pass.

## Overall assessment

CoreSense is in good shape for a codebase of its size and age. strict TypeScript is on, src has no explicit `any`, no non-null assertions and no ts-ignore, Biome reports zero diagnostics, and all 44 biome-ignores give a reason. Tests drive real paths (a real MeshCoreSession over a loopback transport, real sqlite in temp dirs). The "why" comments are unusually good and record firmware and library quirks. Where code was designed for testing, it is clean: updates/*, runtime seams, the CLI pure core, mergeMessages, messageListSync, the macros package, and the small storage/bridge modules (contactWalk, inboxCache, framing). Reviewers kept finding the same thing: hard algorithms are pulled out into pure, tested modules, and the debt sits in the glue around them.

The systemic problems are about boundaries and ownership, not local code quality.
- **Conventions both processes depend on have no shared owner.** Conversation keys (`ch:`/`c:`/`tool:`), the `name:` sender sentinel, hex helpers, time units, log levels, GPS-fix validity, pubkey abbreviation and clamping are each re-implemented 3 to 60 times, and the copies already disagree.
- **Every process boundary is cast rather than typed or validated:** HTTP bodies (about 30 `as T` casts), an HTTP contract typed twice that has drifted (`1|2|4` vs `1|2|3`), an untyped EventEmitter bus next to a `BusEvents` map nothing uses, settings JSON, SQLite rows, WS frames and IPC channel strings.
- **Error handling has no shared vocabulary:** about 150 `(err as Error).message` casts, about 20 hand-built catch→503 blocks, no Hono onError, and silent catches (useWebSocket swallows every handler exception).
- **A few hub modules have accumulated most of the complexity:** routes.ts (1300 lines), index.ts (622), store.ts (1300 lines and about 130 members), shared/types.ts (1305), LeftNav, MapClusters, searchMessages.
- **Dead code is left over from the meshcore-ts migration.** Its most important piece is the shadow protocol/errors.ts, and that one is an actual bug.

Spot checks confirmed the highest-severity items:
- routes.ts:35 imports `ContactTableFullError`/`UnknownContactError` from the dead local `../protocol/errors`, so the 409/422 mappings at :757-789 can never fire.
- updates/wiring.ts hides the logger shape behind `as unknown as` casts, and the logger passed in has only info/warn/error.
- menuActions.ts ends in `default: break` while menu.ts sends newChannel/addContact/disconnect, so those three menu items do nothing.
- applyMessageState/appendMessagePath rebuild every conversation's array.
- sendMessage.ts handles only rejection of sendDmTextWithRetry, so a resolved `{ok:false}` is ignored.
- meshcore-ts exports `parseCompanionFrame`, which makes transport/companionFrame.ts redundant.

Almost all of the remaining work is mechanical extraction, deletion or consolidation that tsc and the existing vitest suites can check. Run `pnpm install` first: the stale electron/maplibre in node_modules produce 5 phantom tsc errors.

## Themes

- **Cross-process conventions with no shared owner**: Conversation and route keys, the sender sentinel encoding, hex/byte helpers, time-unit constants and relative-age formatters, log-level tables, GPS fix and haversine, pubkey abbreviation, contact-kind lists, clamp/bounds and PathHashSize narrowing each lack one module that owns them. Main and renderer re-implement them by hand, and the copies have drifted (case handling, thresholds, wording, Earth radius). The fix is a set of small src/shared modules (conversationKey, sender, hex, time, logLevels, geo, pubkey, math), then mechanical adoption.

- **Untyped and unvalidated process boundaries**: Data crossing a boundary is cast to its expected type rather than declared or checked: HTTP request bodies, an HTTP contract restated on client and server (already drifted), an untyped EventEmitter bus whose BusEvents map is never used (event lists restated 6x), settings JSON, SQLite rows (about 30 double-casts), WS frames without an exhaustiveness check, IPC channel strings, and the MacroContext double-casts.

- **Inconsistent error handling**: About 150 `(err as Error).message` casts while a safe helper sits private in ErrorFallback, and about 70 hand-written notify.error toasts. Routes.ts has about 20 copy-pasted catch→503 blocks and no app.onError, so a throwing route returns a plain-text 500. The radio library reports failure three different ways. Some catches discard errors silently (useWebSocket, migrations, persistence). There are floating promises and no unhandled-rejection safety net, and CLI errors are classified by sniffing message text.

- **God modules and oversized functions**: Complexity is concentrated in a few hubs: api/routes.ts (1300 lines, about 80 handlers, domain logic inside handlers), main/index.ts (622 lines, 7 concerns), renderer lib/store.ts (1300 lines, about 130 members), shared/types.ts (1305 lines, with runtime logic and a cycle), LeftNav index.tsx, the MapClusters render closure, searchMessages (230 lines), the CliTab drain effect, and the StateHolder grab-bag.

- **Residue from the meshcore-ts migration**: The swap to @andyshinn/meshcore-ts left dead or duplicated code behind. The shadow protocol/errors.ts is the worst case, because it breaks instanceof checks. Also left over: the adminSession awaiter machinery, holder.upsertMessage, serial.ts, transport/companionFrame.ts (a byte-for-byte copy of the lib's parser), redefined protocol codes, the contactsSync event, the legacy RadioSettings/Identity panels, stale task-tag comments, and unused endpoints and store methods.

- **Duplicated logic in main and shared**: The main side has its own repeated logic: block-rule matching implemented twice with drifted semantics, block hints built in 3 places, the app↔lib AutoAddConfig mapping spread over 4 sites, atomic-JSON/transaction/timeout/serial-queue primitives copied per module, RawPacket construction duplicated, and the per-file settings load ritual.

- **Renderer copy-paste of behaviour and UI**: The same commands (advert, reconnect, disconnect, copy key) are implemented in palette, menu, quick-actions and shortcuts, and their guards and toast copy have drifted. ChannelView and DMView are about 80% identical. Settings rows hand-repeat their field binding. The packet breakdown is copy-pasted between rail and dialog. The busy/try/notify fetch logic is repeated across tabs. Confirm dialogs and popovers, segmented toggles, count tabs, empty states, the clipboard helper and the unread badges are each re-implemented.

- **Wide subscriptions and wasted work in a renderer with no memo boundaries**: Because the renderer has no React.memo boundaries, broad subscriptions and identity churn re-render large subtrees. applyMessageState and appendMessagePath rebuild every conversation array. RightRail subscribes to all of messagesByKey and the whole neighbours slice. CommandPalette rebuilds every item on each packet while closed. Wholesale `appSettings`/`neighbours` selectors appear in places. LeftNav re-renders the whole tree on each search keystroke. In main, the badge recompute runs uncoalesced on the hottest event.

- **React idioms: effects mirroring props, stale closures, prop drilling**: CliPrompt mirrors parent-owned state into a reducer through sync effects. SetPathEditor and PacketDetailsRail reset state in effects where a key would do. The CliTab drain effect reads a stale closure. Composer's pseudo-updater has side effects. Refs are written during render. The studio bridge effect re-opens the rail on every mode toggle. ApiClient is prop-drilled through 60-80 files, and MessageList has a 16-prop pass-through API.

- **Layering and module boundaries**: Import direction is inverted in several places. shared/types.ts imports from the renderer. renderer/lib (the base layer) imports from features, panels, shell and components. There is a runtime import cycle protocol → state/advertPath → protocol. panels/macros hosts modules used by composer, quick bar and store. Transport state is updated as a side effect of the WS server. Nothing enforces the boundaries, and some files are misplaced (storage/paths.ts, clipboard in ContextMenu, settings sections in components/).

- **Real defects found along the way**: These are behaviour bugs the review turned up, though it was not hunting for them. They should be fixed with a regression test each, separately from the refactors.

- **Test infrastructure stayed thin as the suite grew**: tests/support is too thin for the suite's size. Wire-frame builders, route harnesses, session/server lifecycle, domain fixtures, bus capture and notify mocks are copied file by file, and the copies have drifted. Store resets are done slice by slice. There are real-time sleeps. Several pure modules (bridge drain, map clustering/spiderfy, useSectionDraft) have no tests.

- **Tooling and config hygiene**: CI runs unit and integration twice. Lint warnings never fail. tsconfig mixes Node and DOM, misses the Vite configs and keeps allowJs. Cheap strict flags (noImplicitReturns, noImplicitOverride) are not enabled. Packaging ships Vite-bundled deps a second time in app.asar. Node, @types/node and pnpm versions drift. There are stale scripts and workspace entries, and vitest config resolve blocks are duplicated.

## Deferred batches

### D1 CI/lint guards and packaging (needs user approval)

**Goal:** Ratchet lint warnings, de-duplicate the CI test runs, enforce process boundaries via Biome noRestrictedImports/noImportCycles/noConsole, trim app.asar dependencies, and align the toolchain versions.

**Why deferred:** The user has said they dislike bespoke guards and wants to verify build wiring themselves (memory). Packaging changes need a packaged-app launch, and CI changes need the user's sign-off. Propose these rather than implement them.

#### `x-tooling/ci-double-test-run`: CI runs the unit and integration suites twice, and the dom suite only under coverage

- **Severity:** medium · **Effort:** S · **Fix risk:** low
- **Locations (as of 93e7b27):** `.github/workflows/ci.yml:42-44`, `package.json:23`, `vitest.config.ts:19-67`
- **Recommendation:** Replace the three steps with one `pnpm test:coverage`. If separate failure signals per project are useful, keep the per-project steps and add `pnpm test:dom`, but drop the full coverage re-run, or run coverage only on main.

#### `x-tooling/lint-warnings-never-fail`: Biome warnings never fail CI; ratchet the zero-warning baseline

- **Severity:** low · **Effort:** S · **Fix risk:** low
- **Locations (as of 93e7b27):** `biome.json:24-34`, `package.json:15`, `.github/workflows/ci.yml:41`
- **Recommendation:** Change the lint script to `biome check --error-on-warnings`, or promote those four rules to "error", so the clean baseline can't regress. This is free today because there are 0 warnings.

#### `x-tooling/asar-ships-bundled-deps`: Packaging keeps all of /node_modules, so Vite-bundled renderer/main deps are shipped twice in app.asar

- **Severity:** medium · **Effort:** M · **Fix risk:** medium
- **Locations (as of 93e7b27):** `forge.config.ts:71-80`, `package.json:83-122`, `vite.main.config.mts:16-27`
- **Recommendation:** Keep only the runtime-required externals in `dependencies`: @stoprocent/noble (which pulls serialport and usb transitively), ws, and electron-squirrel-startup. Keep macos-alias optional. Move every Vite-bundled package (react*, radix-ui, maplibre-gl, lucide-react, hono, @hono/node-server, tslog, liquidjs, zustand, emojibase-data, tw-animate-css, @andyshinn/meshcore-ts, @andyshinn/hostname-sources, bonjour-service, etc.) to devDependencies. Alternatively, replace the blanket `/node_modules` allow in `ignore` with an allowlist derived from the externals' dependency closure. Verify with `npx @electron/asar list` on a fresh `pnpm package` and a manual launch of the packaged app, which the user does themselves.

#### `x-tooling/toolchain-version-drift`: Node, @types/node and pnpm versions disagree across mise, CI, Electron and package.json

- **Severity:** medium · **Effort:** S · **Fix risk:** low
- **Locations (as of 93e7b27):** `mise.toml:2`, `.github/workflows/ci.yml:19-24`, `package.json:61`, `vite.main.config.mts:14-15`
- **Recommendation:** Align on Electron's Node major: `@types/node` ^24 and mise `node = "24"`, or document why tests must run on 26. Add `"packageManager": "pnpm@11.10.0"` so local and CI pnpm match, and point CI at it via `pnpm/action-setup` with no version input. Run `pnpm install` locally to clear the phantom tsc errors.

#### `x-tooling/pnpm-workspace-stale`: pnpm-workspace.yaml allow-lists packages that no longer exist in the lockfile; devDeps nan and @electron/rebuild are unexplained

- **Severity:** low · **Effort:** S · **Fix risk:** low
- **Locations (as of 93e7b27):** `pnpm-workspace.yaml:2`, `pnpm-workspace.yaml:8-9`, `pnpm-workspace.yaml:15`, `pnpm-workspace.yaml:18`, `pnpm-workspace.yaml:22`, `package.json:54`, `package.json:72`
- **Recommendation:** Remove the six stale workspace entries; pnpm will warn if any comes back. Check whether `nan` and `@electron/rebuild` can be dropped (`pnpm make:mac` in CI is the test). If they must stay, record why in RELEASING.md, since package.json can't carry comments.

#### `x-tooling/cheap-lint-rules`: Cheap Biome rules that catch real issues in this code today

- **Severity:** low · **Effort:** S · **Fix risk:** low
- **Locations (as of 93e7b27):** `src/main/index.ts:563`, `src/main/index.ts:21`, `src/main/index.ts:120`, `src/main/api/middleware/auth.ts:37-38`, `src/main/logging/fileSink.ts:60`, `src/renderer/shell/leftnav/ChannelContextMenu.tsx:42`, `src/renderer/components/ContextMenu.tsx:154-160`
- **Recommendation:** Route index.ts:21 and :120 console.error through `log`. Delete the eslint-disable comment. Enable suspicious/noConsole (warn), with biome-ignore plus a reason in fileSink.ts and auth.ts. Optionally add `.catch(err => log.error(...))` before `.finally` at index.ts:563. Skip enabling the nursery promise rules until they stabilise.

### D2 routes split, request validation and shared API contract

**Goal:** Split routes.ts into per-domain register* modules with a services object, move domain logic into services, add boundary validation for persisting endpoints, and add src/shared API contract types.

**Why deferred:** Run after B2. Split one domain per commit, with the integration API tests as the guard. Validation changes behaviour for malformed input, and choosing a validation library (zod vs hand guards) is a user decision. Deleting unused endpoints depends on whether the HTTP API is a public surface. The three-failure-conventions fix belongs in meshcore-ts (user-owned).

#### `main-api/routes-god-file`: routes.ts is a 1300-line single closure registering ~80 handlers across 12 resources

- **Severity:** medium · **Effort:** M · **Fix risk:** low
- **Locations (as of 93e7b27):** `src/main/api/routes.ts:96-1302`, `src/main/api/routes.ts:51-88`, `src/main/api/routes.ts:101-103`, `src/main/api/tiles.ts:151`
- **Recommendation:** Split into `src/main/api/routes/{state,settings,device,channels,contacts,messages,repeater,transport,macros,blocks,app}.ts`. Each file exports `registerXRoutes(api: Hono, deps: RoutesDeps)` (or returns a sub-`Hono` mounted with `api.route('/api/contacts', ...)`), and `createRoutes` becomes a short composition root. Move `mirrorOutPath` into `src/main/state/contactSync.ts` (next to `scheduleDiscoveredEmit`) or onto `discoveredStore`. Move the tile-cache cap application into bootstrap (`src/main/index.ts`) next to `startServer`.

#### `main-api/fat-handlers-domain-logic`: Device-protocol orchestration and business logic live inside route handlers

- **Severity:** medium · **Effort:** M · **Fix risk:** medium
- **Locations (as of 93e7b27):** `src/main/api/routes.ts:401-471`, `src/main/api/routes.ts:356-399`, `src/main/api/routes.ts:307-352`, `src/main/api/routes.ts:638-685`, `src/main/api/routes.ts:1257-1299`
- **Recommendation:** Move this logic into services the route calls in one line. Candidates: `src/main/device/deviceSettings.ts` (`applyAutoAddConfig`, `applyDeviceIdentity`, `applyRadioSettings`, returning a discriminated `{ status: 'ok' | 'rejected' | ... }` like `refreshContacts`/`fetchAdvertPath` already do), `src/main/channels/deviceSlots.ts` (push/remove-from-device), and `buildMacroContextForRequest(req, holder)` in `src/main/macros/contextBuilder.ts`. In macro render, check that the macro exists before building the context. The route then only maps the result status to an HTTP status, the same `switch (res.status)` pattern used at 736-746 and 810-844.

#### `x-types/http-bodies-unvalidated`: HTTP request bodies are cast to domain types, not validated, then persisted and broadcast

- **Severity:** high · **Effort:** L · **Fix risk:** medium
- **Locations (as of 93e7b27):** `src/main/api/routes.ts:171-188`, `src/main/api/routes.ts:242-257`, `src/main/api/routes.ts:307-352`, `src/main/api/routes.ts:475-503`, `src/main/api/routes.ts:532-548`, `src/main/api/routes.ts:602-610`, `src/main/api/routes.ts:688-696`, `src/main/api/routes.ts:1040-1047`
- **Recommendation:** As proposed. Build the parsers in src/shared so the settings loader (settings-readjson-type-lie) can reuse them. For the setAppSettings case specifically, validate before any set*/emit* call.

#### `main-api/api-contract-duplicated-drifted`: The HTTP contract is typed twice (server inline casts vs renderer api.ts generics) and has already drifted

- **Severity:** low · **Effort:** M · **Fix risk:** low
- **Locations (as of 93e7b27):** `src/main/api/routes.ts:945-957`, `src/renderer/lib/api.ts:317-321`, `src/main/api/routes.ts:262-270`, `src/main/api/routes.ts:1203-1209`, `src/main/api/routes.ts:1231-1237`, `src/main/api/routes.ts:1258-1266`, `src/main/api/routes.ts:759`, `src/main/api/routes.ts:818`, `src/main/api/routes.ts:1096-1098`
- **Recommendation:** Create `src/shared/api.ts` to hold request and response types per endpoint (for example `AdvertPathResponse`, `MacroRenderRequest`, `NewBlockRule = Omit<BlockRule, ...>`) and an `ApiErrorCode` string union with one casing convention. Have routes.ts annotate `c.json<...>()` with them and have renderer api.ts reuse them. Fix the `1 | 2 | 4` typo by switching to `PathHashSize`. Hono's typed RPC (`hc<AppType>`) is an option, but because the renderer must not pull main-process modules, a shared types file is the safer boundary.

#### `main-api/set-emit-pairing-inconsistent`: Who emits after a state write is inconsistent: some holder mutators emit, most expect the caller to

- **Severity:** low · **Effort:** M · **Fix risk:** medium
- **Locations (as of 93e7b27):** `src/main/api/routes.ts:182-183`, `src/main/api/routes.ts:253-254`, `src/main/api/routes.ts:349-350`, `src/main/api/routes.ts:366-367`, `src/main/api/routes.ts:426-427`, `src/main/api/routes.ts:479-480`, `src/main/api/routes.ts:496-497`, `src/main/api/routes.ts:544-546`, `src/main/api/routes.ts:554-584`, `src/main/api/tiles.ts:142-149`, `src/main/state/holder.ts:480-491`
- **Recommendation:** Add a small `commit` module in src/main/state, e.g. commit.appSettings(v) = holder.setAppSettings(v) + emit.appSettings(v), only for the plain set-and-broadcast slices (appSettings, radioSettings, mapSettings, uiState, deviceIdentity, autoAddConfig, telemetryPolicy, gpsConfig, owner, deviceInfo, deviceCapabilities). Use it from routes.ts and adapterEvents.ts. Leave the coalesced contacts/discovered paths and drafts alone. Extract `applyApiKeyPresence(hasKey)` for the two api-key handlers only, and leave markKeyRejected as it is.

#### `main-api/unused-endpoints`: Several endpoints and client wrappers have no in-repo consumer

- **Severity:** low · **Effort:** S · **Fix risk:** low
- **Locations (as of 93e7b27):** `src/main/api/routes.ts:945-957`, `src/main/api/routes.ts:964`, `src/main/api/routes.ts:687`, `src/main/api/routes.ts:716-719`, `src/main/api/routes.ts:120-130`, `src/main/api/routes.ts:1102-1146`, `src/renderer/lib/api.ts:317`
- **Recommendation:** Decide whether the HTTP API is a public surface for external browser clients (CORS and bindAll suggest it might be). If it is, document these endpoints and cover them with route tests. If not, delete the unused routes and wrappers, starting with the duplicate `/api/radio/path-hash-mode` and its mistyped client.

#### `main-api/handrolled-static-serving`: server.ts hand-rolls static file serving: MIME table, full-file reads, and a prefix-only traversal check

- **Severity:** low · **Effort:** S · **Fix risk:** medium
- **Locations (as of 93e7b27):** `src/main/server.ts:114-135`, `src/main/server.ts:364-395`, `src/main/server.ts:105-112`, `src/main/server.ts:137`
- **Recommendation:** Use `serveStatic({ root })` from `@hono/node-server/serve-static`, which handles MIME types, traversal and streaming. Keep the custom SPA fallback as a final `app.get('*', c => c.html(indexHtml))` for extensionless paths. If the hand-rolled version stays, check with `path.relative(root, filePath)` (rejecting results that start with '..' or are absolute) or `startsWith(root + sep)`. Declare `boundPort` before `createRoutes` is called.

#### `main-state-protocol-bridge/autoadd-mapping-scattered`: App↔library AutoAddConfig mapping (field copy + mode/bit-0 conversion) is spread across 4 sites

- **Severity:** medium · **Effort:** M · **Fix risk:** medium
- **Locations (as of 93e7b27):** `src/main/protocol/sessionAdapter.ts:78-91`, `src/main/protocol/sessionAdapter.ts:122-132`, `src/main/protocol/adapterEvents.ts:79-97`, `src/main/api/routes.ts:421`, `src/main/api/routes.ts:449-457`
- **Recommendation:** Create src/main/protocol/autoAddMapping.ts with pure functions: `modeFromManualAdd(byte)`, `withModeBit(byte, mode)`, `toLibAutoAdd(app): Models.AutoAddConfig` and `fromLibAutoAdd(lib, prevApp): AutoAddConfig` (which preserves autoRefreshContacts/showPublicKeys). Type the mirror flags as `Omit<Models.AutoAddConfig, 'manualAddContacts' | 'maxHops'>`. Unit-test the round trip, which is the whole regression surface the long comments describe.

#### `x-errors-async/three-radio-failure-conventions`: Radio commands report failure three different ways and SessionAdapter passes them through unchanged

- **Severity:** low · **Effort:** L · **Fix risk:** medium
- **Locations (as of 93e7b27):** `src/main/protocol/sessionAdapter.ts:140-345`, `src/main/api/routes.ts:328-336`, `src/main/api/routes.ts:372-393`, `src/main/api/routes.ts:442-467`, `src/main/api/routes.ts:499-500`, `src/main/api/routes.ts:523-524`, `src/main/api/routes.ts:649-650`, `src/main/api/routes.ts:982-991`, `src/main/api/routes.ts:1150-1151`
- **Recommendation:** Fix this in meshcore-ts, which the user owns: make the boolean-returning setters report the failure reason, either by throwing a typed error or by returning {ok, error} like the others. Keep SessionAdapter as the documented thin pass-through. Until then, in coresense, use one small route helper per convention so routes do not hand-write a generic 'rejected' message each time.

#### `renderer-panels-repeater-admin/cli-error-message-sniffing`: CLI failure kinds are classified by sniffing library error text, half in main and half in the renderer; the timeout constant is duplicated

- **Severity:** low · **Effort:** S · **Fix risk:** low
- **Locations (as of 93e7b27):** `src/renderer/panels/repeater-admin/cli/lib/send.ts:25-35`, `src/main/api/routes.ts:1086-1098`, `src/renderer/panels/repeater-admin/CliTab.tsx:25`
- **Recommendation:** Classify once, in the route. Emit `code: 'cli_superseded'` alongside 'cli_timeout'/'transport' (and since the user owns meshcore-ts, ideally have the lib throw typed errors or export the messages/constants). Then make settlePatchForError switch on `err instanceof ApiError ? err.code : null` only. Source the timeout label from the server's error payload or a shared constant.

#### `renderer-core/api-client-boilerplate`: api.ts repeats method/body/encodeURIComponent plumbing for ~70 endpoints; one method uses an inline import type

- **Severity:** low · **Effort:** M · **Fix risk:** low
- **Locations (as of 93e7b27):** `src/renderer/lib/api.ts:101-402`, `src/renderer/lib/api.ts:220`, `src/renderer/lib/api.ts:75-93`, `src/renderer/lib/api.ts:95-99`
- **Recommendation:** Add thin verb helpers (`get<T>(c, path)`, `post<T>(c, path, body?)`, `put`, `del`) and a tagged-template path builder that encodes interpolations (`path`/api/repeater/${key}/status``). Express the repeater group as `repeaterPost(c, key, 'status')`. Move `Channel` into the top import. Set Content-Type only when `init.body` is present. Optionally group endpoints by domain (`api.repeater.status`) while keeping the flat `api` object for vi.mock compatibility.

### D3 renderer architecture: ApiClient context, store slices, typed keys

**Goal:** Provide ApiClient through context (leaf-first migration), split the zustand store into slices, tighten Contact/Channel/activeKey to template-literal key types, and fix lib/ layering inversions.

**Why deferred:** Large, cross-cutting churn that would conflict with every renderer batch. Do it after B6-B13 land, as a sequence of small commits. Key-type tightening cascades into DB rows and fixtures.

#### `renderer-core/apiclient-prop-drilling`: ApiClient is passed as a prop through ~74 components instead of being provided once

- **Severity:** medium · **Effort:** L · **Fix risk:** low
- **Locations (as of 93e7b27):** `src/renderer/App.tsx:149`, `src/renderer/App.tsx:263-283`, `src/renderer/app/menuActions.ts:10-18`, `src/renderer/app/menuActions.ts:71`, `src/renderer/app/menuActions.ts:83`, `src/renderer/app/menuActions.ts:101`, `src/renderer/app/menuActions.ts:109`
- **Recommendation:** Add `ApiClientContext` plus a `useApiClient(): ApiClient | null` hook (e.g. in `src/renderer/lib/apiClientContext.tsx`) and provide it once in App. Non-React modules (menuActions, wsHandlers, notify-style helpers) can read the client from a tiny module-level holder or a `client` field in the store set by App. Change `MenuActionHandlerDeps` to `{ client: ApiClient | null }`. Migrate leaf consumers gradually; intermediate props can then be removed mechanically.

#### `renderer-core/store-monolith`: store.ts is a 1.3k-line god-store: one CoreState interface with ~130 members across unrelated concerns

- **Severity:** medium · **Effort:** L · **Fix risk:** medium
- **Locations (as of 93e7b27):** `src/renderer/lib/store.ts:280-588`, `src/renderer/lib/store.ts:636-1238`, `src/renderer/lib/store.ts:156-278`, `src/renderer/lib/store.ts:261-278`
- **Recommendation:** Do it in stages. (1) Move the sectionHandles registry to src/renderer/panels/settings/sectionHandles.ts; the existing comment already says it is deliberately outside the store. (2) Move the feature types (Cm*, RepeaterAdminTab, SettingsTab, SettingsPendingTarget, SearchFilters, LivePacket, PacketLogView, NeighboursViewState) to a store/types.ts or per-domain type modules. (3) Only then consider zustand slices, and keep the cross-cutting navigation and Settings-guard actions together in one nav slice that is allowed to write settingsUi. Treat step 3 as non-mechanical: it needs a test pass over the nav and unsaved-guard behaviour.

#### `x-types/stringly-typed-keys`: Conversation and tool keys are plain strings parsed by hand in dozens of places

- **Severity:** medium · **Effort:** M · **Fix risk:** low
- **Locations (as of 93e7b27):** `src/shared/types.ts:83`, `src/shared/types.ts:107`, `src/shared/types.ts:892`, `src/main/api/routes.ts:73`, `src/main/api/routes.ts:699`, `src/main/api/routes.ts:752`, `src/main/api/routes.ts:768`, `src/main/api/routes.ts:780`, `src/main/protocol/sessionAdapter.ts:309`, `src/main/state/contactSync.ts:131`, `src/main/state/advertPath.ts:94`, `src/renderer/shell/MainPane.tsx:54-94`, `src/renderer/shell/rightrail/helpers.ts:8-19`
- **Recommendation:** Add src/shared/keys.ts with `type ChannelKey = `ch:${string}``, `type ContactKey = `c:${string}``, `type ConversationKey = ChannelKey | ContactKey`, `type ToolKey = 'tool:search' | 'tool:packetlog' | ... | `tool:settings:${string}``, and helpers `contactKey(pk)`, `pubkeyOf(keyOrPubkey)`, `isChannelKey`, `isContactKey`, `isToolKey`. Retype Channel.key, Contact.key, UiState.activeKey and the ToolEntry/ToolItem keys. Replace the 9 hand-written slice copies first (mechanical), then tighten the types gradually; the compiler will find the remaining literals.

#### `renderer-core/lib-layering-inversions`: lib/ imports upward from features/panels/components/shell/hooks, and panels import feature types back from the store

- **Severity:** low · **Effort:** M · **Fix risk:** low
- **Locations (as of 93e7b27):** `src/renderer/lib/store.ts:60-61`, `src/renderer/lib/packetPath.ts:9-11`, `src/renderer/lib/shortcut-dispatch.ts:2`, `src/renderer/lib/shortcut-selectors.ts:3`, `src/renderer/lib/contactManagerView.ts:2`, `src/renderer/lib/useChannelKeyStore.ts:1-15`
- **Recommendation:** Treat lib/ (and shared/) as the bottom layer. Move these pure helpers down: `recordUsage`/`score` into `lib/frecency.ts`, `splitHopsHex` into `lib/packetPath.ts` or a `lib/hex.ts`, `computeUnreadConversations`/`computeUnreadByKey`/`isUnread` into `lib/unreads.ts` (hooks/useUnreads.ts keeps only the hooks), and `sortChannels` into `lib/sortByPinned.ts`. Move the Cm*/RepeaterAdminTab/SettingsTab/SearchFilters types into domain type modules that store.ts imports. Move useChannelKeyStore.ts to hooks/. Optionally enforce this with Biome's `noRestrictedImports` for `src/renderer/lib/**`.

#### `renderer-panels-macros/panel-hosts-cross-feature-modules`: Modules used across features live inside panels/macros (store, composer, quick bar and right rail import from it)

- **Severity:** medium · **Effort:** M · **Fix risk:** low
- **Locations (as of 93e7b27):** `src/renderer/lib/store.ts:61`, `src/renderer/components/Composer.tsx:12`, `src/renderer/features/message-actions/MessageQuickBar.tsx:11`, `src/renderer/features/message-actions/MacroPanel.tsx:10-11`, `src/renderer/shell/rightrail/MacroReferenceRail.tsx:2`, `src/renderer/panels/macros/lib/inchat.ts`, `src/renderer/panels/macros/lib/useReplyPreviews.ts`, `src/renderer/panels/macros/components/chips.tsx`
- **Recommendation:** Move the reusable pieces to `src/renderer/features/macros/` (or `src/renderer/lib/macros/`): inchat.ts, useReplyPreviews.ts, ComposerMacroPopover, Snippet/ModeChip/ScopeTag, catalog/tokenize/tokenColors/macroMode. Keep `panels/macros` for MacrosPanel, MacroLibrary, MacroRow and the studio. Moving `applicableMacros` (features/message-actions/macroPicks.ts) next to `filterMacros` would put all macro-selection logic in one place. Do the move as import-path-only changes, verified by tsc and the tests.

#### `renderer-core/snapshot-types-lie`: Wire types claim fields are required, but hydrate/applyUiState defensively coalesce them, so the fallbacks are typed as unreachable

- **Severity:** low · **Effort:** M · **Fix risk:** low
- **Locations (as of 93e7b27):** `src/renderer/lib/store.ts:714-745`, `src/renderer/lib/store.ts:930-937`, `src/renderer/lib/store.ts:1273`, `src/renderer/lib/store.ts:735`, `src/renderer/lib/store.ts:915`, `src/shared/types.ts:992-1030`
- **Recommendation:** Type only the true external boundary honestly. Make the uiState WS payload (and the PUT body) `Partial<UiState>`-ish for the usage maps and packetLog, so the existing `??` coalescing is type-justified. For the snapshot, either mark the specific dev-skew fields optional in StateSnapshot or drop the fallbacks; don't introduce DeepPartial. Make applyMapSettings merge over DEFAULT_MAP_SETTINGS like hydrate does.

#### `shared/types-ts-grab-bag`: types.ts (1305 lines) mixes wire protocol, domain, persisted settings plus defaults, UI state, repeater admin, map, search, logging, runtime logic and a circular import

- **Severity:** medium · **Effort:** M · **Fix risk:** low
- **Locations (as of 93e7b27):** `src/shared/types.ts:1-5`, `src/shared/types.ts:155-169`, `src/shared/types.ts:427-579`, `src/shared/types.ts:891-990`, `src/shared/types.ts:1066-1195`, `src/shared/types.ts:1197-1244`, `src/shared/contacts/discovered.ts:1`
- **Recommendation:** Convert this into a src/shared/types/ directory with an index.ts barrel, so every existing `shared/types` import keeps working. Suggested modules: domain.ts (Channel, Contact, Message*, Owner, ContactKind, PathHashSize), settings.ts (AppSettings/MapSettings/RadioSettings and device configs plus their DEFAULT_*), ui.ts (UiState, LogsFilter, LeftNavGroupId, DEFAULT_UI_STATE), repeater.ts, search.ts, map.ts (Tile*), ws.ts (WsMessage, StateSnapshot, MenuAction, ServerStatus), and platform.ts (Capabilities, CoreSenseBridge). Move DiscoveredContact into domain.ts to break the cycle. Move hasValidFix into shared/geo.ts (see the geo finding). This is a pure move; tsc verifies it.

### D4 behavioural refactors and remaining bug fixes needing judgement

**Goal:** Unify block-rule matchers, extract shared radio commands, merge ChannelView/DMView, rework CliPrompt state ownership and the CliTab drain hook, fix the macros tokenizer grammar and composer scope, restructure MapClusters and fix marker staleness, add a quit coordinator, and break the protocol↔state cycle.

**Why deferred:** Each item either changes behaviour or semantics (block-rule case policy, composer macro scope, tokenizer grammar), needs a product decision (macOS no-window behaviour, SetPathEditor edit-vs-external-change semantics, CLI note copy, light-mode token colours), or needs manual app verification (quit/relaunch, BLE teardown, maps). Do them one at a time after the mechanical batches merge.

#### `x-dry/block-rule-matching-twice`: Block-rule matching is implemented twice with divergent semantics, and block hints are built in three places

- **Severity:** medium · **Effort:** M · **Fix risk:** medium
- **Locations (as of 93e7b27):** `src/shared/contacts/discovered.ts:213-237`, `src/shared/blocking/match.ts:43-74`, `src/shared/blocking/match.ts:101-107`, `src/main/state/holder.ts:306-312`, `src/main/notifications/index.ts:20-33`, `src/main/storage/search.ts:279-294`
- **Recommendation:** Move the per-identity predicate into shared/blocking/match.ts as `identityMatchesRule({pk, name}, rule, regex)`. Have ruleMatches call it after resolving the message's identity, and replace contactMatchesAnyBlockRule with it, passing the compiled regex cache. Export `blockHintsFor(msg, contacts)` from the same module and use it in holder.ts, notifications/index.ts and search.ts.

#### `renderer-features/no-shared-command-registry`: Four parallel implementations of the same app commands, with drifted guards and toast copy

- **Severity:** medium · **Effort:** L · **Fix risk:** medium
- **Locations (as of 93e7b27):** `src/renderer/features/command-palette/items/actions.ts:65-418`, `src/renderer/features/quick-actions/catalog.tsx:35-134`, `src/renderer/app/menuActions.ts:76-114`, `src/renderer/lib/shortcut-dispatch.ts:8-39`
- **Recommendation:** Don't build a full registry yet. Extract the overlapping radio side effects into plain functions in src/renderer/lib/radioCommands.ts: sendAdvert(client, flood), reconnectLastDevice(client), disconnect(client), toggleRepeat(client), copyPublicKey(hex). Each owns its guard (transportState idle/error, lastDevice present) and one canonical success/failure toast. Call them from palette actions.ts, menuActions.ts and quick-actions/catalog.tsx, and keep each surface's own metadata (label, confirm, visibility) where it is. Effort M, low risk. Revisit a registry only if more surfaces appear.

#### `renderer-panels-settings-etc/conversation-view-duplication`: ChannelView and DMView are near-identical copies (store wiring, history fetch, send, composer/message-list plumbing)

- **Severity:** medium · **Effort:** M · **Fix risk:** medium
- **Locations (as of 93e7b27):** `src/renderer/panels/ChannelView.tsx:28-98`, `src/renderer/panels/ChannelView.tsx:141-177`, `src/renderer/panels/DMView.tsx:30-94`, `src/renderer/panels/DMView.tsx:111-141`, `src/renderer/panels/ChannelView.tsx:12-21`, `src/renderer/panels/DMView.tsx:14-23`
- **Recommendation:** Extract a `useConversation(key, client)` hook into `src/renderer/hooks/` (selectors, history fetch, jump backfill, onSend, composer ref and its handlers, onSelectMessage). Add a `<ConversationBody conversationKey client composerDisabled />` component that renders MessageList and Composer. ChannelView and DMView then keep only their headers and the channel 'not on device' banner. Import CHANNEL_ICON/CONTACT_ICON from `lib/conversationIcons`. Narrow the selectors to `s.appSettings.messageStyle` and `s.appSettings.composer`. Per the no-memo constraint, wholesale `appSettings` re-renders the whole conversation on any settings save.

#### `renderer-panels-repeater-admin/prompt-state-mirrors-parent`: CliPrompt mirrors parent-owned history/ctx into reducer state via sync effects; leaves dead reducer actions and a stale design comment

- **Severity:** high · **Effort:** M · **Fix risk:** medium
- **Locations (as of 93e7b27):** `src/renderer/panels/repeater-admin/cli/CliPrompt.tsx:59-97`, `src/renderer/panels/repeater-admin/cli/lib/promptReducer.ts:1-8`, `src/renderer/panels/repeater-admin/cli/lib/promptReducer.ts:15-28`, `src/renderer/panels/repeater-admin/cli/lib/promptReducer.ts:48-52`, `src/renderer/panels/repeater-admin/cli/lib/promptReducer.ts:317-330`, `src/renderer/panels/repeater-admin/cli/lib/persistence.ts:99-103`, `src/renderer/panels/repeater-admin/CliTab.tsx:35-37`, `src/renderer/panels/repeater-admin/CliTab.tsx:164`
- **Recommendation:** Make the parent the single owner. Remove `history` and `ctx` from CliPromptState and pass them as a read-only third argument: `cliPromptReducer(s, a, env: { history, ctx })`. Do the same for paletteItems/ghostSuffix/rsearchView/isPaletteOpen. Delete the history/loaded, history/push, history/patchStatus, ctx/setNodeValue and ctx/setRecent actions, plus patchLastStatus and its tests. For the follow-up prefill, expose `setLine(text)` through a ref/imperative handle, or lift the prompt state into CliTab, instead of the nonce prop + effect. Update the header comment.

#### `renderer-panels-repeater-admin/cli-drain-effect-god-block`: CliTab drain effect bundles send/settle/history/node-value/reboot logic in an async IIFE, reads a stale `pending` closure, and casts instead of using historyStatusFor

- **Severity:** medium · **Effort:** M · **Fix risk:** medium
- **Locations (as of 93e7b27):** `src/renderer/panels/repeater-admin/CliTab.tsx:96-142`, `src/renderer/panels/repeater-admin/CliTab.tsx:114`, `src/renderer/panels/repeater-admin/CliTab.tsx:119`, `src/renderer/panels/repeater-admin/CliTab.tsx:126-132`, `src/renderer/panels/repeater-admin/CliTab.tsx:137`, `src/renderer/panels/repeater-admin/cli/lib/queue.ts:68-80`, `src/renderer/panels/repeater-admin/index.tsx:69-75`
- **Recommendation:** Extract a `useCliQueue({ client, contactKey, onSettled })` hook (cli/useCliQueue.ts) that owns queue state, sendingRef, abortRef and the unmount abort. Move the post-settle consequences into a pure, unit-testable `settleConsequences(entry, patch): { historyStatus, nodeValue?: [key, value], arm?: CliCommand, rebootSent?: boolean }`. Change `onPending` to updater form, `(fn: (prev) => RebootPendingState) => void`, so `armReboot` and `markRebootSent` apply to the latest state. Replace the two `as CliHistoryEntry['status']` casts with `historyStatusFor({ ...next, ...patch })`.

#### `renderer-panels-macros/tokenizer-grammar-drift`: Tokenizer paints valid LiquidJS as errors (whitespace control, bracket access, keyword args, comment/raw bodies)

- **Severity:** medium · **Effort:** M · **Fix risk:** medium
- **Locations (as of 93e7b27):** `src/renderer/panels/macros/lib/tokenize.ts:82-133`, `src/renderer/panels/macros/lib/tokenize.ts:140-178`, `src/renderer/panels/macros/lib/tokenize.ts:187-221`, `src/renderer/panels/macros/lib/tokenize.ts:1-21`
- **Recommendation:** Bring the lexer closer to Liquid's grammar. Strip the leading and trailing `-` trim markers in scan() before parseTag/lex. Accept `[...]` index segments in identifiers. In parseTag, allow `ident:` keyword arguments after the positional args. Treat the bodies of `{% comment %}…{% endcomment %}` and `{% raw %}…{% endraw %}` as text. Add each probe case above to tokenize.test.ts with the assertion "no 'error' runs when validateTemplate(t).ok". Fix the stale 132-character justification in both comments.

#### `renderer-panels-macros/composer-ignores-scope`: Composer slash-popover ignores macro scope, unlike the quick bar's applicableMacros

- **Severity:** medium · **Effort:** S · **Fix risk:** low
- **Locations (as of 93e7b27):** `src/renderer/panels/macros/inchat/ComposerMacroPopover.tsx:34-35`, `src/renderer/features/message-actions/macroPicks.ts:8-11`, `src/renderer/panels/macros/lib/filterMacros.ts:7-14`
- **Recommendation:** Build the composer list as `filterMacros(targetKey ? applicableMacros(macros, targetKey) : macros, query, 'all')`, and consider excluding or demoting reply-mode macros there. Moving `applicableMacros` next to `filterMacros` (see the module-boundary finding) gives one place for selection rules. Add a ComposerMacroPopover test for a scoped macro on another conversation.

#### `renderer-maps/mapclusters-render-closure`: MapClusters is a 230-line imperative closure whose site and cluster branches hand-roll upserts and bypass the helpers

- **Severity:** medium · **Effort:** M · **Fix risk:** medium
- **Locations (as of 93e7b27):** `src/renderer/components/map/MapClusters.tsx:91-325`, `src/renderer/components/map/MapClusters.tsx:127-150`, `src/renderer/components/map/MapClusters.tsx:236-266`, `src/renderer/components/map/cluster/upsertDomMarker.ts:16-31`, `src/renderer/components/map/MapClusters.tsx:54-67`, `src/renderer/components/map/MapClusters.tsx:96-107`
- **Recommendation:** Move the render body into a pure-ish module function, e.g. `renderClusterMarkers(map, registry, {groupedItems, index, selection, settings, handlers})` in components/map/cluster/renderMarkers.ts, with the spiderfy pass as its own `renderSpiderfy(...)`. Add `anchor` and `onCreate(el)` (to attach listeners) options to upsertDomMarker, then route the site and cluster markers through it. Extract `isStale(c, now, lastHeardHours)` / `lastHeardCutoffMs(settings)` once, for example next to markerSignature or in lib/map, and use it in both the filter memo and contactState. The component then only wires effects.

#### `renderer-maps/cluster-site-marker-staleness`: Cached cluster and site markers keep stale closures, aria-labels and contents (signature code does nothing)

- **Severity:** low · **Effort:** S · **Fix risk:** low
- **Locations (as of 93e7b27):** `src/renderer/components/map/MapClusters.tsx:242-263`, `src/renderer/components/map/MapClusters.tsx:131-139`, `src/renderer/components/map/MapClusters.tsx:141`, `src/renderer/components/map/markers/CoLocatedSite.tsx:8-12`
- **Recommendation:** Keep the click handler's dynamic inputs on the element or in a lookup instead of the closure. For example, read `el.dataset.clusterId` plus a ref to the current index and current lngLat (`marker.getLngLat()`) at click time. When the signature changes, update `aria-label` too, using a `syncClusterMarker(el, breakdown, total)` helper in clusterDonut.ts so a whole element isn't built. For sites, put member kinds and names in the signature (e.g. reuse markerSignature per member) and rebuild `innerHTML`/aria-label on change through a `syncCoLocatedSiteMarker` helper. Remove the unused `selected` parameter.

#### `renderer-maps/overlay-plumbing-duplication`: Each map overlay re-implements the same maplibre plumbing (layer install, latest-ref render, marker diffing, empty-click, teardown)

- **Severity:** medium · **Effort:** M · **Fix risk:** medium
- **Locations (as of 93e7b27):** `src/renderer/components/map/MapClusters.tsx:353-399`, `src/renderer/components/map/NeighbourMapLayer.tsx:166-200`, `src/renderer/components/map/MapClusters.tsx:318-325`, `src/renderer/components/map/NeighbourMapLayer.tsx:120-147`, `src/renderer/components/map/MapClusters.tsx:435-455`, `src/renderer/components/map/NeighbourMapLayer.tsx:235-257`, `src/renderer/components/map/MapLocalNode.tsx:20-60`
- **Recommendation:** Extract `useGeoJsonLineLayer(map, sourceId, layerSpec, onInstalled)` into components/map/hooks/. It should keep the styledata retry but gate on `map.getStyle()` (the same readiness signal MapCanvas uses), or keep the try/catch and send unexpected errors to mapLog instead of swallowing them. Do not gate on isStyleLoaded(). Let NeighbourMapLayer reuse the existing upsertDomMarker/CachedMarker helpers, or a small shared `gcMarkers(cache, wanted)`, rather than adding a new registry class. A `useMapEvent(map, type, handler)` hook can cover the click wiring. Leave MapLocalNode as it is.

#### `main-app-shell/quit-state-redundant`: Quit and shutdown state is spread across redundant flags, duplicated defer logic, and macOS handlers that can never fire

- **Severity:** medium · **Effort:** M · **Fix risk:** medium
- **Locations (as of 93e7b27):** `src/main/index.ts:525-531`, `src/main/index.ts:398-407`, `src/main/index.ts:546-564`, `src/main/index.ts:533-544`, `src/main/window/quit.ts:6-14`
- **Recommendation:** Turn window/quit.ts into a small quit-coordinator module that owns the `confirmed` and `shutdownPromise` state and exposes `requestQuit(origin)` (emits requestQuit or calls app.quit) plus `isShuttingDown()`. Have the close handler simply `event.preventDefault(); app.quit()` and let before-quit do the deferral once. Decide explicitly whether macOS should keep running with no window. If not, delete the darwin branch in window-all-closed and the activate re-creation. If so, stop the close handler from quitting. Either way, gate `activate` on a `bootstrapped` promise.

#### `main-app-shell/index-god-module`: index.ts is a 622-line composition root mixing seven concerns around module-level mutable handles

- **Severity:** medium · **Effort:** M · **Fix risk:** medium
- **Locations (as of 93e7b27):** `src/main/index.ts:8-22`, `src/main/index.ts:98-102`, `src/main/index.ts:104-213`, `src/main/index.ts:215-262`, `src/main/index.ts:281-343`, `src/main/index.ts:345-496`, `src/main/index.ts:525-622`
- **Recommendation:** Split incrementally, starting with the pure extractions that tests can verify: buildCsp, buildContextMenuTemplate and resolveAppUrl/allowedOrigin. Then move shutdown and services behind a typed `Services` record. Keep app.on registrations in index.ts, so event wiring order stays visible in one place. Do not treat this as mechanical: the lifecycle and state moves need a manual quit and relaunch smoke test.

#### `x-architecture/protocol-state-cycle`: The protocol layer depends on state, storage and bridge, creating a runtime cycle protocol -> state -> protocol

- **Severity:** low · **Effort:** M · **Fix risk:** medium
- **Locations (as of 93e7b27):** `src/main/protocol/adapterEvents.ts:1-10`, `src/main/protocol/sessionAdapter.ts:2-4`, `src/main/protocol/sessionAdapter.ts:78-91`, `src/main/protocol/sessionAdapter.ts:302-327`, `src/main/state/advertPath.ts:2`, `src/main/state/contactRefresh.ts:2`
- **Recommendation:** Low priority. If done, move adapterEvents.ts/mergeChannels.ts to state/sessionIngest.ts and call wireSessionEvents from the composition root. Pass the AutoAddConfig seed into SessionAdapter.start(). Do this together with relocating adminSessions (see dead-code finding) so the repeaterLogin write-through lives in state/, not in the protocol wrapper.

#### `main-services/ble-teardown-and-dual-state`: BleTransport repeats link teardown four times and must keep two state channels (bus + lib) in lockstep by hand

- **Severity:** medium · **Effort:** S · **Fix risk:** medium
- **Locations (as of 93e7b27):** `src/main/transport/ble.ts:229-241`, `src/main/transport/ble.ts:256-266`, `src/main/transport/ble.ts:437-444`, `src/main/transport/ble.ts:466-471`, `src/main/transport/ble.ts:224-225`, `src/main/transport/replay.ts:63-64`, `src/main/transport/replay.ts:82-83`
- **Recommendation:** Extract `private detachTxChar()` and `private async releasePeripheral()` and call them from all four sites. Delete the redundant cleanup in scheduleReconnect's catch. Add `private setLinkState(state: 'idle' | 'connected', deviceId?: string)` that updates both the bus and the lib callback, so the two channels cannot diverge. 'scanning'/'connecting' stay bus-only. Mirror the helper in FileReplayTransport.

#### `main-services/badge-recompute-hot-path`: Badge recompute runs uncoalesced on every 'messages' event and does linear contact/channel scans per key

- **Severity:** medium · **Effort:** S · **Fix risk:** low
- **Locations (as of 93e7b27):** `src/main/notifications/router.ts:200-204`, `src/main/notifications/router.ts:58-70`, `src/main/notifications/router.ts:228-252`, `src/main/notifications/badge.ts:23-39`, `src/main/protocol/adapterEvents.ts:248`
- **Recommendation:** Send the post-message recompute through the same coalescer, e.g. have `subscribeBadgeRecompute` also listen to `messages`, or give the router a `scheduleBadge` dep. Keep the immediate recompute only for the user-action paths (uiState, messagesDeleted), which the comments already single out. In `recomputeBadge`, build `mutedKeys: Set<string>` and `kindByKey: Map<string, ContactKind>` once per call, as `collectMutedKeys` in useUnreads.ts does, instead of per-key `.find`.

#### `main-services/transport-state-owned-by-ws-server`: transportManager's state is updated only as a side effect of the WS server's broadcast listener

- **Severity:** medium · **Effort:** S · **Fix risk:** medium
- **Locations (as of 93e7b27):** `src/main/server.ts:217-233`, `src/main/transport/manager.ts:31-38`, `src/main/api/routes.ts:406`
- **Recommendation:** Have TransportManager subscribe to `transportState` itself, e.g. `transportManager.attach(bus)` at startup, or have transports call `transportManager.setState` via the `setLinkState` helper proposed elsewhere. Move the auto-refresh/contact-walk reactions into a small `wireTransportLifecycle()` in src/main/state. server.ts then only broadcasts.

#### `main-storage/analytics-in-storage`: Channel stats/activity bucketing lives in the storage module, with two divergent day-bucketing implementations and redundant queries

- **Severity:** medium · **Effort:** M · **Fix risk:** medium
- **Locations (as of 93e7b27):** `src/main/storage/messages.ts:44-92`, `src/main/storage/messages.ts:180-232`, `src/main/storage/messages.ts:234-306`
- **Recommendation:** Extract localDayEdges, edgeIndex, bestBand and the bucketing into a pure module, e.g. src/main/storage/channelActivity.ts or src/main/state/channelActivity.ts. src/shared isn't needed, since only main computes these. Rebuild statsByKey.perDay on localDayEdges(now, 7), merge the agg and win queries, and drop the identity map. For 'unknown', first confirm whether anything still produces it. If not, delete the comparisons rather than promote it to a shared constant.

#### `renderer-components-messaging/setpatheditor-reset-effect`: SetPathEditor resets state from props in an effect, and a nearby comment describes a dirty-guard that doesn't exist

- **Severity:** medium · **Effort:** S · **Fix risk:** medium
- **Locations (as of 93e7b27):** `src/renderer/components/path/SetPathEditor.tsx:52-72`, `src/renderer/components/path/SetPathEditor.tsx:90-93`, `src/renderer/components/path/SetPathEditor.tsx:303-365`, `src/renderer/components/path/HopRow.tsx:8`
- **Recommendation:** First decide the intended behavior: should edits survive an external path change or not? To remount, wrap inside SetPathEditor itself rather than at the 3 call sites: `export function SetPathEditor(p) { return <SetPathEditorInner key={`${p.contact.key}:${p.contact.outPathHex ?? ''}:${p.contact.outPathHashSize ?? ''}:${p.contact.preferDirect === true}`} {...p} /> }`. Then seed state with useState and delete the effect. If edits should win, implement the dirty guard instead. Either way, fix or delete the stale comment at :90-91, and rename the private row to EditableHopRow.

#### `renderer-panels-macros/token-colors-dark-only`: Syntax colours are a hard-coded dark-only hex palette applied inline and duplicated as arbitrary Tailwind hex

- **Severity:** medium · **Effort:** M · **Fix risk:** low
- **Locations (as of 93e7b27):** `src/renderer/panels/macros/lib/tokenColors.ts:6-19`, `src/renderer/panels/macros/studio/ReferencePanel.tsx:240-241`, `src/renderer/panels/macros/studio/ReferencePanel.tsx:254`, `src/renderer/panels/macros/studio/MacroEditor.tsx:109-121`, `src/renderer/panels/macros/components/chips.tsx:17`
- **Recommendation:** Add token colour entries to the Palette type in theme.ts with dark and light values, emitted as --cs-tok-* variables by applyTheme like the other tokens. Point TOKEN_COLORS at var(--cs-tok-*) or at Tailwind classes, replace the ReferencePanel hex literals with the same tokens, and swap the MacroEditor ternary for a TOKEN_STYLE lookup. Check light-mode contrast against each token's actual background (bg-2).

#### `shared/cli-notes-leak-dev-provenance`: User-facing CLI `note` strings contain developer provenance and spec section references

- **Severity:** medium · **Effort:** S · **Fix risk:** low
- **Locations (as of 93e7b27):** `src/shared/repeater-cli/catalog.ts:124`, `src/shared/repeater-cli/catalog.ts:269`, `src/shared/repeater-cli/catalog.ts:571`, `src/shared/repeater-cli/catalog.ts:652`, `src/shared/repeater-cli/catalog.ts:660`, `src/shared/repeater-cli/catalog.ts:668`, `src/shared/repeater-cli/catalog.ts:677`, `src/renderer/panels/repeater-admin/cli/CliDetail.tsx:78-83`, `src/renderer/panels/repeater-admin/cli/CliConfirmBar.tsx:58`
- **Recommendation:** Split the field. Keep `note` for user-facing help and add a non-rendered `source?: string` for firmware citations and reconciliation history, or turn that history into `//` comments next to the entry. Then rewrite the affected notes as user copy (e.g. 'Serial console only.'). Add a catalog test asserting that no `note` matches /mockup|reconcil|§|\.cpp/.

## Implemented batches

- **B1 shared-primitives (foundation, land first)**: Create the missing shared owners for cross-process conventions and the cross-cutting renderer helpers, and adopt them only inside the files listed here. Every later batch imports these helpers, so B1 merges before the others start; after that, B2-B13 can run in parallel.
- **B2 main-api, bus and error contract**: Fix the shadow-error bug, the relaunch shutdown skip and the tile 502. Add app.onError/notFound and a fail503 helper. Type the event bus and table-drive server.ts forwarding. Clean up the routes-side contract drift.
- **B3 main state/protocol/bridge/transport cleanup**: Delete migration residue and duplicated protocol code in main, fix the DM send {ok:false} bug, and tighten sendMessage types.
- **B4 main storage and settings persistence**: Consolidate storage boilerplate: transaction helper, typed row helpers, message column constant, limit clamping, narrowed migration catch, shared atomic JSON writer with shape guards, searchMessages split, and discovered-row accessors so src/main/state no longer reads column names.
- **B5 main app shell**: Fix the silent-updater logger cast, de-duplicate shutdown, CSP, window guards and IPC strings, flush the log sink, route console.error through the logger, and install unhandled-rejection safety nets.
- **B6 renderer store core**: Fix wasteful store updates, make WS dispatch safe and exhaustive, de-duplicate the settings unsaved-guard, and fix the macro studio bridge forcing the rail open.
- **B7 renderer commands, menu and shortcuts**: Make the File menu items work, type shortcut ids, and slim the command palette: no rebuild while closed, typed groups, canonical unread counting.
- **B8 renderer messaging and packet components**: Remove dead props and callback chains, de-duplicate the packet inspector and path helpers, and move signal and hex utilities into lib.
- **B9 renderer shell (leftnav and rightrail)**: Narrow RightRail subscriptions, remove dead and unreachable branches, and de-duplicate unread chips, list capping, confirm dialogs, clipboard use and time ticks.
- **B10 renderer settings, search, contacts and logs panels**: Delete the legacy panels, fix the settings rail drift (Extra dirty dot, Proxy title), and reduce the per-section boilerplate.
- **B11 renderer repeater admin and CLI catalog**: Remove duplicated CLI prompt state and reducer logic, add catalog get/set indexes, de-duplicate the tab fetch boilerplate and the neighbour view.
- **B12 renderer maps**: Narrow style-builder inputs, remove dead exports, centralise map-settings persistence with error handling, de-duplicate shape geometry, and add the missing unit tests for the pure clustering code.
- **B13 renderer macros panel and shared macros**: Remove the dead tokenizer error channel, unify the macro mode type and engine caching, remove the MacroContext casts, and consolidate the in-chat render path, caret insert and filter docs.
- **B14 test support consolidation**: Grow tests/support: companion frame builders, a route harness, session lifecycle teardown, bus capture, fixtures and a notify mock. Also clean up the test tree layout.
- **B15 low-risk config cleanup**: Make tooling config cleanups that change no runtime behaviour.
