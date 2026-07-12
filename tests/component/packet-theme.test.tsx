import { describe, expect, it } from 'vitest';
import { applyTheme } from '@/lib/theme';

describe('inspector theme tokens', () => {
  it('applyTheme writes field + route tokens for dark and light', () => {
    applyTheme('dark');
    const dark = getComputedStyle(document.documentElement).getPropertyValue('--cs-field0').trim();
    expect(dark.length).toBeGreaterThan(0);
    applyTheme('light');
    const light = getComputedStyle(document.documentElement).getPropertyValue('--cs-field0').trim();
    expect(light.length).toBeGreaterThan(0);
    expect(light).not.toBe(dark);
    expect(getComputedStyle(document.documentElement).getPropertyValue('--cs-route-direct').trim().length).toBeGreaterThan(
      0,
    );
  });
});
