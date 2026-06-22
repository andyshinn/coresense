import { describe, expect, it } from 'vitest';
import { MacroValidationError, macrosStore } from '../../../src/main/macros/store';

describe('macrosStore', () => {
  it('round-trips create, update, list, remove', () => {
    const created = macrosStore.add({ name: 'sig', template: 'rssi {{ rssi }}', scope: 'global' });
    expect(created.id).toBeTruthy();
    expect(macrosStore.list().map((m) => m.id)).toContain(created.id);

    const updated = macrosStore.update(created.id, { name: 'signal' });
    expect(updated?.name).toBe('signal');
    expect(updated?.updatedAt).toBeGreaterThanOrEqual(created.createdAt);

    expect(macrosStore.remove(created.id)).toBe(true);
    expect(macrosStore.list()).toHaveLength(0);
  });

  it('rejects a template that fails to parse', () => {
    expect(() => macrosStore.add({ name: 'bad', template: '{% if %}', scope: 'global' })).toThrow(MacroValidationError);
    expect(macrosStore.list()).toHaveLength(0);
  });
});
