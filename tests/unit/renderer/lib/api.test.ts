import { describe, expect, it } from 'vitest';
import { parseServerError } from '@/lib/api';

describe('parseServerError', () => {
  it('extracts the error field from a JSON body', () => {
    expect(parseServerError('{"error":"Contact list full"}')).toBe('Contact list full');
  });

  it('returns null for a non-JSON body', () => {
    expect(parseServerError('Internal Server Error')).toBeNull();
  });

  it('returns null when error is absent or not a string', () => {
    expect(parseServerError('{"ok":true}')).toBeNull();
    expect(parseServerError('{"error":123}')).toBeNull();
  });
});
