import './storage/paths'; // must precede any module that touches app.getPath()
import path from 'node:path';
import {
  app,
  BrowserWindow,
  clipboard,
  ipcMain,
  Menu,
  type MenuItemConstructorOptions,
  nativeTheme,
  session,
  shell,
} from 'electron';
import started from 'electron-squirrel-startup';
import { applyAboutPanel } from './about';
import { getApiKey } from './api/middleware/auth';
import { type BridgeHandle, startBridge } from './bridge';
import { emit } from './events/bus';
import { child, ingestLogEntry, log } from './log';
import { applyLoggingSettings } from './logging/apply';
import { folderPath } from './logging/fileSink';
import { buildMenu } from './menu';
import { startNotifications } from './notifications';
import { protocolSession } from './protocol';
import { startServer } from './server';
import { stateHolder } from './state/holder';
import { closeDb } from './storage/db';
import { optimizeFts } from './storage/search';
import { flushSettings } from './storage/settings';
import { BleTransport } from './transport/ble';
import { transportManager } from './transport/manager';
import { startUpdater } from './updater';
import { isQuitConfirmed } from './window/quit';
import { getMainWindow, setMainWindow } from './window/registry';
import { flushWindowState, loadWindowState, trackWindow } from './window/state';

const SHUTDOWN_BLE_TIMEOUT_MS = 5000;

const rendererLog = child('renderer');

if (started) {
  app.quit();
}

declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined;
declare const MAIN_WINDOW_VITE_NAME: string;

const isDev = !!MAIN_WINDOW_VITE_DEV_SERVER_URL;

let serverHandle: { port: number; close: () => Promise<void> } | null = null;
let bridgeHandle: BridgeHandle | null = null;

async function bootstrap() {
  // Initialise API key (logs banner on first run).
  getApiKey();

  // The preload script (src/preload.ts) requests the key + bound server port
  // synchronously at window load so the first-party renderer can skip the
  // paste gate AND avoid guessing the dev/prod port. Register before
  // createWindow() so the handlers exist when the preload runs.
  ipcMain.on('coresense:get-api-key', (event) => {
    event.returnValue = getApiKey();
  });
  ipcMain.on('coresense:get-http-port', (event) => {
    event.returnValue = serverHandle?.port ?? null;
  });

  ipcMain.on('coresense:ship-log-entry', (_event, entry: unknown) => {
    // Sanity-check renderer-untrusted input before feeding the pipeline.
    if (
      entry !== null &&
      typeof entry === 'object' &&
      typeof (entry as Record<string, unknown>).id === 'string' &&
      typeof (entry as Record<string, unknown>).ts === 'number' &&
      typeof (entry as Record<string, unknown>).level === 'string' &&
      typeof (entry as Record<string, unknown>).source === 'string' &&
      typeof (entry as Record<string, unknown>).logger === 'string' &&
      typeof (entry as Record<string, unknown>).message === 'string' &&
      typeof (entry as Record<string, unknown>).levelId === 'number'
    ) {
      ingestLogEntry(entry as Parameters<typeof ingestLogEntry>[0]);
    }
  });
  ipcMain.on('coresense:logs:reveal', () => {
    shell.openPath(folderPath()).catch((err) => console.error('openPath failed', err));
  });

  // Apply logging settings from persisted app settings on boot.
  applyLoggingSettings(stateHolder().getAppSettings().logging);

  // Register the default BLE transport.
  transportManager.setTransport(new BleTransport());

  const proxy = stateHolder().getAppSettings().proxy;
  bridgeHandle = await startBridge({
    dev: isDev,
    enableTcp: proxy.enabled,
    enableMdns: proxy.enabled && proxy.mdns,
    bindAddress: proxy.bindAll ? '0.0.0.0' : '127.0.0.1',
    tcpPort: proxy.port,
  });
  log.info(
    `bridge: TCP=${bridgeHandle.tcpPort ?? 'off'} mDNS=${bridgeHandle.serviceName ?? 'off'}`,
  );

  const rendererDir = isDev ? null : path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}`);

  serverHandle = await startServer(rendererDir, bridgeHandle, { dev: isDev });
  log.info(`server listening on http://127.0.0.1:${serverHandle.port}`);

  hardenSession();
  applyAboutPanel();
  Menu.setApplicationMenu(buildMenu());
  wireTheme();
  protocolSession().start();
  startNotifications();
  startUpdater();

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

  // Strict-ish CSP. The renderer is served by our own Hono server in prod (so
  // it shares an origin with the API and the /ws endpoint), and by Vite in dev.
  // Allow ws: for WebSocket connections and the dev server's HMR, plus blob:
  // for source maps and worker shims.
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    // Protomaps glyph PBFs and sprite assets live on protomaps.github.io.
    // MapLibre fetches glyphs as ArrayBuffers (connect-src) and the sprite
    // PNG as an Image (img-src). TODO: bundle these into resources/ for a
    // fully offline build.
    const MAP_ASSETS = 'https://protomaps.github.io';
    const csp = isDev
      ? "default-src 'self'; " +
        "script-src 'self' 'unsafe-inline' 'unsafe-eval' blob:; " +
        "style-src 'self' 'unsafe-inline'; " +
        'connect-src * ws: wss: http: https: data: blob:; ' +
        `img-src 'self' data: blob: ${MAP_ASSETS}; ` +
        "font-src 'self' data:; " +
        "worker-src 'self' blob:;"
      : "default-src 'self'; " +
        "script-src 'self'; " +
        "style-src 'self' 'unsafe-inline'; " +
        `connect-src 'self' ws: wss: ${MAP_ASSETS}; ` +
        `img-src 'self' data: blob: ${MAP_ASSETS}; ` +
        "font-src 'self' data:; " +
        "worker-src 'self' blob:; " +
        "object-src 'none'; " +
        "base-uri 'none'; " +
        "frame-ancestors 'none';";
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

