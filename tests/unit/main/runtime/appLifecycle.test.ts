import { afterEach, describe, expect, it, vi } from 'vitest';
import { appLifecycle, setAppLifecycle } from '../../../../src/main/runtime/appLifecycle';

afterEach(() => setAppLifecycle(null));

describe('appLifecycle', () => {
  it('returns the injected implementation', () => {
    const quit = vi.fn();
    const relaunch = vi.fn();
    setAppLifecycle({ quit, relaunch });
    appLifecycle().quit();
    appLifecycle().relaunch();
    expect(quit).toHaveBeenCalledOnce();
    expect(relaunch).toHaveBeenCalledOnce();
  });

  it('throws when used before injection', () => {
    setAppLifecycle(null);
    expect(() => appLifecycle()).toThrow(/appLifecycle not set/i);
  });
});
