import { describe, expect, it } from 'vitest';
import { errorMessage } from '../../../src/shared/errors';

describe('errorMessage', () => {
  it('uses an Error message', () => expect(errorMessage(new Error('boom'))).toBe('boom'));
  it('returns a string rejection as-is', () => expect(errorMessage('nope')).toBe('nope'));
  it('uses a string message on a non-Error object', () => expect(errorMessage({ message: 'bad' })).toBe('bad'));
  it('JSON-encodes other values', () => {
    expect(errorMessage({ code: 7 })).toBe('{"code":7}');
    expect(errorMessage(42)).toBe('42');
    expect(errorMessage(null)).toBe('null');
  });
  it('always returns a string, even where JSON cannot encode the value', () => {
    // JSON.stringify(undefined) is undefined, not a string.
    expect(errorMessage(undefined)).toBe('undefined');
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(errorMessage(cyclic)).toBe('[object Object]');
  });
});
