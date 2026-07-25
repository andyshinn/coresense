// mac-theme.js — warm-dark "Field Console" palette + fonts, lifted from the
// CoreSense Connection/Settings panels so the Macros tool sits in the same
// visual family. Plus the syntax-highlight token colors used by the editor.
window.MAC_T = {
  bg: '#0c0a06', bg2: '#13110b', bg3: '#1a1610', bg4: '#221c12',
  border: '#2a2419', borderStrong: '#3a3322',
  text: '#f5f1e6', textMuted: '#a39884', textDim: '#6b6253',
  accent: '#f59e0b', accentDim: '#b45309',
  accentBg: 'rgba(245,158,11,0.10)', accentSoft: 'rgba(245,158,11,0.18)',
  online: '#84cc16', warn: '#f59e0b', danger: '#ef4444',
  dangerBg: 'rgba(239,68,68,0.10)', warnBg: 'rgba(245,158,11,0.08)',
  chip: '#1c1810',
};

window.MAC_FONT = '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif';
window.MAC_MONO = '"JetBrains Mono", ui-monospace, "SF Mono", Menlo, Consolas, monospace';

// Token colors for the LiquidJS syntax highlighter. Tuned to read on bg2/bg3.
window.MAC_SYNTAX = {
  text:      '#e7e0cf', // literal text between tags
  delim:     '#7c7560', // {{ }} | : ,
  variable:  '#f5c451', // a known variable (amber)
  unavail:   '#d99a3c', // known variable, but not available in current mode
  filter:    '#9ed36a', // a known filter name (lime)
  custom:    '#7fd1c4', // a custom MeshCore filter (distance/bearing/unit) — teal
  string:    '#c0a578', // 'quoted' filter arg
  number:    '#d8a657', // numeric filter arg
  error:     '#f87171', // unknown variable / filter — red, wavy underline
};

// MeshCore message size budget (chars). Real MeshCore text frames are small.
window.MAC_MSG_LIMIT = 132;
