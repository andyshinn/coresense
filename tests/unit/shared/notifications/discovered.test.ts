import { describe, expect, it } from 'vitest';
import { shouldFireDiscovered } from '../../../../src/shared/notifications/discovered';
import { DEFAULT_APP_SETTINGS } from '../../../../src/shared/types';

const base = DEFAULT_APP_SETTINGS.notifications;

describe('DEFAULT_APP_SETTINGS', () => {
  it('enables discovered-contact notifications by default', () => {
    expect(DEFAULT_APP_SETTINGS.notifications.discoveredContact).toBe(true);
  });
});

describe('shouldFireDiscovered', () => {
  it('fires when enabled and the window is not focused', () => {
    expect(shouldFireDiscovered({ ...base, discoveredContact: true }, false)).toBe(true);
  });

  it('does not fire when the toggle is off', () => {
    expect(shouldFireDiscovered({ ...base, discoveredContact: false }, false)).toBe(false);
  });

  it('suppresses while focused when suppressWhenFocused is on', () => {
    expect(shouldFireDiscovered({ ...base, discoveredContact: true, suppressWhenFocused: true }, true)).toBe(false);
  });

  it('fires while focused when suppressWhenFocused is off', () => {
    expect(shouldFireDiscovered({ ...base, discoveredContact: true, suppressWhenFocused: false }, true)).toBe(true);
  });
});
