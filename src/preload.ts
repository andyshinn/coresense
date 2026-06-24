import { contextBridge, ipcRenderer } from 'electron';
import type { CoreSenseBridge } from './shared/types';

// The bundled Electron window is a first-party client of our own API server,
// but with contextIsolation + sandbox it has no other channel to main. This
// preload hands it the shared API key + bound server port once, synchronously,
// so the renderer can seed both from `window.coresense` and skip the paste
// gate AND the capabilities-probe port guess. A plain browser never loads
// this script, so it still sees the gate — which is correct, it genuinely
// needs to be told the key.
const bridge: CoreSenseBridge = {
  apiKey: ipcRenderer.sendSync('coresense:get-api-key') as string,
  httpPort: ipcRenderer.sendSync('coresense:get-http-port') as number,
  revealLogs: () => ipcRenderer.send('coresense:logs:reveal'),
};

contextBridge.exposeInMainWorld('coresense', bridge);
