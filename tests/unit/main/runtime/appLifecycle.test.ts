import { afterEach, describe, expect, it, vi } from 'vitest';
import { appLifecycle, setAppLifecycle } from '../../../../src/main/runtime/appLifecycle';

afterEach(() => setAppLifecycle(null));

describe('appLifecycle', () => {
  it('returns the injected implementation', () => {
    const quit = vi.fn();
    const relaunch = vi.fn();
    const exit = vi.fn();
    setAppLifecycle({ quit, relaunch, exit });
    appLifecycle().quit();
    appLifecycle().relaunch();
    appLifecycle().exit(0);
    expect(quit).toHaveBeenCalledOnce();
    expect(relaunch).toHaveBeenCalledOnce();
    expect(exit).toHaveBeenCalledWith(0);
  });

  it('throws when used before injection', () => {
    setAppLifecycle(null);
    expect(() => appLifecycle()).toThrow(/appLifecycle not set/i);
  });
});
