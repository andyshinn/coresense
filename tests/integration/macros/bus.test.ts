import { describe, expect, it } from 'vitest';
import { bus, emit } from '../../../src/main/events/bus';
import type { MacroTemplate } from '../../../src/shared/types';

describe('emit.macros', () => {
  it('emits the macros bus event with the payload', () => {
    const received: MacroTemplate[][] = [];
    const handler = (m: MacroTemplate[]) => received.push(m);
    bus.on('macros', handler);
    emit.macros([{ id: '1', name: 'a', template: 'x', scope: 'global', createdAt: 0, updatedAt: 0 }]);
    bus.off('macros', handler);
    expect(received[0]?.[0]?.id).toBe('1');
  });
});
