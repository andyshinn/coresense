import { beforeEach, describe, expect, it } from 'vitest';
import { useRadixTheme } from '../../../../src/renderer/lib/radix-theme-store';

describe('radix-theme-store', () => {
  beforeEach(() => {
    localStorage.clear();
    useRadixTheme.setState({
      accentColor: 'amber',
      grayColor: 'sand',
      panelBackground: 'translucent',
    });
  });

  it('defaults to the warm preset', () => {
    const s = useRadixTheme.getState();
    expect(s.accentColor).toBe('amber');
    expect(s.grayColor).toBe('sand');
    expect(s.panelBackground).toBe('translucent');
  });

  it('updates and persists accent', () => {
    useRadixTheme.getState().setAccentColor('tomato');
    expect(useRadixTheme.getState().accentColor).toBe('tomato');
    const stored = localStorage.getItem('coresense.radixThemePlayground');
    expect(stored).not.toBeNull();
    expect(JSON.parse(stored ?? '{}').accentColor).toBe('tomato');
  });

  it('updates panel background', () => {
    useRadixTheme.getState().setPanelBackground('solid');
    expect(useRadixTheme.getState().panelBackground).toBe('solid');
  });
});
