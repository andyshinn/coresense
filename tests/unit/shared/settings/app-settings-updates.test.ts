import { describe, expect, it } from 'vitest';
import { DEFAULT_APP_SETTINGS } from '../../../../src/shared/types';

describe('AppSettings.updates defaults', () => {
  it('defaults to the stable channel with auto-check on', () => {
    expect(DEFAULT_APP_SETTINGS.updates).toEqual({ channel: 'stable', autoCheck: true });
  });
});
