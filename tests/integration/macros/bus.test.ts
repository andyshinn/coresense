import { describe, expect, it } from 'vitest';
import { emit } from '../../../src/main/events/bus';
import { captureBus } from '../../support/bus';

describe('emit.macros', () => {
  it('emits the macros bus event with the payload', () => {
    const macros = captureBus('macros');
    emit.macros([{ id: '1', name: 'a', template: 'x', scope: 'global', createdAt: 0, updatedAt: 0 }]);
    expect(macros.last()?.[0]?.id).toBe('1');
  });
});
