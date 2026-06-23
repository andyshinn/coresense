import { describe, expect, it } from 'vitest';
import { bus, emit } from '../../../../src/main/events/bus';
import type { UpdateState } from '../../../../src/shared/types';

describe('emit.updateState', () => {
  it('emits the updateState bus event with the payload', () => {
    const seen: UpdateState[] = [];
    const handler = (s: UpdateState) => seen.push(s);
    bus.on('updateState', handler);
    const state: UpdateState = { status: 'idle', mode: 'notify', channel: 'stable', currentVersion: '0.0.10' };
    emit.updateState(state);
    bus.off('updateState', handler);
    expect(seen).toEqual([state]);
  });
});
