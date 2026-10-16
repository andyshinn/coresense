import { describe, expect, it } from 'vitest';
import { createMacroEngine } from '../../../../src/shared/macros/engine';
import { buildSampleContext } from '../../../../src/shared/macros/manifest';
import { classifyParseError, classifyRenderError, renderTemplate } from '../../../../src/shared/macros/render';

const engine = createMacroEngine({ defaultDistanceUnit: 'metric' });
const ctx = () => buildSampleContext();

describe('renderTemplate', () => {
  it('interpolates scalars', () => {
    const r = renderTemplate(engine, 'from {{ sender_name }} at {{ rssi }} dBm', ctx());
    expect(r).toEqual({ ok: true, text: 'from Alice at -95 dBm' });
  });

  it('runs a paths pipeline', () => {
    const r = renderTemplate(engine, '{{ paths | size }} path(s)', ctx());
    expect(r.ok && r.text).toBe('1 path(s)');
  });

  it('renders the placeholder for an empty value', () => {
    const c = { ...ctx(), rssi: null };
    const r = renderTemplate(engine, 'rssi={{ rssi }}', c, { placeholder: '?' });
    expect(r).toEqual({ ok: true, text: 'rssi=?' });
  });

  it('propagates the placeholder through filters when a position is empty', () => {
    const c = { ...ctx(), peer_pos: null };
    const r = renderTemplate(engine, '{{ my_pos | distance: peer_pos | unit: "km" }}', c, { placeholder: '?' });
    expect(r).toEqual({ ok: true, text: '?' });
  });

  it('errors on an unknown variable', () => {
    const r = renderTemplate(engine, '{{ sner }}', ctx());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('unknown-variable');
  });

  it('blocks prototype/inherited property access (ownPropertyOnly)', () => {
    const obj = Object.create({ leaked: 'SECRET' });
    const r = renderTemplate(engine, '{{ obj.leaked }}', { ...ctx(), obj });
    expect(r.ok ? r.text : '').not.toContain('SECRET');
  });

  it('classifies a render-limit breach as timeout', () => {
    const r = renderTemplate(
      engine,
      '{% assign s = "x" %}{% for i in (1..100000) %}{{ s | append: s | append: s }}{% endfor %}',
      ctx(),
      { renderLimit: 1 },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('timeout');
  });

  it('serialises an empty value as the placeholder under json, not the drop internals', () => {
    const c = { ...ctx(), sender_pos: null };
    const r = renderTemplate(engine, '{{ sender_pos | json }}', c, { placeholder: '?' });
    expect(r).toEqual({ ok: true, text: '"?"' });
  });

  it('keeps bare output and property access on an empty value unchanged', () => {
    const c = { ...ctx(), sender_pos: null };
    expect(renderTemplate(engine, '{{ sender_pos }}', c, { placeholder: '?' })).toEqual({ ok: true, text: '?' });
    expect(renderTemplate(engine, '{{ sender_pos.lat }}', c, { placeholder: '?' })).toEqual({ ok: true, text: '?' });
  });
});

// A thrown null/undefined used to raise a TypeError inside the classifier
// (`(e as Error).message` and lineCol's unguarded `.token`).
describe('error classification of non-Error throws', () => {
  it('classifies a thrown null or undefined instead of throwing', () => {
    expect(classifyParseError(null)).toEqual({ kind: 'parse', message: 'null' });
    expect(classifyParseError(undefined)).toEqual({ kind: 'parse', message: 'undefined' });
    expect(classifyRenderError(null, 0, 1000)).toEqual({ kind: 'render', message: 'null' });
  });

  it('keeps a thrown string as the message', () => {
    expect(classifyRenderError('boom', 0, 1000)).toEqual({ kind: 'render', message: 'boom' });
  });
});
