import type { CoreSenseBridge } from '../shared/types';

// `window.coresense` is injected by src/preload.ts in the bundled Electron
// window. Optional — a plain browser running the web bundle never has it.
declare global {
  interface Window {
    coresense?: CoreSenseBridge;
  }
}
