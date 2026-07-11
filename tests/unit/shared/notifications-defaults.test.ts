import { describe, expect, it } from 'vitest';
import { DEFAULT_APP_SETTINGS } from '../../../src/shared/types';

describe('notification defaults', () => {
  it('enables backlog summarization by default', () => {
    expect(DEFAULT_APP_SETTINGS.notifications.summarizeBacklog).toBe(true);
  });
});
