// Strict-ish CSP. The renderer is served by our own Hono server in prod (so
// it shares an origin with the API and the /ws endpoint), and by Vite in dev.
// Allow ws: for WebSocket connections and the dev server's HMR. worker-src is
// 'self' only: MapLibre 6 loads its worker as a same-origin module URL and
// only launders it through a blob: when it's cross-origin.

// Protomaps glyph PBFs and sprite JSON/PNG live on protomaps.github.io.
// MapLibre fetch()es all of them (connect-src) and decodes the sprite with
// createImageBitmap. TODO: bundle these into resources/ for a fully
// offline build.
const MAP_ASSETS = 'https://protomaps.github.io';

type Directives = Record<string, string[]>;

/** Directives both builds share; the prod connect-src/script-src are the strict ones. */
const BASE: Directives = {
  'default-src': ["'self'"],
  'script-src': ["'self'"],
  'style-src': ["'self'", "'unsafe-inline'"],
  'connect-src': ["'self'", 'ws:', 'wss:', MAP_ASSETS],
  'img-src': ["'self'", 'data:', 'blob:', MAP_ASSETS],
  'font-src': ["'self'", 'data:'],
  'worker-src': ["'self'"],
};

const PROD_ONLY: Directives = {
  'object-src': ["'none'"],
  'base-uri': ["'none'"],
  'frame-ancestors': ["'none'"],
};

/** The Vite dev server needs inline/eval scripts for HMR and talks to anything. */
const DEV_OVERRIDES: Directives = {
  'script-src': ["'self'", "'unsafe-inline'", "'unsafe-eval'", 'blob:'],
  'connect-src': ['*', 'ws:', 'wss:', 'http:', 'https:', 'data:', 'blob:'],
};

/** The Content-Security-Policy header value for the renderer session. */
export function buildCsp({ dev }: { dev: boolean }): string {
  // Spreading keeps BASE's directive order; an override replaces its entry in place.
  const directives = dev ? { ...BASE, ...DEV_OVERRIDES } : { ...BASE, ...PROD_ONLY };
  return `${Object.entries(directives)
    .map(([name, sources]) => `${name} ${sources.join(' ')}`)
    .join('; ')};`;
}
