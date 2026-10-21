// Side-effect imports first, in this order. ES modules evaluate in import
// order, so these two run before any module imported below is evaluated.
import './runtime/devUserDataRedirect'; // must precede any module that touches app.getPath()
import './bootstrap/seams'; // wires userDataDir() / appLifecycle() / secretStore() etc.
import { hostname } from 'node:os';
import path from 'node:path';
import { getCanonicalHostName } from '@andyshinn/hostname-sources';
import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  Menu,
  type MenuItemConstructorOptions,
  nativeTheme,
  session,
  type WebContents,
} from 'electron';
import started from 'electron-squirrel-startup';
import { errorMessage } from '../shared/errors';
import { IPC, type IpcSyncReplies } from '../shared/ipc';
import { planBridgeBinding } from '../shared/ports';
import { applyAboutPanel } from './about';
import { getApiKey } from './api/middleware/auth';
import { blockingStore } from './blocking/store';
import { finishQuit } from './bootstrap/finishQuit';
import { type BridgeHandle, startBridge } from './bridge';
import { buildMdnsServices, type MdnsHandle, startMdns } from './bridge/mdns';
import { emit } from './events/bus';
import { resolveHttpPort } from './http-port';
import { child, log } from './log';
import { applyLoggingSettings } from './logging/apply';
import { flushLogFile, folderPath } from './logging/fileSink';
import { clampTileCacheMaxBytes, getTileCache } from './map/tile-cache';
import { buildMenu } from './menu';
import { flushNodeCache } from './node/nodeCache';
import { startNotifications } from './notifications';
import { protocolSession } from './protocol';
import { openExternal, openExternalIfWeb, revealPath } from './runtime/shell';
import { buildCsp } from './security/csp';
import { startServer } from './server';
import { flushHolderPersistence, stateHolder } from './state/holder';
import { closeDb } from './storage/db';
import { optimizeFts } from './storage/search';
import { flushSettings } from './storage/settings';
import { transportManager } from './transport/manager';
import { installStartupTransport } from './transport/select';
import { startUpdates } from './updates/wiring';
import { withTimeout } from './util/async';
import { isQuitConfirmed, shouldDeferQuit } from './window/quit';
import { getMainWindow, setMainWindow } from './window/registry';
import { flushWindowState, loadWindowState, trackWindow } from './window/state';

const SHUTDOWN_BLE_TIMEOUT_MS = 5000;
const SHUTDOWN_LOG_FLUSH_TIMEOUT_MS = 1000;
// Well above the BLE bound plus the flushes, which normally take milliseconds.
const SHUTDOWN_TIMEOUT_MS = 15_000;

const rendererLog = child('renderer');

// Safety net for promises nobody handled: route them through tslog so they
// reach the Logs panel and the file sink, not just stderr. Deliberately no
// uncaughtException handler — see events/coalesce.ts.
process.on('unhandledRejection', (reason) => {
  log.error('unhandled rejection', reason);
});

if (started) {
  app.quit();
}

declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined;
declare const MAIN_WINDOW_VITE_NAME: string;

// Two different questions used to share one `isDev` flag, and they disagree in
// exactly one case: a production-built main bundle run *unpackaged* — which is
// what the e2e harness and a hand-run `electron .vite/build/index.cjs` do. That
// made a test run claim the installed app's HTTP port (issue #21).
//
// "Is the renderer served by Vite's dev server?" — a build-time define that
// constant-folds to undefined in every `build` output. Decides where the
// renderer HTML comes from, how strict the CSP is, and whether DevTools open.
const viteDevServerUrl = MAIN_WINDOW_VITE_DEV_SERVER_URL;
// "Is this a dev instance?" — runtime identity. Decides which ports and which
// mDNS namespace this process claims, so it must agree with the predicates
// that already redirect userData (runtime/devUserDataRedirect.ts) and seed the
// dev proxy port (storage/settings.ts). Read app.isPackaged directly rather
// than isPackaged() from runtime/appInfo so this does not depend on
// setAppInfo() having run first.
const isDevInstance = !app.isPackaged;

