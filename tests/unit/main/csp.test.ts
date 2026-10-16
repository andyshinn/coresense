import { describe, expect, it } from 'vitest';
import { buildCsp } from '../../../src/main/security/csp';

function directives(csp: string): Map<string, string> {
  return new Map(
    csp
      .split(';')
      .map((d) => d.trim())
      .filter(Boolean)
      .map((d) => {
        const [name, ...sources] = d.split(' ');
        return [name, sources.join(' ')] as const;
      }),
  );
}

describe('buildCsp', () => {
  it('pins the production policy', () => {
    expect(buildCsp({ dev: false })).toBe(
      "default-src 'self'; " +
        "script-src 'self'; " +
        "style-src 'self' 'unsafe-inline'; " +
        "connect-src 'self' ws: wss: https://protomaps.github.io; " +
        "img-src 'self' data: blob: https://protomaps.github.io; " +
        "font-src 'self' data:; " +
        "worker-src 'self'; " +
        "object-src 'none'; " +
        "base-uri 'none'; " +
        "frame-ancestors 'none';",
    );
  });

  it('keeps production scripts strict and the connect-src allowlist closed', () => {
    const prod = directives(buildCsp({ dev: false }));
    expect(buildCsp({ dev: false })).not.toContain('unsafe-eval');
    expect(prod.get('script-src')).toBe("'self'");
    expect(prod.get('object-src')).toBe("'none'");
    expect(prod.get('connect-src')).toBe("'self' ws: wss: https://protomaps.github.io");
    // MapLibre 6 must load its worker same-origin, never via blob:.
    expect(prod.get('worker-src')).toBe("'self'");
  });

  it('pins the dev-server policy', () => {
    expect(buildCsp({ dev: true })).toBe(
      "default-src 'self'; " +
        "script-src 'self' 'unsafe-inline' 'unsafe-eval' blob:; " +
        "style-src 'self' 'unsafe-inline'; " +
        'connect-src * ws: wss: http: https: data: blob:; ' +
        "img-src 'self' data: blob: https://protomaps.github.io; " +
        "font-src 'self' data:; " +
        "worker-src 'self';",
    );
  });
});
