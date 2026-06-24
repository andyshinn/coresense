import { create } from 'zustand';

export type RadixAccent =
  | 'gray'
  | 'gold'
  | 'bronze'
  | 'brown'
  | 'yellow'
  | 'amber'
  | 'orange'
  | 'tomato'
  | 'red'
  | 'ruby'
  | 'crimson'
  | 'pink'
  | 'plum'
  | 'purple'
  | 'violet'
  | 'iris'
  | 'indigo'
  | 'blue'
  | 'cyan'
  | 'teal'
  | 'jade'
  | 'green'
  | 'grass'
  | 'lime'
  | 'mint'
  | 'sky';
export type RadixGray = 'auto' | 'gray' | 'mauve' | 'slate' | 'sage' | 'olive' | 'sand';
export type RadixPanelBg = 'translucent' | 'solid';

export const ACCENT_OPTIONS: readonly RadixAccent[] = [
  'gray',
  'gold',
  'bronze',
  'brown',
  'yellow',
  'amber',
  'orange',
  'tomato',
  'red',
  'ruby',
  'crimson',
  'pink',
  'plum',
  'purple',
  'violet',
  'iris',
  'indigo',
  'blue',
  'cyan',
  'teal',
  'jade',
  'green',
  'grass',
  'lime',
  'mint',
  'sky',
];
export const GRAY_OPTIONS: readonly RadixGray[] = ['auto', 'gray', 'mauve', 'slate', 'sage', 'olive', 'sand'];

const KEY = 'coresense.radixThemePlayground';
interface PlaygroundState {
  accentColor: RadixAccent;
  grayColor: RadixGray;
  panelBackground: RadixPanelBg;
}
const DEFAULTS: PlaygroundState = { accentColor: 'amber', grayColor: 'sand', panelBackground: 'translucent' };

function load(): PlaygroundState {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...DEFAULTS, ...JSON.parse(raw) } : DEFAULTS;
  } catch {
    return DEFAULTS;
  }
}
function persist(s: PlaygroundState) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}

interface RadixThemeStore extends PlaygroundState {
  setAccentColor: (c: RadixAccent) => void;
  setGrayColor: (c: RadixGray) => void;
  setPanelBackground: (b: RadixPanelBg) => void;
}

export const useRadixTheme = create<RadixThemeStore>((set, get) => ({
  ...load(),
  setAccentColor: (accentColor) => {
    set({ accentColor });
    persist({ ...get(), accentColor });
  },
  setGrayColor: (grayColor) => {
    set({ grayColor });
    persist({ ...get(), grayColor });
  },
  setPanelBackground: (panelBackground) => {
    set({ panelBackground });
    persist({ ...get(), panelBackground });
  },
}));
