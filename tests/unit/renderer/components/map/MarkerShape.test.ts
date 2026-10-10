import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { MarkerShape, shapeMarkup } from '../../../../../src/renderer/components/map/markers/MarkerShape';
import { CONTACT_KINDS } from '../../../../../src/shared/types';

const VARIANTS = [
  {},
  { size: 14 },
  { size: 22, opacity: 0.5, dashed: true },
  { fill: '#123456', stroke: '#abcdef', strokeWidth: 2 },
];

describe('shapeMarkup', () => {
  it('emits the marker primitives for every kind', () => {
    expect(CONTACT_KINDS.map((type) => shapeMarkup({ type }))).toMatchInlineSnapshot(`
      [
        "<circle cx="9" cy="9" r="7.5" fill="#f59e0b" stroke="#0c0a06" stroke-width="1.5" />",
        "<rect x="1.5" y="1.5" width="15" height="15" rx="3.24" fill="#84cc16" stroke="#0c0a06" stroke-width="1.5" />",
        "<polygon points="9,1.5 16.5,9 9,16.5 1.5,9" fill="#c084fc" stroke="#0c0a06" stroke-width="1.5" stroke-linejoin="round" />",
        "<polygon points="9,2.5 15.5,16.5 2.5,16.5" fill="#38bdf8" stroke="#0c0a06" stroke-width="1.5" stroke-linejoin="round" />",
      ]
    `);
    expect(CONTACT_KINDS.map((type) => shapeMarkup({ type, size: 22, opacity: 0.5, dashed: true }))).toMatchInlineSnapshot(`
      [
        "<circle cx="11" cy="11" r="9.5" fill="#f59e0b" stroke="#0c0a06" stroke-width="1.5" opacity="0.5" stroke-dasharray="2 1.5" />",
        "<rect x="1.5" y="1.5" width="19" height="19" rx="3.96" fill="#84cc16" stroke="#0c0a06" stroke-width="1.5" opacity="0.5" stroke-dasharray="2 1.5" />",
        "<polygon points="11,1.5 20.5,11 11,20.5 1.5,11" fill="#c084fc" stroke="#0c0a06" stroke-width="1.5" stroke-linejoin="round" opacity="0.5" stroke-dasharray="2 1.5" />",
        "<polygon points="11,2.5 19.5,20.5 2.5,20.5" fill="#38bdf8" stroke="#0c0a06" stroke-width="1.5" stroke-linejoin="round" opacity="0.5" stroke-dasharray="2 1.5" />",
      ]
    `);
  });
});

describe('MarkerShape', () => {
  // The legend/filter rows (React) and the map markers (HTML string) must draw
  // the same shape.
  it.each(CONTACT_KINDS.flatMap((type) => VARIANTS.map((v) => ({ type, ...v }))))(
    'renders the same primitive as shapeMarkup (%o)',
    (args) => {
      const html = renderToStaticMarkup(createElement(MarkerShape, args));
      const inner = html.replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '');
      // React closes SVG elements explicitly; the string builder self-closes.
      expect(inner).toBe(shapeMarkup(args).replace(/^<(\w+)(.*) \/>$/, '<$1$2></$1>'));
    },
  );
});
