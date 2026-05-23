import { contextBridge, ipcRenderer } from 'electron';
import type { CoreSenseBridge } from './shared/types';

// The bundled Electron window is a first-party client of our own API server,
// but with contextIsolation + sandbox it has no other channel to main. This
// preload hands it the shared API key once, synchronously, so the renderer can
// seed its key from `window.coresense.apiKey` and skip the paste gate. A plain
// browser never loads this script, so it still sees the gate — which is
// correct, it genuinely needs to be told the key.
const bridge: CoreSenseBridge = {
  apiKey: ipcRenderer.sendSync('coresense:get-api-key') as string,
};

contextBridge.exposeInMainWorld('coresense', bridge);
