import { describe, expect, it } from 'vitest';
import { QUICK_ACTIONS_BY_ID } from '../../../../../src/renderer/features/quick-actions/catalog';
import { QUICK_ACTION_IDS } from '../../../../../src/renderer/features/quick-actions/ids';

describe('quick-action catalog', () => {
  it('has a def for every assignable id, filed under its own id', () => {
    for (const id of QUICK_ACTION_IDS) expect(QUICK_ACTIONS_BY_ID[id]?.id).toBe(id);
    expect(Object.keys(QUICK_ACTIONS_BY_ID).sort()).toEqual([...QUICK_ACTION_IDS].sort());
  });
});
