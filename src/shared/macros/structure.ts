import { isPlaceholder } from './placeholder';

export type ScalarType = 'string' | 'number' | 'boolean' | 'null' | 'unknown';

export type StructureNode =
  | { kind: 'scalar'; type: ScalarType; nullable?: boolean }
  | { kind: 'object'; fields: StructureField[] }
  | { kind: 'array'; length: number; element: StructureNode | null };

export interface StructureField {
  name: string;
  node: StructureNode;
  /** A displayable rendering of the sample value, when there is one. */
  sample?: string;
}

/** Mirrors liquidjs's SegmentArray: index segments arrive as numbers (from the
 *  analysis API) or numeric strings (from a parsed PropertyAccessToken), and
 *  dynamic subscripts (`a[b.c]`) as nested arrays. */
export type PathSegment = string | number | PathSegment[];

export type ResolveResult =
  | { ok: true; node: StructureNode }
  | { ok: false; reason: 'missing'; failedAt: number }
  | { ok: false; reason: 'dynamic' }
  | { ok: false; reason: 'empty-sample'; failedAt: number };

function isObjectLike(v: unknown): v is Record<string, unknown> {
  if (v === null || typeof v !== 'object') return false;
  if (Array.isArray(v) || isPlaceholder(v)) return false;
  if (v instanceof Date || v instanceof Map || v instanceof Set || v instanceof RegExp) return false;
  return true;
}

function scalarTypeOf(v: unknown): ScalarType {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'string') return 'string';
  if (typeof v === 'number') return 'number';
  if (typeof v === 'boolean') return 'boolean';
  return 'unknown';
}

function sampleOf(v: unknown): string | undefined {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'string') return JSON.stringify(v);
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return undefined;
}

export function structureOf(value: unknown): StructureNode {
  if (Array.isArray(value)) {
    return { kind: 'array', length: value.length, element: mergeAll(value.map(structureOf)) };
  }
  if (isObjectLike(value)) {
    const fields: StructureField[] = Object.entries(value).map(([name, v]) => {
      const sample = sampleOf(v);
      return sample === undefined ? { name, node: structureOf(v) } : { name, node: structureOf(v), sample };
    });
    return { kind: 'object', fields };
  }
  return { kind: 'scalar', type: scalarTypeOf(value) };
}

function mergeAll(nodes: StructureNode[]): StructureNode | null {
  if (nodes.length === 0) return null;
  return nodes.reduce(mergeNodes);
}

function mergeNodes(a: StructureNode, b: StructureNode): StructureNode {
  if (a.kind === 'object' && b.kind === 'object') {
    const byName = new Map<string, StructureField>();
    for (const f of a.fields) byName.set(f.name, f);
    for (const f of b.fields) {
      const prev = byName.get(f.name);
      if (!prev) {
        byName.set(f.name, f);
        continue;
      }
      const merged: StructureField = { name: f.name, node: mergeNodes(prev.node, f.node) };
      const sample = prev.sample ?? f.sample;
      byName.set(f.name, sample === undefined ? merged : { ...merged, sample });
    }
    return { kind: 'object', fields: [...byName.values()] };
  }
  if (a.kind === 'array' && b.kind === 'array') {
    const element = a.element && b.element ? mergeNodes(a.element, b.element) : (a.element ?? b.element);
    return { kind: 'array', length: Math.max(a.length, b.length), element };
  }
  if (a.kind === 'scalar' && b.kind === 'scalar') return mergeScalars(a, b);
  // An object merged with a null sibling stays an object; anything else mixed is
  // not describable as one shape.
  if (a.kind === 'scalar' && a.type === 'null') return b;
  if (b.kind === 'scalar' && b.type === 'null') return a;
  return { kind: 'scalar', type: 'unknown' };
}

function mergeScalars(
  a: { kind: 'scalar'; type: ScalarType; nullable?: boolean },
  b: { kind: 'scalar'; type: ScalarType; nullable?: boolean },
): StructureNode {
  const nullable = a.nullable === true || b.nullable === true;
  if (a.type === b.type) return nullable ? { kind: 'scalar', type: a.type, nullable } : { kind: 'scalar', type: a.type };
  if (a.type === 'null') return { kind: 'scalar', type: b.type, nullable: true };
  if (b.type === 'null') return { kind: 'scalar', type: a.type, nullable: true };
  return nullable ? { kind: 'scalar', type: 'unknown', nullable } : { kind: 'scalar', type: 'unknown' };
}

function asIndex(seg: string | number): number | null {
  if (typeof seg === 'number') return Number.isInteger(seg) ? seg : null;
  return /^\d+$/.test(seg) ? Number(seg) : null;
}

/** One property step. Returns the reached node, or a marker for why it failed. */
function step(node: StructureNode, seg: string | number): StructureNode | 'missing' | 'empty-sample' {
  // `size` is a Liquid pseudo-property on arrays, strings and objects alike —
  // but on an object, an own `size` field wins over the synthesized count.
  if (seg === 'size') {
    if (node.kind === 'object') {
      const own = node.fields.find((f) => f.name === 'size');
      return own ? own.node : { kind: 'scalar', type: 'number' };
    }
    if (node.kind === 'array') return { kind: 'scalar', type: 'number' };
    if (node.kind === 'scalar' && node.type === 'string') return { kind: 'scalar', type: 'number' };
    return 'missing';
  }
  if (node.kind === 'array') {
    const indexed = seg === 'first' || seg === 'last' || asIndex(seg) !== null;
    if (!indexed) return 'missing';
    return node.element ?? 'empty-sample';
  }
  if (node.kind === 'object') {
    return node.fields.find((f) => f.name === seg)?.node ?? 'missing';
  }
  return 'missing';
}

export function resolvePath(root: StructureNode, path: PathSegment[]): ResolveResult {
  let node = root;
  for (let i = 0; i < path.length; i++) {
    const seg = path[i];
    if (Array.isArray(seg)) return { ok: false, reason: 'dynamic' };
    const next = step(node, seg);
    if (next === 'missing') return { ok: false, reason: 'missing', failedAt: i };
    if (next === 'empty-sample') return { ok: false, reason: 'empty-sample', failedAt: i };
    node = next;
  }
  return { ok: true, node };
}

/** Field names reachable at a path — of the object there, or of an array's
 *  element. Null when the path doesn't resolve or lands on a scalar. */
export function fieldsAt(root: StructureNode, path: PathSegment[]): string[] | null {
  const r = resolvePath(root, path);
  if (!r.ok) return null;
  if (r.node.kind === 'object') return r.node.fields.map((f) => f.name);
  if (r.node.kind === 'array' && r.node.element?.kind === 'object') return r.node.element.fields.map((f) => f.name);
  return null;
}
