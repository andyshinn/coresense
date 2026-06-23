import { describe, expect, it } from 'vitest';
import { useStore } from '../../../../src/renderer/lib/store';
import type { UpdateState } from '../../../../src/shared/types';

describe('store updateState slice', () => {
  it('starts null and applies pushed state', () => {
    expect(useStore.getState().updateState).toBeNull();
    const s: UpdateState = { status: 'downloaded', mode: 'silent', channel: 'stable', currentVersion: '0.0.10' };
    useStore.getState().applyUpdateState(s);
    expect(useStore.getState().updateState).toEqual(s);
  });
});