// Belt-and-suspenders against any future code path that opens a BrowserView,
// webview, or popup. Catches them all at the app level even if a specific
// window forgets its own guards.
app.on('web-contents-created', (_event, contents) => {
  contents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      void shell.openExternal(url);
    }
    return { action: 'deny' };
  });
  contents.on('will-attach-webview', (e) => e.preventDefault());

  // Native OS context menu. Selection-aware: only shows entries that make
  // sense for what was clicked (link, editable field, plain text with
  // selection). In dev, also exposes Inspect Element.
  contents.on('context-menu', (_e, params) => {
    const template: MenuItemConstructorOptions[] = [];

    if (params.linkURL) {
      template.push(
        {
          label: 'Open Link in Browser',
          click: () => {
            void shell.openExternal(params.linkURL);
          },
        },
        {
          label: 'Copy Link',
          click: () => clipboard.writeText(params.linkURL),
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

    if (!app.isPackaged) {
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
      // preload target to `preload.js` alongside this main bundle.
      preload: path.join(__dirname, 'preload.js'),
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

  // Defer the close button so the renderer can prompt about unsaved Settings
  // changes. It replies via POST /api/app/quit, which re-issues the close.
  mainWindow.on('close', (event) => {
    if (isShuttingDown || isQuitConfirmed()) return;
    event.preventDefault();
    emit.menuAction({ kind: 'requestQuit' });
  });

  // Mouse back/forward buttons on Windows/Linux. macOS doesn't fire app-command
  // for these — the renderer handles macOS mouse XButton1/XButton2 via mousedown
  // button 3/4 instead.
  mainWindow.on('app-command', (_event, command) => {
    if (command === 'browser-backward') emit.menuAction({ kind: 'navigate', direction: 'back' });
    else if (command === 'browser-forward')
      emit.menuAction({ kind: 'navigate', direction: 'forward' });
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

  // Defense in depth on top of the deny-by-default permission handler:
  // refuse to attach <webview> tags and disable popup window creation.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    // Open http(s):// links in the user's default browser; deny everything else.
    if (url.startsWith('http://') || url.startsWith('https://')) {
      void shell.openExternal(url);
    }
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, targetUrl) => {
    // Compare full origins, not string prefixes — `startsWith` would let
    // `http://127.0.0.1:7654.evil.com/` pass the allowlist.
    const allowedOrigin = MAIN_WINDOW_VITE_DEV_SERVER_URL
      ? safeOrigin(MAIN_WINDOW_VITE_DEV_SERVER_URL)
      : serverHandle
        ? `http://127.0.0.1:${serverHandle.port}`
        : null;
    const targetOrigin = safeOrigin(targetUrl);
    if (!allowedOrigin || targetOrigin !== allowedOrigin) {
      event.preventDefault();
      if (targetUrl.startsWith('http://') || targetUrl.startsWith('https://')) {
        void shell.openExternal(targetUrl);
      }
    }
  });
  mainWindow.webContents.on('will-attach-webview', (event) => {
    event.preventDefault();
  });

  // Pipe renderer console messages + page errors through the main logger so
  // we can see them when running headless via `pnpm start`. Dev-only — in prod
  // this is just IPC + log overhead on every console.log from chatty UI code.
  if (isDev) {
    mainWindow.webContents.on('console-message', (event) => {
      rendererLog.debug(
        `[${event.level}] ${event.message} (${event.sourceId}:${event.lineNumber})`,
      );
    });
  }
  mainWindow.webContents.on('render-process-gone', (_e, details) => {
    rendererLog.error(`gone: ${details.reason} (exit=${details.exitCode})`);
  });
  const appUrl = MAIN_WINDOW_VITE_DEV_SERVER_URL
    ? MAIN_WINDOW_VITE_DEV_SERVER_URL
    : serverHandle
      ? `http://127.0.0.1:${serverHandle.port}`
      : null;

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
        if (!mainWindow.isDestroyed()) void mainWindow.loadURL(appUrl);
      }, LOAD_RETRY_DELAY_MS);
      return;
    }
    rendererLog.error(`did-fail-load: ${code} ${desc} ${url}`);
  });

  if (appUrl) {
    void mainWindow.loadURL(appUrl);
  }

  if (isDev) mainWindow.webContents.openDevTools({ mode: 'detach' });
}

