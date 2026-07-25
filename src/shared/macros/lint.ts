import { type Liquid, type Token, TypeGuards } from 'liquidjs';
import { createMacroEngine } from './engine';
import { buildSampleContext } from './manifest';
import { fieldsAt, type PathSegment, resolvePath, type StructureNode, structureOf } from './structure';

export interface MacroWarning {
  kind: 'unknown-property';
  message: string;
  /** The offending path or filter key, e.g. 'paths.first.hops.pk' or 'pubkey'. */
  name: string;
  suggestion?: string;
  line?: number;
  col?: number;
}

// Same lazy cached engine as validate.ts. It must be createMacroEngine, not a
// bare Liquid: strictFilters makes `parse` throw on distance/bearing/unit.
let cached: Liquid | null = null;
function engine(): Liquid {
  if (!cached) cached = createMacroEngine({ defaultDistanceUnit: 'metric' });
  return cached;
}

/** Filters whose first quoted argument names a property of the piped-in array's
 *  element. sort / sort_natural / sum take it optionally. */
const PROPERTY_FILTERS = new Set(['map', 'where', 'sort', 'sort_natural', 'group_by', 'sum']);

/** Guesses edit distance cannot reach. Consulted before Levenshtein — the
 *  headline case is lev('pubkey','pk') = 4, further than 'kind' or 'name'. */
const ALIASES: Record<string, string> = {
  pubkey: 'pk',
  public_key: 'pk',
  publickey: 'pk',
  key: 'pk',
  hash: 'short_id',
  prefix: 'short_id',
  shortid: 'short_id',
  short: 'short_id',
  label: 'name',
  callsign: 'name',
};

