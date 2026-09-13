import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// Elements we hand to maplibre's `Marker({ element })`. maplibre owns their
// `position` (.maplibregl-marker), writes `transform` inline on every move and
// `opacity` inline on every update, so a stylesheet rule setting those on a
// marker root is either silently overridden (a fade or hover scale that never
// shows) or actively harmful (`transition: transform` makes the marker trail
// the map while panning). A CSS animation on them is worse still: it beats the
// inline transform and snaps the marker to the map's top-left corner. BEM
// modifiers (`--spider`) are root classes too; `__element` children are not.
const MARKER_ROOT = /\.cs-map-(marker|cluster|site|local|spider-disc|spider-center)(?:--[\w-]+)?(?![\w-])/;
const OWNED_BY_MAPLIBRE = new Set(['position', 'transform', 'translate', 'scale', 'rotate', 'opacity']);

interface Decl {
  selector: string;
  property: string;
  value: string;
}

function rootDeclarations(css: string): Decl[] {
  const out: Decl[] = [];
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '');
  for (const [, selectorList, body] of stripped.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    for (const raw of selectorList.split(',')) {
      const selector = raw.trim();
      // The subject is the last compound selector: `.cs-map-marker .x` styles
      // the child, `.cs-map-cluster:hover > svg` styles the svg.
      const subject = selector.split(/\s*[\s>+~]\s*/).pop() ?? '';
      if (!MARKER_ROOT.test(subject)) continue;
      for (const decl of body.split(';')) {
        const idx = decl.indexOf(':');
        if (idx === -1) continue;
        out.push({ selector, property: decl.slice(0, idx).trim().toLowerCase(), value: decl.slice(idx + 1).trim() });
      }
    }
  }
  return out;
}

describe('map.css marker roots', () => {
  const css = readFileSync(path.resolve(__dirname, '../../../../src/renderer/styles/map.css'), 'utf8');
  const decls = rootDeclarations(css);

  it('finds the marker root rules (guards against the parser matching nothing)', () => {
    const selectors = new Set(decls.map((d) => d.selector));
    expect(selectors).toContain('.cs-map-marker');
    expect(selectors).toContain('.cs-map-cluster');
    expect(selectors).toContain('.cs-map-local');
    expect(selectors).toContain('.cs-map-marker.cs-map-marker--spider');
    expect(selectors).toContain('.maplibregl-marker.cs-map-marker');
    expect(selectors).not.toContain('.cs-map-marker .cs-map-marker__label');
  });

  it("never sets or animates position, transform or opacity on an element maplibre's Marker positions", () => {
    const offending = decls.filter(
      (d) =>
        OWNED_BY_MAPLIBRE.has(d.property) ||
        d.property.startsWith('animation') ||
        (d.property.startsWith('transition') && /\b(transform|opacity|all)\b/.test(d.value)),
    );
    expect(offending).toEqual([]);
  });

  it('qualifies root transitions with .maplibregl-marker so they beat its own', () => {
    // maplibre-gl.css sets `.maplibregl-marker { transition: opacity .2s }` and
    // loads after map.css, so an equal-specificity root transition never runs.
    const unqualified = decls.filter(
      (d) => d.property.startsWith('transition') && !d.selector.includes('.maplibregl-marker'),
    );
    expect(unqualified).toEqual([]);
  });
});
