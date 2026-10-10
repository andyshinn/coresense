import { contextBridge, ipcRenderer } from 'electron';
import { IPC, type IpcSyncReplies } from './shared/ipc';
import type { CoreSenseBridge } from './shared/types';

// The bundled Electron window is a first-party client of our own API server,
// but with contextIsolation + sandbox it has no other channel to main. This
// preload hands it the shared API key + bound server port once, synchronously,
// so the renderer can seed both from `window.coresense` and skip the paste
// gate AND the capabilities-probe port guess. A plain browser never loads
// this script, so it still sees the gate — which is correct, it genuinely
// needs to be told the key.
const bridge: CoreSenseBridge = {
  apiKey: ipcRenderer.sendSync(IPC.getApiKey) as IpcSyncReplies[typeof IPC.getApiKey],
  httpPort: ipcRenderer.sendSync(IPC.getHttpPort) as IpcSyncReplies[typeof IPC.getHttpPort],
  revealLogs: () => ipcRenderer.send(IPC.revealLogs),
};

contextBridge.exposeInMainWorld('coresense', bridge);
