import { Buffer } from 'node:buffer';
import { afterEach, describe, expect, it } from 'vitest';
import { secretStore, setSecretStore } from '../../../../src/main/runtime/secretStore';

afterEach(() => setSecretStore(null));

describe('secretStore', () => {
  it('returns the injected implementation', () => {
    setSecretStore({
      available: () => true,
      encryptString: (s) => Buffer.from(s, 'utf8'),
      decryptString: (b) => b.toString('utf8'),
    });
    const s = secretStore();
    expect(s.available()).toBe(true);
    const cipher = s.encryptString('hello');
    expect(s.decryptString(cipher)).toBe('hello');
  });

  it('throws when used before injection', () => {
    setSecretStore(null);
    expect(() => secretStore()).toThrow(/secretStore not set/i);
  });
});
