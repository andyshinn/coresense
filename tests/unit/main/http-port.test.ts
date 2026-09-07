import { describe, expect, it } from 'vitest';
import { DEFAULT_HTTP_PORT_DEV, DEFAULT_HTTP_PORT_PROD, HTTP_PORT_ENV, resolveHttpPort } from '../../../src/main/http-port';

describe('resolveHttpPort', () => {
  it('uses the prod default for an installed instance', () => {
    expect(resolveHttpPort({}, false)).toEqual({ port: DEFAULT_HTTP_PORT_PROD, allowFallback: true });
    expect(DEFAULT_HTTP_PORT_PROD).toBe(7654);
  });

  it('uses the dev default for a dev instance', () => {
    expect(resolveHttpPort({}, true)).toEqual({ port: DEFAULT_HTTP_PORT_DEV, allowFallback: true });
    expect(DEFAULT_HTTP_PORT_DEV).toBe(7754);
  });

  it('honours an explicit port and forbids the collision walk', () => {
    expect(resolveHttpPort({ [HTTP_PORT_ENV]: '9100' }, false)).toEqual({ port: 9100, allowFallback: false });
    expect(resolveHttpPort({ [HTTP_PORT_ENV]: '9100' }, true)).toEqual({ port: 9100, allowFallback: false });
  });

  it('treats 0 as an explicit request for an ephemeral port', () => {
    // What tests/e2e/support/launch.ts sets: never a well-known port, and
    // never walked onto one either.
    expect(resolveHttpPort({ [HTTP_PORT_ENV]: '0' }, false)).toEqual({ port: 0, allowFallback: false });
    expect(resolveHttpPort({ [HTTP_PORT_ENV]: '0' }, true)).toEqual({ port: 0, allowFallback: false });
  });

  it('tolerates surrounding whitespace', () => {
    expect(resolveHttpPort({ [HTTP_PORT_ENV]: ' 8080 ' }, false)).toEqual({ port: 8080, allowFallback: false });
  });

  it.each(['', '   ', 'abc', '80.5', '-1', '0x1f', '65536', '99999'])(
    'falls back to the default for the unusable value %j',
    (value) => {
      expect(resolveHttpPort({ [HTTP_PORT_ENV]: value }, false)).toEqual({
        port: DEFAULT_HTTP_PORT_PROD,
        allowFallback: true,
      });
    },
  );

  it('reads only from the env it is handed', () => {
    const prev = process.env[HTTP_PORT_ENV];
    process.env[HTTP_PORT_ENV] = '1234';
    try {
      expect(resolveHttpPort({}, false).port).toBe(DEFAULT_HTTP_PORT_PROD);
    } finally {
      if (prev === undefined) delete process.env[HTTP_PORT_ENV];
      else process.env[HTTP_PORT_ENV] = prev;
    }
  });

  it('keeps the dev and prod namespaces disjoint', () => {
    expect(resolveHttpPort({}, true).port).not.toBe(resolveHttpPort({}, false).port);
  });
});
