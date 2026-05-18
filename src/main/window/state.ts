import { readFileSync } from 'node:fs';
import { rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { app, type BrowserWindow, screen } from 'electron';
import { child } from '../log';

const log = child('window');

const FILE = 'window-state.json';
const DEBOUNCE_MS = 250;
const DEFAULTS = { width: 1100, height: 720 };

export interface WindowState {
  x?: number;
  y?: number;
  width: number;
  height: number;
  maximized: boolean;
}

function statePath(): string {
  return join(app.getPath('userData'), FILE);
}

export function loadWindowState(): WindowState {
  try {
    const raw = readFileSync(statePath(), 'utf8');
    const parsed = JSON.parse(raw) as Partial<WindowState>;
    const w = clamp(parsed.width ?? DEFAULTS.width, 600, 8000);
    const h = clamp(parsed.height ?? DEFAULTS.height, 400, 8000);
    const onScreen = isOnScreen(parsed.x, parsed.y, w, h);
    return {
      x: onScreen ? parsed.x : undefined,
      y: onScreen ? parsed.y : undefined,
      width: w,
      height: h,
      maximized: Boolean(parsed.maximized),
    };
  } catch {
    return { width: DEFAULTS.width, height: DEFAULTS.height, maximized: false };
  }
}

// Serialize writes so a flurry of resize/move events can't interleave with
// each other (last call wins on disk).
let writeChain: Promise<void> = Promise.resolve();

function writeAtomic(state: WindowState): void {
  const target = statePath();
  const tmp = `${target}.tmp`;
  const body = JSON.stringify(state, null, 2);
  writeChain = writeChain
    .catch(() => undefined)
    .then(async () => {
      try {
        await writeFile(tmp, body, 'utf8');
        await rename(tmp, target);
      } catch (err) {
        log.warn(`failed to save window state: ${(err as Error).message}`);
      }
    });
}

export function flushWindowState(): Promise<void> {
  return writeChain;
}

export function trackWindow(window: BrowserWindow): void {
  let timer: NodeJS.Timeout | null = null;
  const save = () => {
    if (window.isDestroyed()) return;
    const maximized = window.isMaximized();
    const bounds = maximized ? loadWindowState() : window.getBounds();
    writeAtomic({
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      maximized,
    });
  };
  const schedule = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(save, DEBOUNCE_MS);
  };
  window.on('resize', schedule);
  window.on('move', schedule);
  window.on('maximize', schedule);
  window.on('unmaximize', schedule);
  window.on('close', save);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function isOnScreen(x: number | undefined, y: number | undefined, w: number, h: number): boolean {
  if (x === undefined || y === undefined) return false;
  try {
    return screen.getAllDisplays().some((d) => {
      const a = d.workArea;
      return x + w > a.x && x < a.x + a.width && y + h > a.y && y < a.y + a.height;
    });
  } catch {
    return true;
  }
}
