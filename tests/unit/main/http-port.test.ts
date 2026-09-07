import { describe, expect, it } from 'vitest';
import { DEFAULT_HTTP_PORT_DEV, DEFAULT_HTTP_PORT_PROD, HTTP_PORT_ENV, resolveHttpPort } from '../../../src/main/http-port';
import { BRIDGE_DEFAULT_TCP_PORT, BRIDGE_DEFAULT_TCP_PORT_DEV } from '../../../src/shared/types';

describe('resolveHttpPort', () => {
  it('uses the prod default for an installed instance', () => {
    expect(resolveHttpPort({}, false)).toBe(DEFAULT_HTTP_PORT_PROD);
    expect(DEFAULT_HTTP_PORT_PROD).toBe(7654);
  });

  it('uses the dev default for a dev instance', () => {
    expect(resolveHttpPort({}, true)).toBe(DEFAULT_HTTP_PORT_DEV);
    expect(DEFAULT_HTTP_PORT_DEV).toBe(7754);
  });

  it('honours an explicit port', () => {
    expect(resolveHttpPort({ [HTTP_PORT_ENV]: '9100' }, false)).toBe(9100);
    expect(resolveHttpPort({ [HTTP_PORT_ENV]: '9100' }, true)).toBe(9100);
  });

  it('treats 0 as a request for an ephemeral port', () => {
    // What tests/e2e/support/launch.ts sets, so a test run can never claim a
    // well-known port.
    expect(resolveHttpPort({ [HTTP_PORT_ENV]: '0' }, false)).toBe(0);
    expect(resolveHttpPort({ [HTTP_PORT_ENV]: '0' }, true)).toBe(0);
  });

  it('tolerates surrounding whitespace', () => {
    expect(resolveHttpPort({ [HTTP_PORT_ENV]: ' 8080 ' }, false)).toBe(8080);
  });

  it.each(['', '   ', 'abc', '80.5', '-1', '0x1f', '65536', '99999'])(
    'falls back to the default for the unusable value %j',
    (value) => {
      expect(resolveHttpPort({ [HTTP_PORT_ENV]: value }, false)).toBe(DEFAULT_HTTP_PORT_PROD);
    },
  );

  it('reads only from the env it is handed', () => {
    const prev = process.env[HTTP_PORT_ENV];
    process.env[HTTP_PORT_ENV] = '1234';
    try {
      expect(resolveHttpPort({}, false)).toBe(DEFAULT_HTTP_PORT_PROD);
    } finally {
      if (prev === undefined) delete process.env[HTTP_PORT_ENV];
      else process.env[HTTP_PORT_ENV] = prev;
    }
  });
});

describe('the default port map', () => {
  const ports = {
    'HTTP prod': DEFAULT_HTTP_PORT_PROD,
    'bridge prod': BRIDGE_DEFAULT_TCP_PORT,
    'HTTP dev': DEFAULT_HTTP_PORT_DEV,
    'bridge dev': BRIDGE_DEFAULT_TCP_PORT_DEV,
  };

  it('is the documented set of ports', () => {
    expect(ports).toEqual({ 'HTTP prod': 7654, 'bridge prod': 7656, 'HTTP dev': 7754, 'bridge dev': 7756 });
  });

  it.each(Object.entries(ports))('%s (%i) is even', (_name, port) => {
    expect(port % 2).toBe(0);
  });

  it('keeps every default at least 2 apart', () => {
    // Nothing probes or walks any more, so a default that landed on (or next
    // to) another default would be an unrecoverable collision, not a detour.
    const sorted = Object.values(ports).sort((a, b) => a - b);
    for (let i = 1; i < sorted.length; i += 1) {
      expect(sorted[i] - sorted[i - 1]).toBeGreaterThanOrEqual(2);
    }
  });
});
