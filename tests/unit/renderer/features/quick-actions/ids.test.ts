import { describe, expect, it } from 'vitest';
import {
  DEFAULT_QUICK_ACTION_IDS,
  MAX_QUICK_ACTIONS,
  QUICK_ACTION_IDS,
} from '../../../../../src/renderer/features/quick-actions/ids';

describe('quick-action ids', () => {
  it('has unique ids', () => {
    expect(new Set(QUICK_ACTION_IDS).size).toBe(QUICK_ACTION_IDS.length);
  });
  it('caps slots at 4', () => {
    expect(MAX_QUICK_ACTIONS).toBe(4);
  });
  it('defaults are valid, ordered, and within the cap', () => {
    expect(DEFAULT_QUICK_ACTION_IDS).toEqual(['flood', 'gps', 'shareLoc', 'disconnect']);
    expect(DEFAULT_QUICK_ACTION_IDS.length).toBeLessThanOrEqual(MAX_QUICK_ACTIONS);
    for (const id of DEFAULT_QUICK_ACTION_IDS) {
      expect(QUICK_ACTION_IDS).toContain(id);
    }
  });
});
