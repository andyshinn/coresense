import { describe, expect, it } from 'vitest';
import { decodeMeshcoreUri } from '../../../../src/renderer/lib/meshcoreUri';

describe('decodeMeshcoreUri', () => {
  it('returns null when the prefix is missing', () => {
    expect(decodeMeshcoreUri('https://example.com')).toBeNull();
  });

  it('returns null for non-hex or odd-length payloads', () => {
    expect(decodeMeshcoreUri('meshcore://zzzz')).toBeNull();
    expect(decodeMeshcoreUri('meshcore://abc')).toBeNull();
  });

  it('returns null for an empty payload', () => {
    expect(decodeMeshcoreUri('meshcore://')).toBeNull();
  });

  it('returns null for well-formed hex that is not a valid advert', () => {
    expect(decodeMeshcoreUri('meshcore://00')).toBeNull();
  });
});