let serverHandle: Awaited<ReturnType<typeof startServer>> | null = null;
/** Someone is connected to receive a `requestQuit` broadcast (see shouldDeferQuit). */
const rendererConnected = (): boolean => serverHandle?.hasOpenClients() ?? false;
let bridgeHandle: BridgeHandle | null = null;
let mdnsHandle: MdnsHandle | null = null;

async function bootstrap() {
  // Initialise API key (logs banner on first run).
  getApiKey();

  // The preload script (src/preload.ts) requests the key + bound server port
  // synchronously at window load so the first-party renderer can skip the
  // paste gate AND avoid guessing the dev/prod port. Register before
  // createWindow() so the handlers exist when the preload runs.
  ipcMain.on(IPC.getApiKey, (event) => {
    event.returnValue = getApiKey() satisfies IpcSyncReplies[typeof IPC.getApiKey];
  });
  ipcMain.on(IPC.getHttpPort, (event) => {
    event.returnValue = (serverHandle?.port ?? null) satisfies IpcSyncReplies[typeof IPC.getHttpPort];
  });

  ipcMain.on(IPC.revealLogs, () => {
    void revealPath(folderPath());
  });

  // Apply logging settings from persisted app settings on boot.
  applyLoggingSettings(stateHolder().getAppSettings().logging);

  // Select the startup transport: real BLE, or the env-gated replay transport
  // when CORESENSE_FAKE_TRANSPORT is set (E2E). Dynamic import inside keeps
  // native BLE deps from loading in test mode.
  await installStartupTransport(process.env, transportManager);

  const proxy = stateHolder().getAppSettings().proxy;
  // "Bind to all interfaces" (and, by extension, mDNS advertising) only take
  // effect when the proxy is enabled. The settings UI disables — but does not
  // clear — the bindAll/mdns toggles when the proxy is off, so a stale
  // bindAll=true must not silently bind the HTTP/WS server (or bridge) to
  // 0.0.0.0 and expose the API on the LAN.
  const bindAll = proxy.enabled && proxy.bindAll;
  const bindAddress = bindAll ? '0.0.0.0' : '127.0.0.1';

  // Resolve our own HTTP port BEFORE the bridge binds anything, and hand the
  // same number to startServer below so the two cannot disagree. proxy.port is
  // user-editable and the bridge binds first, so a proxy port set to the HTTP
  // port would take it and leave the API server unable to start — fatal, with
  // no window in which to undo the setting. Drop the TCP listener instead and
  // keep the app: the reason travels in BridgeStatus to the Proxy panel.
  const httpPort = resolveHttpPort(process.env, isDevInstance);
  const bridgePlan = planBridgeBinding(proxy, httpPort);
  if (bridgePlan.conflict) log.error(`bridge: TCP listener not started — ${bridgePlan.conflict}`);

  bridgeHandle = await startBridge({
    dev: isDevInstance,
    enableTcp: bridgePlan.enableTcp,
    portConflict: bridgePlan.conflict,
    bindAddress,
    tcpPort: proxy.port,
  });
  log.info(`bridge: TCP=${bridgeHandle.tcpPort ?? 'off'}`);

  const rendererDir = viteDevServerUrl ? null : path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}`);

  serverHandle = await startServer(rendererDir, bridgeHandle, { port: httpPort, bindAddress });
  log.info(`server listening on http://${bindAddress}:${serverHandle.port}`);
  // Apply the persisted tile-cache cap. Clamped for defense-in-depth against a
  // hand-edited settings file.
  void getTileCache().setMaxBytes(clampTileCacheMaxBytes(stateHolder().getMapSettings().tileCacheMaxBytes));

  // mDNS is published once both ports are known. Records are only advertised
  // when the servers bind the LAN (bindAll) and mDNS is enabled — otherwise the
  // SRV target would point at an address nothing else can reach.
  //
  // Prefer the platform's canonical mDNS hostname (e.g. macOS LocalHostName,
  // Linux avahi) so the advertised SRV target is the `.local` name the OS
  // actually resolves; fall back to os.hostname() if probing yields nothing.
  let canonicalHostname: string;
  try {
    canonicalHostname = (await getCanonicalHostName()) ?? hostname();
  } catch {
    canonicalHostname = hostname();
  }
  const mdnsPlan = buildMdnsServices({
    hostname: canonicalHostname,
    dev: isDevInstance,
    advertise: bindAll && proxy.mdns,
    bridgeEnabled: proxy.enabled,
    bridgeTcpPort: bridgeHandle.tcpPort,
    httpPort: serverHandle.port,
    serviceNameOverride: process.env.BRIDGE_MDNS_NAME,
  });
  if (mdnsPlan.services.length > 0) {
    try {
      mdnsHandle = startMdns(mdnsPlan);
    } catch (err) {
      emit.error(`Bridge: mDNS publish failed: ${errorMessage(err)}`);
    }
  }
  bridgeHandle.setMdnsServiceName(mdnsHandle?.serviceName ?? null);
  log.info(`mDNS=${mdnsHandle?.serviceName ?? 'off'} services=${mdnsPlan.services.length}`);

  hardenSession();
  applyAboutPanel();
  Menu.setApplicationMenu(buildMenu());
  wireTheme();
  protocolSession().start();
  // E2E: the env-gated replay transport has no UI "connect" action. Trigger its
  // fixture playback here — AFTER startServer() and protocolSession().start()
  // have subscribed to the bus — so the replayed transportState/packets have
  // listeners. (Firing it at install time, before these subscriptions, drops
  // the replay entirely.)
  if (process.env.CORESENSE_FAKE_TRANSPORT) {
    transportManager
      .getTransport()
      ?.connect('replay')
      .catch((err) => log.warn(`replay transport connect failed: ${errorMessage(err)}`));
  }
  startNotifications();
  startUpdates();

  createWindow();
}

