import path from 'node:path';
import { app, BrowserWindow, Menu, nativeTheme, session, shell } from 'electron';
import started from 'electron-squirrel-startup';
import { getApiKey } from './api/middleware/auth';
import { type BridgeHandle, startBridge } from './bridge';
import { emit } from './events/bus';
import { child, log } from './log';
import { buildMenu } from './menu';
import { startNotifications } from './notifications';
import { protocolSession } from './protocol';
import { startServer } from './server';
import { closeDb } from './storage/db';
import { BleTransport } from './transport/ble';
import { transportManager } from './transport/manager';
import { setMainWindow } from './window/registry';
import { loadWindowState, trackWindow } from './window/state';

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

  // Register the default BLE transport.
  transportManager.setTransport(new BleTransport());

  bridgeHandle = await startBridge();
  log.info(
    `bridge: TCP=${bridgeHandle.tcpPort ?? 'off'} WS=${bridgeHandle.wsPort ?? 'off'} mDNS=${bridgeHandle.serviceName ?? 'off'}`,
  );

  const rendererDir = isDev ? null : path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}`);

  serverHandle = await startServer(rendererDir, bridgeHandle);
  log.info(`server listening on http://127.0.0.1:${serverHandle.port}`);

  hardenSession();
  Menu.setApplicationMenu(buildMenu());
  wireTheme();
  protocolSession().start();
  startNotifications();

  createWindow();
}

function hardenSession() {
  // Deny all permission requests by default. Camera/microphone/etc. should be
  // explicitly opted into when (and only when) we add a feature that needs them.
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) =>
    callback(false),
  );

  // Strict-ish CSP. The renderer is served by our own Hono server in prod (so
  // it shares an origin with the API and the /ws endpoint), and by Vite in dev.
  // Allow ws: for WebSocket connections and the dev server's HMR, plus blob:
  // for source maps and worker shims.
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const csp = isDev
      ? "default-src 'self'; " +
        "script-src 'self' 'unsafe-inline' 'unsafe-eval' blob:; " +
        "style-src 'self' 'unsafe-inline'; " +
        'connect-src * ws: wss: http: https: data: blob:; ' +
        "img-src 'self' data: blob:; " +
        "font-src 'self' data:; " +
        "worker-src 'self' blob:;"
      : "default-src 'self'; " +
        "script-src 'self'; " +
        "style-src 'self' 'unsafe-inline'; " +
        "connect-src 'self' ws: wss:; " +
        "img-src 'self' data: blob:; " +
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
          trafficLightPosition: { x: 14, y: 14 },
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
    const allowed = MAIN_WINDOW_VITE_DEV_SERVER_URL
      ? targetUrl.startsWith(MAIN_WINDOW_VITE_DEV_SERVER_URL)
      : serverHandle
        ? targetUrl.startsWith(`http://127.0.0.1:${serverHandle.port}`)
        : false;
    if (!allowed) {
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
  // we can see them when running headless via `pnpm start`.
  mainWindow.webContents.on('console-message', (event) => {
    rendererLog.debug(`[${event.level}] ${event.message} (${event.sourceId}:${event.lineNumber})`);
  });
  mainWindow.webContents.on('render-process-gone', (_e, details) => {
    rendererLog.error(`gone: ${details.reason} (exit=${details.exitCode})`);
  });
  mainWindow.webContents.on('did-fail-load', (_e, code, desc, url) => {
    rendererLog.error(`did-fail-load: ${code} ${desc} ${url}`);
  });

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else if (serverHandle) {
    mainWindow.loadURL(`http://127.0.0.1:${serverHandle.port}`);
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
  closeDb();
}
