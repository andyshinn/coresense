import { describe, expect, it } from 'vitest';
import { buildSampleContext, sampleStructure } from '../../../../src/shared/macros/manifest';
import { PlaceholderDrop } from '../../../../src/shared/macros/placeholder';
import { fieldsAt, hasBrowsableChildren, resolvePath, structureOf } from '../../../../src/shared/macros/structure';

const root = () => structureOf(buildSampleContext());

describe('structureOf', () => {
  it('describes scalars with their sample value', () => {
    const n = structureOf({ a: 'hi', b: 2, c: true, d: null });
    expect(n.kind).toBe('object');
    if (n.kind !== 'object') return;
    expect(n.fields.map((f) => [f.name, f.node.kind === 'scalar' ? f.node.type : '?'])).toEqual([
      ['a', 'string'],
      ['b', 'number'],
      ['c', 'boolean'],
      ['d', 'null'],
    ]);
    expect(n.fields[0].sample).toBe('"hi"');
    expect(n.fields[1].sample).toBe('2');
  });

  it('merges array element shapes across all items so nullability survives', () => {
    const n = structureOf([{ a: 'x' }, { a: null }]);
    expect(n.kind).toBe('array');
    if (n.kind !== 'array' || n.element?.kind !== 'object') return;
    const a = n.element.fields[0].node;
    expect(a).toMatchObject({ kind: 'scalar', type: 'string', nullable: true });
  });

  it('keeps a key present on only some elements', () => {
    const n = structureOf([{ a: 1 }, { b: 2 }]);
    if (n.kind !== 'array' || n.element?.kind !== 'object') throw new Error('shape');
    expect(n.element.fields.map((f) => f.name).sort()).toEqual(['a', 'b']);
  });

  it('reports an empty array as element null', () => {
    expect(structureOf([])).toEqual({ kind: 'array', length: 0, element: null });
  });

  it('maps a PlaceholderDrop to unknown rather than an object', () => {
    expect(structureOf(new PlaceholderDrop('?'))).toEqual({ kind: 'scalar', type: 'unknown' });
  });

  it('degrades non-JSON values to unknown instead of throwing', () => {
    const n = structureOf({ d: new Date(0), r: /x/, f: () => 1 });
    if (n.kind !== 'object') throw new Error('shape');
    for (const f of n.fields) expect(f.node).toMatchObject({ kind: 'scalar', type: 'unknown' });
  });

  it('derives hop name and pk as nullable from the real sample', () => {
    const hops = resolvePath(root(), ['paths', 'first', 'hops']);
    expect(hops.ok).toBe(true);
    if (!hops.ok || hops.node.kind !== 'array' || hops.node.element?.kind !== 'object') throw new Error('shape');
    const byName = Object.fromEntries(hops.node.element.fields.map((f) => [f.name, f.node]));
    expect(byName.name).toMatchObject({ kind: 'scalar', type: 'string', nullable: true });
    expect(byName.pk).toMatchObject({ kind: 'scalar', type: 'string', nullable: true });
    expect(byName.short_id).toMatchObject({ kind: 'scalar', type: 'string' });
  });
});

describe('resolvePath', () => {
  it('walks object fields', () => {
    const r = resolvePath(root(), ['my_pos', 'lat']);
    expect(r.ok && r.node).toMatchObject({ kind: 'scalar', type: 'number' });
  });

  it('steps through first/last into the array element', () => {
    const r = resolvePath(root(), ['paths', 'first', 'hops', 'last', 'short_id']);
    expect(r.ok && r.node).toMatchObject({ kind: 'scalar', type: 'string' });
  });

  it('steps through a numeric index, as a number or a numeric string', () => {
    expect(resolvePath(root(), ['paths', 0, 'hops', 1, 'short_id']).ok).toBe(true);
    expect(resolvePath(root(), ['paths', '0', 'hops', '1', 'short_id']).ok).toBe(true);
  });

  it('resolves size on arrays, strings and objects', () => {
    for (const p of [
      ['paths', 'size'],
      ['message_body', 'size'],
      ['my_pos', 'size'],
    ]) {
      const r = resolvePath(root(), p as string[]);
      expect(r.ok && r.node).toMatchObject({ kind: 'scalar', type: 'number' });
    }
  });

  it('resolves size to the object own field when one exists, not the pseudo-count', () => {
    const r = resolvePath(structureOf({ size: 'not-a-count', other: 1 }), ['size']);
    expect(r.ok && r.node).toMatchObject({ kind: 'scalar', type: 'string' });
  });

  it('still resolves size to a number on an object without a size field', () => {
    const r = resolvePath(structureOf({ a: 1, b: 2 }), ['size']);
    expect(r.ok && r.node).toMatchObject({ kind: 'scalar', type: 'number' });
  });

  it('reports the index of the first missing segment', () => {
    const r = resolvePath(root(), ['paths', 'first', 'hops', 'first', 'nope']);
    expect(r).toEqual({ ok: false, reason: 'missing', failedAt: 4 });
  });

  it('reports a dynamic segment instead of guessing', () => {
    expect(resolvePath(root(), ['paths', ['a', 'b']])).toEqual({ ok: false, reason: 'dynamic' });
  });

  it('reports empty-sample rather than missing when an array has no elements', () => {
    const r = resolvePath(structureOf({ xs: [] }), ['xs', 'first', 'anything']);
    expect(r).toEqual({ ok: false, reason: 'empty-sample', failedAt: 1 });
  });
});

describe('fieldsAt', () => {
  it('lists the fields of an array element', () => {
    expect(fieldsAt(root(), ['paths', 'first', 'hops'])).toEqual(['kind', 'short_id', 'name', 'pk']);
  });

  it('lists the fields of an object', () => {
    expect(fieldsAt(root(), ['my_pos'])).toEqual(['lat', 'lon']);
  });

  it('returns null for a scalar or an unresolvable path', () => {
    expect(fieldsAt(root(), ['my_name'])).toBeNull();
    expect(fieldsAt(root(), ['nope'])).toBeNull();
  });
});

describe('hasBrowsableChildren', () => {
  it('is true for a non-empty object and an array with a known element', () => {
    expect(hasBrowsableChildren(structureOf({ lat: 1 }))).toBe(true);
    expect(hasBrowsableChildren(structureOf([{ a: 1 }]))).toBe(true);
  });

  it('is false for a scalar, an empty object and an empty array', () => {
    expect(hasBrowsableChildren(structureOf('x'))).toBe(false);
    expect(hasBrowsableChildren(structureOf({}))).toBe(false);
    expect(hasBrowsableChildren(structureOf([]))).toBe(false);
  });
});

describe('sampleStructure', () => {
  it('is the sample context structure, built once', () => {
    expect(sampleStructure()).toEqual(root());
    expect(sampleStructure()).toBe(sampleStructure());
  });
});