function levenshtein(a: string, b: string): number {
  const rows = a.length + 1;
  const cols = b.length + 1;
  let prev = Array.from({ length: cols }, (_, j) => j);
  for (let i = 1; i < rows; i++) {
    const curr = [i, ...Array<number>(cols - 1).fill(0)];
    for (let j = 1; j < cols; j++) {
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = curr;
  }
  return prev[cols - 1];
}

function suggest(bad: string, available: string[]): string | undefined {
  const alias = ALIASES[bad.toLowerCase()];
  if (alias && available.includes(alias)) return alias;
  let best: string | undefined;
  let bestDistance = 3; // bounded: only near-misses
  for (const candidate of available) {
    const d = levenshtein(bad.toLowerCase(), candidate.toLowerCase());
    if (d < bestDistance) {
      bestDistance = d;
      best = candidate;
    }
  }
  return best;
}

function warn(name: string, available: string[], where?: { line: number; col: number }): MacroWarning {
  const suggestion = suggest(name, available);
  const known = available.length > 0 ? ` (${available.join(', ')})` : '';
  const hint = suggestion ? ` Did you mean ${suggestion}?` : '';
  return {
    kind: 'unknown-property',
    name,
    message: `no such property "${name}".${hint}${known}`,
    ...(suggestion ? { suggestion } : {}),
    ...(where ?? {}),
  };
}

/** 1-based line/col for a whole-template character offset. */
function lineCol(template: string, offset: number): { line: number; col: number } {
  const before = template.slice(0, offset);
  const line = before.split('\n').length;
  const col = offset - (before.lastIndexOf('\n') + 1) + 1;
  return { line, col };
}

// ---------------------------------------------------------------- check (a)

function checkVariablePaths(eng: Liquid, template: string, root: StructureNode): MacroWarning[] {
  let segments: PathSegment[][];
  try {
    // globalVariableSegmentsSync, NOT variableSegmentsSync: the plain variant
    // also returns {% assign %} locals, {% for %} loop variables and `forloop`.
    segments = eng.globalVariableSegmentsSync(template) as PathSegment[][];
  } catch {
    return [];
  }
  const out: MacroWarning[] = [];
  for (const path of segments) {
    const r = resolvePath(root, path);
    if (r.ok || r.reason !== 'missing') continue;
    const bad = path[r.failedAt];
    if (typeof bad !== 'string') continue;
    const available = fieldsAt(root, path.slice(0, r.failedAt)) ?? [];
    const full = path.slice(0, r.failedAt + 1).join('.');
    const base = warn(bad, available);
    out.push({ ...base, name: full, message: `${full} — ${base.message}` });
  }
  return out;
}

// ---------------------------------------------------------------- check (b)

/** The parse-tree slices this walker reads. liquidjs types `Output.value` loosely,
 *  so these mirror the verified runtime shape. */
interface ParsedFilter {
  name: string;
  /** Positional tokens, plus `[key, Token]` pairs for keyword args. */
  args: (Token | [string, Token])[];
}

interface ParsedValue {
  initial?: { postfix?: Token[] };
  filters?: ParsedFilter[];
}

function initialSegments(value: ParsedValue): PathSegment[] | null {
  const head = value.initial?.postfix?.[0];
  // A literal head (`{{ "lit" | upcase }}`) is not a variable path — skip it.
  if (!head || !TypeGuards.isPropertyAccessToken(head)) return null;
  // props are ValueToken | IdentifierToken, both Tokens, so getText() is typed.
  // Indices arrive as numeric strings here ('0'), which resolvePath accepts.
  return head.props.map((p) => p.getText());
}

function firstQuotedArg(filter: ParsedFilter): { key: string; begin: number } | null {
  for (const arg of filter.args) {
    if (Array.isArray(arg)) continue; // keyword pair, e.g. `allow_false: true`
    if (!TypeGuards.isQuotedToken(arg)) continue;
    return { key: arg.content, begin: arg.begin };
  }
  return null;
}

/** The element shape a property-filter key is checked against. */
function elementOf(node: StructureNode | null): StructureNode | null {
  if (node?.kind !== 'array') return null;
  return node.element;
}

/** Shape transforms this design needs. Anything else returns null, which
 *  abandons check (b) for the rest of the chain rather than guessing. */
function advance(filterName: string, key: string | null, node: StructureNode | null): StructureNode | null {
  if (node === null) return null;
  switch (filterName) {
    case 'where':
    case 'reject':
    case 'sort':
    case 'sort_natural':
    case 'uniq':
    case 'compact':
    case 'reverse':
      return node;
    case 'first':
    case 'last':
      return elementOf(node);
    case 'map': {
      const element = elementOf(node);
      if (!key || element?.kind !== 'object') return null;
      // liquidjs resolves the key through _getFromScope, which splits on '.' and
      // walks it (node_modules/liquidjs/dist/liquid.node.mjs, _getFromScope) —
      // `map: "meta.snr"` reads the nested `snr` field, not a literal `meta.snr`
      // property. resolvePath does the same walk against the sample shape.
      const r = resolvePath(element, key.split('.'));
      return r.ok ? { kind: 'array', length: 1, element: r.node } : null;
    }
    case 'group_by': {
      const element = elementOf(node);
      if (!element) return null;
      return {
        kind: 'array',
        length: 1,
        element: {
          kind: 'object',
          fields: [
            { name: 'name', node: { kind: 'scalar', type: 'string' } },
            { name: 'items', node: { kind: 'array', length: 1, element } },
          ],
        },
      };
    }
    default:
      return null;
  }
}

/** Minimal shape of liquidjs's `Template` interface we need: an optional
 *  generator-returning `children()`. Block tags (If/Unless/For/Case/Capture/…)
 *  implement it; leaf nodes (Output/HTML) and some tags (Comment) do not. */
interface ChildBearing {
  children?: (...args: unknown[]) => Generator<unknown, unknown[]>;
}

/** Flattens a parse tree (top-level nodes plus everything nested inside block
 *  tags) into a single list, so filter-key checks also reach Output nodes
 *  written inside {% if %} / {% unless %} / {% for %} / {% case %} / etc.
 *
 *  Verified empirically against liquidjs (node_modules/liquidjs): for If,
 *  Unless, For and Case tags, `children()` is a generator whose body never
 *  `yield`s — it just `return`s the child Template[] — so draining it with a
 *  single `.next()` call reliably yields `{ done: true, value: Template[] }`
 *  on the first step. `children` is optional on the Template interface and
 *  some tags (e.g. CommentTag) don't implement it at all, and Include/Render
 *  need a truthy `partials` arg to do anything — called with no arguments
 *  here, those safely return `[]` rather than touching the filesystem. The
 *  try/catch is a last-resort guard so a tag type behaving unexpectedly can
 *  never make lintTemplate throw. */
function flattenTemplates(templates: readonly unknown[]): unknown[] {
  const out: unknown[] = [];
  const stack = [...templates];
  while (stack.length > 0) {
    const tpl = stack.shift();
    out.push(tpl);
    const childrenFn = (tpl as ChildBearing | undefined)?.children;
    if (typeof childrenFn !== 'function') continue;
    try {
      const gen = childrenFn.call(tpl);
      let step = gen.next();
      while (!step.done) step = gen.next();
      if (Array.isArray(step.value)) stack.push(...step.value);
    } catch {
      // A tag whose children() needs args we didn't provide, or that throws
      // for any other reason, is simply not walked further.
    }
  }
  return out;
}

function checkFilterKeys(eng: Liquid, template: string, root: StructureNode): MacroWarning[] {
  let templates: ReturnType<Liquid['parse']>;
  try {
    templates = eng.parse(template);
  } catch {
    return [];
  }
  const out: MacroWarning[] = [];
  for (const tpl of flattenTemplates(templates)) {
    const value = (tpl as unknown as { value?: ParsedValue }).value;
    if (!value || !Array.isArray(value.filters)) continue;
    const segments = initialSegments(value);
    if (!segments) continue;
    const start = resolvePath(root, segments);
    if (!start.ok) continue; // check (a) reports it, or the sample cannot tell
    let node: StructureNode | null = start.node;
    for (const filter of value.filters) {
      const quoted = firstQuotedArg(filter);
      if (PROPERTY_FILTERS.has(filter.name) && quoted) {
        const element = elementOf(node);
        if (element?.kind === 'object') {
          // The quoted key is a dotted PATH against the element shape (liquidjs
          // splits it on '.' via _getFromScope / readScopeValue), not a single
          // flat property name — walk it with resolvePath the same way
          // checkVariablePaths walks a variable path, rather than a flat
          // includes() that only ever checked the first segment.
          const segments = quoted.key.split('.');
          const r = resolvePath(element, segments);
          if (!r.ok && r.reason === 'missing') {
            const badSegment = segments[r.failedAt];
            const available = fieldsAt(element, segments.slice(0, r.failedAt)) ?? [];
            const base = warn(badSegment, available, lineCol(template, quoted.begin));
            out.push({ ...base, name: quoted.key, message: `${quoted.key} — ${base.message}` });
          }
          // 'empty-sample' and 'dynamic' stay silent — the sample can't tell,
          // same as checkVariablePaths.
        }
      }
      node = advance(filter.name, quoted?.key ?? null, node);
      if (node === null) break;
    }
  }
  return out;
}

/**
 * Non-blocking property check for a macro template, against the reply sample.
 *
 * Deliberately mirrors validateTemplate(template) and takes no context: linting
 * against sendContext() (where `paths` is []) would flag the manifest's own
 * flagship example the moment the author toggled the preview.
 *
 * Known gaps: dynamic paths (`a[b.c]`) are skipped rather than guessed at; a
 * filter key resolved through a {% for %} loop-local head (e.g. `p.hops`
 * inside `{% for p in paths %}`) is not checked, because the loop-local isn't
 * a path the sample root can resolve; a key present on only some array
 * elements is accepted; an empty sample array disables checking below it.
 */
export function lintTemplate(template: string): MacroWarning[] {
  const eng = engine();
  const root = structureOf(buildSampleContext());
  return [...checkVariablePaths(eng, template, root), ...checkFilterKeys(eng, template, root)];
}
