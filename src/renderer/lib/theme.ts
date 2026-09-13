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
  field0: string;
  field1: string;
  field2: string;
  field3: string;
  field4: string;
  field5: string;
  field6: string;
  routeDirect: string;
  routeFlood: string;
  ble: string;
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
  field0: '232 163 61',
  field1: '110 161 230',
  field2: '155 207 90',
  field3: '229 140 110',
  field4: '70 183 174',
  field5: '185 138 224',
  field6: '212 180 74',
  routeDirect: '127 184 77',
  routeFlood: '110 161 230',
  ble: '185 138 224',
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
  // Byte-field tints. Each is painted as text on its OWN 16% fill (byte strip,
  // over bg-3/40 on the rail's bg-2), as text on solid bg-3 (field-card title),
  // and as a solid fill under bg-coloured text (hovered byte). Contrast is
  // measured against those real substrates, not the page — the previous values
  // (2.62-3.76:1 on their fill) passed an eyeball check and failed AA. Dark
  // mode's tints already clear 5.1:1 everywhere.
  // Ratios: on own fill / on bg-3 / bg text on solid.
  field0: '116 73 13', // 5.03 / 5.79 / 7.38
  field1: '36 81 150', // 5.02 / 5.81 / 7.41
  field2: '62 90 28', // 5.07 / 5.83 / 7.43
  field3: '131 62 41', // 5.03 / 5.83 / 7.43
  field4: '19 92 86', // 5.02 / 5.81 / 7.41
  field5: '102 66 136', // 5.03 / 5.80 / 7.39
  field6: '100 80 20', // 5.04 / 5.80 / 7.39
  // Route/BLE badges are only ever a solid fill under bg-coloured text.
  routeDirect: '55 92 28', // bg text on solid 7.36 (was 4.39)
  routeFlood: '43 96 179',
  ble: '120 78 160',
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

// `bg2`/`bg3` need a hyphen before the digit too (→ `bg-2`/`bg-3`) to match the
// CSS variable names index.css actually defines (`--cs-bg-2`, `--cs-bg-3`).
// Without it this produced `--cs-bg2`/`--cs-bg3` — variables nothing reads —
// so applyTheme('light') silently left --cs-bg-2/--cs-bg-3 pinned at their
// dark-mode :root defaults while --cs-text switched to light-mode's near-black,
// making rail/card surfaces and their text render at ~1:1 contrast.
function kebab(camel: string): string {
  return camel.replace(/([a-z])(\d)/g, '$1-$2').replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
}
