import { afterEach, describe, expect, it } from 'vitest';
import { appPath, isPackaged, setAppInfo } from '../../../../src/main/runtime/appInfo';

afterEach(() => setAppInfo(null));

describe('appInfo', () => {
  it('returns injected isPackaged and appPath', () => {
    setAppInfo({ isPackaged: true, appPath: '/opt/app' });
    expect(isPackaged()).toBe(true);
    expect(appPath()).toBe('/opt/app');
  });

  it('throws when used before injection', () => {
    setAppInfo(null);
    expect(() => isPackaged()).toThrow(/appInfo not set/i);
    expect(() => appPath()).toThrow(/appInfo not set/i);
  });
});
