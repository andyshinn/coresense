// MeshCore warm fall palette — lifted from MeshCore Desktop.html FC_THEMES,
// with extra slots for the settings-panel chrome (section card bg, rail
// hover, save-strip background).

window.MC_PALETTE = (() => {
  const accentSwatches = {
    amber:   { dark: '#f59e0b', light: '#b45309', name: 'Amber'  },
    rust:    { dark: '#ea580c', light: '#c2410c', name: 'Rust'   },
    persimmon:{ dark: '#dc2626', light: '#a3361a', name: 'Persimmon' },
    olive:   { dark: '#a3a30b', light: '#65651a', name: 'Olive'  },
  };

  const accentBg = (hex, a) => {
    // hex -> rgba
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r},${g},${b},${a})`;
  };

  const make = (mode, accentKey) => {
    const acc = accentSwatches[accentKey] || accentSwatches.amber;
    if (mode === 'dark') {
      return {
        mode: 'dark',
        bg:        '#0c0a06',
        bg2:       '#13110b',
        bg3:       '#1a1610',
        bg4:       '#221c12',
        border:    '#2a2419',
        borderStrong: '#3a3322',
        text:      '#f5f1e6',
        textMuted: '#a39884',
        textDim:   '#6b6253',
        accent:    acc.dark,
        accentBg:  accentBg(acc.dark, 0.12),
        accentSoft:accentBg(acc.dark, 0.20),
        online:    '#84cc16',
        warn:      '#f59e0b',
        danger:    '#dc2626',
        chip:      '#1c1810',
        rowHover:  'rgba(245,241,230,0.04)',
        controlBg: '#0c0a06',
        controlBorder: '#2a2419',
        saveStrip: 'rgba(245,158,11,0.06)',
        bannerBg:  'rgba(245,158,11,0.08)',
        bannerBorder: 'rgba(245,158,11,0.30)',
      };
    }
    return {
      mode: 'light',
      bg:        '#fbf9f3',
      bg2:       '#f5f1e6',
      bg3:       '#ede7d6',
      bg4:       '#e2dac1',
      border:    '#dcd4be',
      borderStrong: '#c4ba9f',
      text:      '#1c1810',
      textMuted: '#5c5340',
      textDim:   '#8a8067',
      accent:    acc.light,
      accentBg:  accentBg(acc.light, 0.08),
      accentSoft:accentBg(acc.light, 0.15),
      online:    '#65a30d',
      warn:      '#b45309',
      danger:    '#b91c1c',
      chip:      '#ede7d6',
      rowHover:  'rgba(28,24,16,0.03)',
      controlBg: '#fbf9f3',
      controlBorder: '#dcd4be',
      saveStrip: 'rgba(180,83,9,0.04)',
      bannerBg:  'rgba(180,83,9,0.06)',
      bannerBorder: 'rgba(180,83,9,0.30)',
    };
  };

  return { make, accentSwatches };
})();

window.MC_FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, "Helvetica Neue", Helvetica, Arial, sans-serif';
window.MC_MONO = 'ui-monospace, "SF Mono", Menlo, Consolas, "Roboto Mono", monospace';
