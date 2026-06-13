import { describe, expect, it } from 'vitest';
import {
  addSlot,
  availableToAdd,
  moveSlot,
  removeSlot,
  setSlot,
} from '../../../../../src/renderer/features/quick-actions/slots';

describe('slot operations', () => {
  it('availableToAdd returns catalog ids not already used', () => {
    expect(availableToAdd(['flood', 'gps'])).toEqual(['direct', 'shareLoc', 'copyKey', 'reboot', 'disconnect']);
  });
  it('addSlot appends, ignoring duplicates and the 4-slot cap', () => {
    expect(addSlot(['flood'], 'gps')).toEqual(['flood', 'gps']);
    expect(addSlot(['flood'], 'flood')).toEqual(['flood']);
    expect(addSlot(['flood', 'direct', 'gps', 'shareLoc'], 'copyKey')).toEqual(['flood', 'direct', 'gps', 'shareLoc']);
  });
  it('removeSlot removes by index', () => {
    expect(removeSlot(['flood', 'gps', 'disconnect'], 1)).toEqual(['flood', 'disconnect']);
  });
  it('setSlot replaces the id at an index', () => {
    expect(setSlot(['flood', 'gps'], 1, 'disconnect')).toEqual(['flood', 'disconnect']);
  });
  it('moveSlot reorders and clamps out-of-range moves', () => {
    expect(moveSlot(['flood', 'gps', 'disconnect'], 2, 1)).toEqual(['flood', 'disconnect', 'gps']);
    expect(moveSlot(['flood', 'gps'], 0, -1)).toEqual(['flood', 'gps']);
    expect(moveSlot(['flood', 'gps'], 1, 2)).toEqual(['flood', 'gps']);
  });
});
