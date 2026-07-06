import { describe, expect, it } from 'vitest';
import { targetToContext } from '@/panels/macros/lib/inchat';

describe('targetToContext', () => {
  it('maps a channel key to channelKey', () => {
    expect(targetToContext('ch:testing')).toEqual({ channelKey: 'ch:testing' });
  });

  it('maps a contact key to contactKey', () => {
    expect(targetToContext('c:abc123')).toEqual({ contactKey: 'c:abc123' });
  });

  it('returns an empty context for an unknown or missing key', () => {
    expect(targetToContext(undefined)).toEqual({});
    expect(targetToContext('tool:macros')).toEqual({});
  });
});
