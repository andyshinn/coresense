import { describe, expect, it } from 'vitest';
import { DEFAULT_APP_SETTINGS } from '../../../src/shared/types';

describe('AppSettings.distanceUnit', () => {
  it('defaults to metric', () => {
    expect(DEFAULT_APP_SETTINGS.distanceUnit).toBe('metric');
  });
});