app.on('ready', () => {
  bootstrap().catch((err) => {
    log.fatal(`failed to start: ${(err as Error).stack ?? err}`);
    app.quit();
  });
});

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
  if (!isQuitConfirmed() && getMainWindow()) {
    event.preventDefault();
    emit.menuAction({ kind: 'requestQuit' });
    return;
  }
  isShuttingDown = true;
  event.preventDefault();
  beginShutdown().finally(() => app.exit(0));
});

async function shutdown() {
  const tasks: Promise<unknown>[] = [];
  if (serverHandle) {
    const handle = serverHandle;
    serverHandle = null;
    tasks.push(
      handle.close().catch((err) => log.warn(`server close failed: ${(err as Error).message}`)),
    );
  }
  if (bridgeHandle) {
    const handle = bridgeHandle;
    bridgeHandle = null;
    tasks.push(
      handle.close().catch((err) => log.warn(`bridge close failed: ${(err as Error).message}`)),
    );
  }

  // Transport shutdown releases noble's native CBCentralManager so the
  // Electron process can terminate on macOS. Race against a timeout in case
  // a flaky peripheral makes disconnect hang.
  tasks.push(
    Promise.race([
      transportManager.shutdown().then(() => 'ok' as const),
      new Promise<'timeout'>((resolve) =>
        setTimeout(() => resolve('timeout'), SHUTDOWN_BLE_TIMEOUT_MS),
      ),
    ])
      .then((result) => {
        if (result === 'timeout') {
          log.warn(`transport shutdown did not finish within ${SHUTDOWN_BLE_TIMEOUT_MS}ms`);
        }
      })
      .catch((err) => log.warn(`transport shutdown threw: ${(err as Error).message}`)),
  );

  await Promise.allSettled(tasks);
  // Drain any in-flight settings / window-state writes before exit so the
  // user's last UI tweaks survive a quit.
  await Promise.allSettled([
    flushSettings().catch((err) => log.warn(`settings flush failed: ${(err as Error).message}`)),
    flushWindowState().catch((err) =>
      log.warn(`window state flush failed: ${(err as Error).message}`),
    ),
  ]);
  // Compact the FTS5 index before closing the DB. Cheap on small indexes,
  // worth doing periodically on larger ones to keep query latency low.
  try {
    optimizeFts();
  } catch (err) {
    log.warn(`fts optimize failed: ${(err as Error).message}`);
  }
  closeDb();
}
