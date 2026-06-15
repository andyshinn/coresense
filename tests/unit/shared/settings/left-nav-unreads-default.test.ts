import { describe, expect, test } from 'vitest';
import { DEFAULT_APP_SETTINGS } from '../../../../src/shared/types';

describe('DEFAULT_APP_SETTINGS.showLeftNavUnreads', () => {
  test('defaults the Unreads sidebar link to visible', () => {
    expect(DEFAULT_APP_SETTINGS.showLeftNavUnreads).toBe(true);
  });
});
