import path from 'node:path';
import { app, BrowserWindow } from 'electron';
import started from 'electron-squirrel-startup';
import { getApiKey } from './api/middleware/auth';
import { type BridgeHandle, startBridge } from './bridge';
import { child, log } from './log';
import { startServer } from './server';
import { BleTransport } from './transport/ble';
import { transportManager } from './transport/manager';

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

  createWindow();
}

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1100,
    height: 720,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
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
}
