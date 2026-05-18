import type { ThemePref } from '../../shared/types';

export type { ThemePref };
export type ThemeMode = 'dark' | 'light';

// Legacy localStorage key, retained only for the one-shot migration into
// ui-state.json. Read once on hydration; never written.
export const LEGACY_THEME_PREF_KEY = 'coresense.theme';

export function readLegacyThemePref(): ThemePref | null {
  try {
    const raw = localStorage.getItem(LEGACY_THEME_PREF_KEY);
    if (raw === 'dark' || raw === 'light' || raw === 'auto') return raw;
  } catch {
    // localStorage may be unavailable in some embeddings.
  }
  return null;
}

export function clearLegacyThemePref(): void {
  try {
    localStorage.removeItem(LEGACY_THEME_PREF_KEY);
  } catch {
    // no-op
  }
}

interface Palette {
  bg: string;
  bg2: string;
  bg3: string;
  text: string;
  textMuted: string;
  textDim: string;
  border: string;
  borderStrong: string;
  accent: string;
  accentSoft: string;
  online: string;
  warn: string;
  danger: string;
}

// Field Console — warm wood/amber. Values are RGB triplets ("r g b") so they
// compose with Tailwind utilities like `bg-[rgb(var(--cs-bg)/0.5)]` and
// `color-mix`. CSS variables are written to `:root` by applyTheme().
const DARK: Palette = {
  bg: '12 10 6',
  bg2: '24 19 11',
  bg3: '34 27 16',
  text: '245 241 230',
  textMuted: '193 178 145',
  textDim: '128 117 96',
  border: '42 36 25',
  borderStrong: '58 51 34',
  accent: '245 158 11',
  accentSoft: '146 64 14',
  online: '132 204 22',
  warn: '245 158 11',
  danger: '220 38 38',
};

const LIGHT: Palette = {
  bg: '251 249 243',
  bg2: '243 239 226',
  bg3: '230 222 200',
  text: '28 24 16',
  textMuted: '92 78 56',
  textDim: '140 124 94',
  border: '218 207 184',
  borderStrong: '192 178 148',
  accent: '180 83 9',
  accentSoft: '254 215 170',
  online: '101 163 13',
  warn: '217 119 6',
  danger: '185 28 28',
};

const PALETTES: Record<ThemeMode, Palette> = { dark: DARK, light: LIGHT };

export function systemPrefersDark(): boolean {
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  } catch {
    return true;
  }
}

export function resolveTheme(pref: ThemePref, systemDark: boolean): ThemeMode {
  if (pref === 'auto') return systemDark ? 'dark' : 'light';
  return pref;
}

export function applyTheme(mode: ThemeMode): void {
  const palette = PALETTES[mode];
  const root = document.documentElement;
  root.classList.toggle('dark', mode === 'dark');
  root.style.colorScheme = mode;
  for (const [key, value] of Object.entries(palette)) {
    root.style.setProperty(`--cs-${kebab(key)}`, value);
  }
}

function kebab(camel: string): string {
  return camel.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
}
