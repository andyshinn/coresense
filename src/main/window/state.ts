import { join } from 'node:path';
import { type BrowserWindow, screen } from 'electron';
import { errorMessage } from '../../shared/errors';
import { clamp } from '../../shared/math';
import { child } from '../log';
import { userDataDir } from '../runtime/userData';
import { createJsonWriter, isPlainObject, readJsonFile } from '../storage/jsonFile';

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
  return join(userDataDir(), FILE);
}

export function loadWindowState(): WindowState {
  // A missing or corrupt file just means default bounds; nothing to report.
  const stored = readJsonFile(statePath(), isPlainObject, () => undefined);
  if (!stored) return { width: DEFAULTS.width, height: DEFAULTS.height, maximized: false };
  const parsed = stored as Partial<WindowState>;
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
}

// Serialized so a flurry of resize/move events can't interleave with each
// other (last call wins on disk).
const writer = createJsonWriter((_path, err) => log.warn(`failed to save window state: ${errorMessage(err)}`));

export function flushWindowState(): Promise<void> {
  return writer.flush();
}

export function trackWindow(window: BrowserWindow): void {
  let timer: NodeJS.Timeout | null = null;
  const save = () => {
    if (window.isDestroyed()) return;
    const maximized = window.isMaximized();
    const bounds = maximized ? loadWindowState() : window.getBounds();
    writer.write(statePath(), {
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
