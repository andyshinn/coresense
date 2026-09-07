import { describe, expect, it } from 'vitest';
import { FALLBACK_BASE_URL, resolveBaseUrl } from '../../../src/renderer/app/resolveBaseUrl';

const FILE_LOCATION = { protocol: 'file:', host: '' };
const HTTP_LOCATION = { protocol: 'http:', host: 'localhost:5173' };

describe('resolveBaseUrl', () => {
  it('uses the preload-injected port for a first-party window', () => {
    expect(resolveBaseUrl(7754, FILE_LOCATION)).toEqual({ candidate: 'http://127.0.0.1:7754', fallback: null });
  });

  it('never falls back to the well-known port when a port was injected', () => {
    // The regression guard for issue #21: retrying 127.0.0.1:7654 would attach
    // this window's snapshot, WS stream and every mutating call to a different
    // CoreSense instance (different API key, different database).
    for (const port of [7654, 7754, 51234]) {
      const plan = resolveBaseUrl(port, HTTP_LOCATION);
      expect(plan.candidate).toBe(`http://127.0.0.1:${port}`);
      expect(plan.fallback).toBeNull();
    }
  });

  it('prefers the window origin in a plain browser tab', () => {
    expect(resolveBaseUrl(undefined, HTTP_LOCATION)).toEqual({
      candidate: 'http://localhost:5173',
      fallback: FALLBACK_BASE_URL,
    });
    expect(resolveBaseUrl(null, { protocol: 'https:', host: 'mesh.example:8443' })).toEqual({
      candidate: 'https://mesh.example:8443',
      fallback: FALLBACK_BASE_URL,
    });
  });

  it('does not offer the origin twice when it already is the fallback', () => {
    expect(resolveBaseUrl(null, { protocol: 'http:', host: '127.0.0.1:7654' })).toEqual({
      candidate: FALLBACK_BASE_URL,
      fallback: null,
    });
  });

  it('guesses the well-known port only for a file:// origin with no injected port', () => {
    expect(resolveBaseUrl(undefined, FILE_LOCATION)).toEqual({ candidate: FALLBACK_BASE_URL, fallback: null });
  });

  it('ignores a zero injected port rather than building http://127.0.0.1:0', () => {
    expect(resolveBaseUrl(0, HTTP_LOCATION)).toEqual({
      candidate: 'http://localhost:5173',
      fallback: FALLBACK_BASE_URL,
    });
  });
});
