import path from 'node:path';
import { app, BrowserWindow } from 'electron';
import started from 'electron-squirrel-startup';
import { getApiKey } from './api/middleware/auth';
import { startServer } from './server';
import { BleTransport } from './transport/ble';
import { transportManager } from './transport/manager';

if (started) {
  app.quit();
}

declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined;
declare const MAIN_WINDOW_VITE_NAME: string;

const isDev = !!MAIN_WINDOW_VITE_DEV_SERVER_URL;

let serverHandle: { port: number; close: () => Promise<void> } | null = null;

async function bootstrap() {
  // Initialise API key (logs banner on first run).
  getApiKey();

  // Register the default BLE transport.
  transportManager.setTransport(new BleTransport());

  const rendererDir = isDev ? null : path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}`);

  serverHandle = await startServer(rendererDir);
  // eslint-disable-next-line no-console
  console.log(`CoreSense server listening on http://127.0.0.1:${serverHandle.port}`);

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

  // Pipe renderer console messages + page errors to the main process stdout so
  // we can see them when running headless via `pnpm start`.
  mainWindow.webContents.on('console-message', (event) => {
    // eslint-disable-next-line no-console
    console.log(
      `[renderer:${event.level}] ${event.message} (${event.sourceId}:${event.lineNumber})`,
    );
  });
  mainWindow.webContents.on('render-process-gone', (_e, details) => {
    // eslint-disable-next-line no-console
    console.error(`[renderer:gone] ${details.reason} (exit=${details.exitCode})`);
  });
  mainWindow.webContents.on('did-fail-load', (_e, code, desc, url) => {
    // eslint-disable-next-line no-console
    console.error(`[renderer:did-fail-load] ${code} ${desc} ${url}`);
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
    // eslint-disable-next-line no-console
    console.error('Failed to start CoreSense:', err);
    app.quit();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    void shutdown().finally(() => app.quit());
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

app.on('before-quit', () => {
  void shutdown();
});

async function shutdown() {
  if (serverHandle) {
    const handle = serverHandle;
    serverHandle = null;
    await handle.close().catch(() => undefined);
  }
}
