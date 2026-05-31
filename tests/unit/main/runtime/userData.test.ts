import { afterEach, describe, expect, it } from 'vitest';
import { setUserDataDir, userDataDir } from '../../../../src/main/runtime/userData';

afterEach(() => setUserDataDir(null));

describe('userDataDir', () => {
  it('returns the injected directory', () => {
    setUserDataDir('/tmp/coresense-test');
    expect(userDataDir()).toBe('/tmp/coresense-test');
  });

  it('falls back to CORESENSE_USER_DATA when no dir is injected', () => {
    setUserDataDir(null);
    const prev = process.env.CORESENSE_USER_DATA;
    process.env.CORESENSE_USER_DATA = '/tmp/from-env';
    try {
      expect(userDataDir()).toBe('/tmp/from-env');
    } finally {
      if (prev === undefined) delete process.env.CORESENSE_USER_DATA;
      else process.env.CORESENSE_USER_DATA = prev;
    }
  });

  it('throws a clear error when neither injection nor env nor electron is available', () => {
    setUserDataDir(null);
    const prev = process.env.CORESENSE_USER_DATA;
    delete process.env.CORESENSE_USER_DATA;
    try {
      expect(() => userDataDir()).toThrow(/userData directory not set/i);
    } finally {
      if (prev !== undefined) process.env.CORESENSE_USER_DATA = prev;
    }
  });
});