function hardenSession() {
  // Deny permission requests by default. Camera/microphone/etc. should be
  // explicitly opted into when (and only when) we add a feature that needs them.
  // `clipboard-sanitized-write` is the one exception: navigator.clipboard
  // .writeText() needs it, and a blanket deny is what silently breaks every
  // copy-to-clipboard action in the UI. It only permits plain *sanitized*
  // writes — not clipboard reads — so it's safe to allow.
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) =>
    callback(permission === 'clipboard-sanitized-write'),
  );

  // See security/csp.ts for the policy and why each source is allowed.
  const csp = buildCsp({ dev: Boolean(viteDevServerUrl) });
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [csp],
      },
    });
  });
}

function safeOrigin(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

function wireTheme() {
  nativeTheme.on('updated', () => {
    emit.theme({ systemDark: nativeTheme.shouldUseDarkColors });
  });
}

/** Where the main window loads the renderer from, or null with no server up. */
function resolveAppUrl(): string | null {
  if (viteDevServerUrl) return viteDevServerUrl;
  return serverHandle ? `http://127.0.0.1:${serverHandle.port}` : null;
}

/** Refuse to attach <webview> tags and deny popup windows, opening http(s)
 *  links in the user's default browser instead. */
function applyWebContentsGuards(contents: WebContents): void {
  contents.setWindowOpenHandler(({ url }) => {
    openExternalIfWeb(url);
    return { action: 'deny' };
  });
  contents.on('will-attach-webview', (e) => e.preventDefault());
}

// Belt-and-suspenders against any future code path that opens a BrowserView,
// webview, or popup. Catches them all at the app level even if a specific
// window forgets its own guards.
app.on('web-contents-created', (_event, contents) => {
  applyWebContentsGuards(contents);

  // Native OS context menu. Selection-aware: only shows entries that make
  // sense for what was clicked (link, editable field, plain text with
  // selection). In dev, also exposes Inspect Element.
  contents.on('context-menu', (_e, params) => {
    const template: MenuItemConstructorOptions[] = [];

    if (params.linkURL) {
      template.push(
        {
          label: 'Open Link in Browser',
          click: () => openExternal(params.linkURL),
        },
        {
          label: 'Copy Link',
          click: () => {
            // Electron 44 made clipboard.writeText async; don't leave a rejection unhandled.
            clipboard.writeText(params.linkURL).catch((err) => log.warn(`copy link failed: ${errorMessage(err)}`));
          },
        },
        { type: 'separator' },
      );
    }

    if (params.isEditable) {
      template.push(
        { role: 'cut', enabled: params.editFlags.canCut },
        { role: 'copy', enabled: params.editFlags.canCopy },
        { role: 'paste', enabled: params.editFlags.canPaste },
        { type: 'separator' },
        { role: 'selectAll', enabled: params.editFlags.canSelectAll },
      );
    } else if (params.selectionText.trim().length > 0) {
      template.push({ role: 'copy' }, { type: 'separator' }, { role: 'selectAll' });
    }

    if (isDevInstance) {
      if (template.length > 0) template.push({ type: 'separator' });
      template.push({
        label: 'Inspect Element',
        click: () => contents.inspectElement(params.x, params.y),
      });
    }

    if (template.length > 0) {
      const win = BrowserWindow.fromWebContents(contents) ?? undefined;
      // Passing `frame: params.frame` is what unlocks macOS system items
      // (Writing Tools, AutoFill, Services). Without it those don't appear
      // even on macOS. See electron docs: tutorial/context-menu.
      Menu.buildFromTemplate(template).popup({ window: win, frame: params.frame ?? undefined });
    }
  });
});

function createWindow() {
  const saved = loadWindowState();
  const mainWindow = new BrowserWindow({
    x: saved.x,
    y: saved.y,
    width: saved.width,
    height: saved.height,
    minWidth: 720,
    minHeight: 480,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0c0a06' : '#fbf9f3',
    // Platform-tuned chrome: hidden inset traffic lights on macOS, overlay on
    // Windows 11, frameless on Linux (we draw our own title bar).
    ...(process.platform === 'darwin'
      ? {
          titleBarStyle: 'hiddenInset' as const,
          // y centers the 12px buttons in the 36px (h-9) TitleBar: (36-12)/2.
          // trafficLightPosition: { x: 20, y: 12 },  // TODO: This doesn't seem to have any effect?
        }
      : process.platform === 'win32'
        ? {
            titleBarStyle: 'hidden' as const,
            titleBarOverlay: {
              color: nativeTheme.shouldUseDarkColors ? '#0c0a06' : '#fbf9f3',
              symbolColor: nativeTheme.shouldUseDarkColors ? '#f5f1e6' : '#1c1810',
              height: 36,
            },
          }
        : { frame: false }),
    webPreferences: {
      // Hands the renderer the shared API key via `window.coresense` so the
      // bundled window skips the manual paste gate. Built by the Vite plugin's
      // preload target to `preload.cjs` alongside this main bundle.
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: false,
      spellcheck: false,
    },
  });
  if (saved.maximized) mainWindow.maximize();
  trackWindow(mainWindow);
  setMainWindow(mainWindow);

  // Broadcast authoritative window focus to the renderer. The notification
  // router reads BrowserWindow.isFocused() directly (freshest at send time);
  // the renderer needs a pushed signal to gate view-driven auto-mark-read so a
  // message arriving while backgrounded doesn't clear its own notification.
  mainWindow.on('focus', () => emit.windowFocus(true));
  mainWindow.on('blur', () => emit.windowFocus(false));

  // Defer the close button so the renderer can prompt about unsaved Settings
  // changes. It replies via POST /api/app/quit, which quits the app.
  mainWindow.on('close', (event) => {
    if (isShuttingDown || isQuitConfirmed()) return;
    event.preventDefault();
    if (shouldDeferQuit({ confirmed: false, hasWindow: true, rendererConnected: rendererConnected() })) {
      emit.menuAction({ kind: 'requestQuit' });
    } else {
      // Nobody is connected to answer; quit now, exactly as a confirmed close does.
      app.quit();
    }
  });

  // Mouse back/forward buttons on Windows/Linux. macOS doesn't fire app-command
  // for these — the renderer handles macOS mouse XButton1/XButton2 via mousedown
  // button 3/4 instead.
  mainWindow.on('app-command', (_event, command) => {
    if (command === 'browser-backward') emit.menuAction({ kind: 'navigate', direction: 'back' });
    else if (command === 'browser-forward') emit.menuAction({ kind: 'navigate', direction: 'forward' });
  });

  // macOS 3-finger trackpad swipe. Requires the user to have enabled
  // "Swipe with two or three fingers" in System Preferences > Trackpad >
  // More Gestures. The modern default 2-finger swipe is consumed by Chromium
  // for overscroll and is not exposed by Electron without scroll-touch-* hacks.
  if (process.platform === 'darwin') {
    mainWindow.on('swipe', (_event, direction) => {
      if (direction === 'left') emit.menuAction({ kind: 'navigate', direction: 'back' });
      else if (direction === 'right') emit.menuAction({ kind: 'navigate', direction: 'forward' });
    });
  }

  const appUrl = resolveAppUrl();
  // Compare full origins, not string prefixes — `startsWith` would let
  // `http://127.0.0.1:7654.evil.com/` pass the allowlist.
  const allowedOrigin = appUrl ? safeOrigin(appUrl) : null;

  // Defense in depth on top of the deny-by-default permission handler and the
  // app-level web-contents-created guards: refuse to attach <webview> tags and
  // disable popup window creation.
  applyWebContentsGuards(mainWindow.webContents);
  mainWindow.webContents.on('will-navigate', (event, targetUrl) => {
    if (!allowedOrigin || safeOrigin(targetUrl) !== allowedOrigin) {
      event.preventDefault();
      openExternalIfWeb(targetUrl);
    }
  });

  // NOTE: renderer and main logging are intentionally kept separate. The
  // renderer logs to its own browser console (tslog pretty → DevTools); main
  // logs to the terminal + Logs panel + file sink. We deliberately do NOT
  // scrape `console-message` to mirror the renderer here — re-logging tslog's
  // own pretty `%c` output through the main logger double-wrapped every line.
  mainWindow.webContents.on('render-process-gone', (_e, details) => {
    rendererLog.error(`gone: ${details.reason} (exit=${details.exitCode})`);
  });

  // The Vite dev server (and, marginally, our own Hono server) can still be
  // settling when we first call loadURL — the initial connection is refused
  // and the window is left stranded on an internal chrome-error: page, since
  // Electron does not retry on its own. Re-issue the load a few times before
  // giving up. ERR_CONNECTION_REFUSED is -102; -3 (ERR_ABORTED) fires when a
  // newer load supersedes this one and must not be retried.
  const MAX_LOAD_RETRIES = 20;
  const LOAD_RETRY_DELAY_MS = 250;
  let loadRetries = 0;
  mainWindow.webContents.on('did-fail-load', (_e, code, desc, url, isMainFrame) => {
    if (isMainFrame && appUrl && code === -102 && loadRetries < MAX_LOAD_RETRIES) {
      loadRetries += 1;
      setTimeout(() => {
        if (!mainWindow.isDestroyed()) loadApp();
      }, LOAD_RETRY_DELAY_MS);
      return;
    }
    rendererLog.error(`did-fail-load: ${code} ${desc} ${url}`);
  });

  // loadURL also rejects on every did-fail-load, which the handler above
  // already retries or reports; don't leave that rejection unhandled.
  function loadApp(): void {
    if (!appUrl) return;
    mainWindow.loadURL(appUrl).catch((err) => rendererLog.debug(`loadURL rejected: ${errorMessage(err)}`));
  }
  loadApp();

  if (viteDevServerUrl) mainWindow.webContents.openDevTools({ mode: 'detach' });
}

app.on('ready', () => {
  bootstrap().catch((err) => {
    reportFatalStartupError(err);
    app.quit();
  });
});

/**
 * A bootstrap failure happens before the window exists, so there is no UI to
 * report it in — the app just vanishes. Log the full stack for a bug report,
 * and put the human-readable part in a native error box so the user is not
 * left guessing why nothing opened. The common case by far is a port already
 * held by another CoreSense (see server.ts's portInUseError).
 */
function reportFatalStartupError(err: unknown): void {
  log.fatal(`failed to start: ${err instanceof Error ? (err.stack ?? err.message) : errorMessage(err)}`);
  // Automated runs (the Playwright harness sets CORESENSE_FAKE_TRANSPORT) must
  // never block on a modal nobody can dismiss.
  if (process.env.CORESENSE_FAKE_TRANSPORT) return;
  try {
    dialog.showErrorBox('CoreSense could not start', errorMessage(err) || String(err));
  } catch {
    // showErrorBox can throw on a headless/unusable display; the log line above
    // is still written.
  }
}

let isShuttingDown = false;
let shutdownPromise: Promise<void> | null = null;

function beginShutdown(): Promise<void> {
  if (!shutdownPromise) shutdownPromise = shutdown();
  return shutdownPromise;
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    // app.quit() will fire before-quit which handles the awaited shutdown.
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

app.on('before-quit', (event) => {
  if (isShuttingDown) return;
  // First quit attempt with a window still up: let the renderer decide whether
  // unsaved Settings changes need a prompt. It replies via POST /api/app/quit.
  if (
    shouldDeferQuit({
      confirmed: isQuitConfirmed(),
      hasWindow: getMainWindow() !== null,
      rendererConnected: rendererConnected(),
    })
  ) {
    event.preventDefault();
    emit.menuAction({ kind: 'requestQuit' });
    return;
  }
  isShuttingDown = true;
  event.preventDefault();
  void finishQuit({
    shutdown: beginShutdown,
    shutdownTimeoutMs: SHUTDOWN_TIMEOUT_MS,
    onShutdownError: (err) => log.error(`shutdown failed: ${errorMessage(err)}`),
    flushLog: flushLogFile,
    flushTimeoutMs: SHUTDOWN_LOG_FLUSH_TIMEOUT_MS,
    exit: () => app.exit(0),
  });
});

/** Await `p`, logging `${label} failed: …` instead of rejecting. */
function settle(label: string, p: Promise<unknown>): Promise<void> {
  return p.then(
    () => undefined,
    (err) => {
      log.warn(`${label} failed: ${errorMessage(err)}`);
    },
  );
}

/** Hand back every open server handle, nulling each so shutdown closes it once. */
function takeClosables(): Array<[label: string, handle: { close(): Promise<unknown> }]> {
  const closables: Array<[string, { close(): Promise<unknown> } | null]> = [
    ['mdns', mdnsHandle],
    ['server', serverHandle],
    ['bridge', bridgeHandle],
  ];
  mdnsHandle = null;
  serverHandle = null;
  bridgeHandle = null;
  return closables.filter((c): c is [string, { close(): Promise<unknown> }] => c[1] !== null);
}

async function shutdown() {
  const tasks = takeClosables().map(([label, handle]) => settle(`${label} close`, handle.close()));

  // Transport shutdown releases noble's native CBCentralManager so the
  // Electron process can terminate on macOS. Race against a timeout in case
  // a flaky peripheral makes disconnect hang.
  tasks.push(
    settle('transport shutdown', withTimeout(transportManager.shutdown(), SHUTDOWN_BLE_TIMEOUT_MS, 'transport shutdown')),
  );

  await Promise.all(tasks);
  // Contacts/channels persistence and the search-index rebuild are coalesced,
  // so a quit landing inside a coalesce window would drop the last change.
  // Settle it before the settings queue is drained below.
  await settle('holder flush', flushHolderPersistence());
  flushNodeCache();
  // Drain any pending block-rule counter increments into the settings
  // write queue so flushSettings() below can await them.
  blockingStore().flushNow();
  // Drain any in-flight settings / window-state writes before exit so the
  // user's last UI tweaks survive a quit.
  await Promise.all([settle('settings flush', flushSettings()), settle('window state flush', flushWindowState())]);
  // Compact the FTS5 index before closing the DB. Cheap on small indexes,
  // worth doing periodically on larger ones to keep query latency low.
  try {
    optimizeFts();
  } catch (err) {
    log.warn(`fts optimize failed: ${errorMessage(err)}`);
  }
  closeDb();
}
