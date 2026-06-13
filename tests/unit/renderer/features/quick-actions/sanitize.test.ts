import { describe, expect, it } from 'vitest';
import { sanitizeQuickActionIds } from '../../../../../src/renderer/features/quick-actions/sanitize';

describe('sanitizeQuickActionIds', () => {
  it('keeps known ids in order', () => {
    expect(sanitizeQuickActionIds(['flood', 'gps', 'disconnect'])).toEqual(['flood', 'gps', 'disconnect']);
  });
  it('drops unknown ids', () => {
    expect(sanitizeQuickActionIds(['flood', 'sendLoc', 'bogus', 'gps'])).toEqual(['flood', 'gps']);
  });
  it('drops duplicates, keeping the first', () => {
    expect(sanitizeQuickActionIds(['gps', 'gps', 'flood'])).toEqual(['gps', 'flood']);
  });
  it('caps at 4', () => {
    expect(sanitizeQuickActionIds(['flood', 'direct', 'gps', 'shareLoc', 'copyKey', 'reboot'])).toEqual([
      'flood',
      'direct',
      'gps',
      'shareLoc',
    ]);
  });
  it('returns an empty array for empty input', () => {
    expect(sanitizeQuickActionIds([])).toEqual([]);
  });
});
