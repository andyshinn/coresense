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
      const field = element.fields.find((f) => f.name === key);
      return field ? { kind: 'array', length: 1, element: field.node } : null;
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

function checkFilterKeys(eng: Liquid, template: string, root: StructureNode): MacroWarning[] {
  let templates: ReturnType<Liquid['parse']>;
  try {
    templates = eng.parse(template);
  } catch {
    return [];
  }
  const out: MacroWarning[] = [];
  for (const tpl of templates) {
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
          const available = element.fields.map((f) => f.name);
          if (!available.includes(quoted.key)) {
            out.push(warn(quoted.key, available, lineCol(template, quoted.begin)));
          }
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
 * Known gaps: dynamic paths (`a[b.c]`) are skipped rather than guessed at;
 * filters inside {% %} tags are not walked; a key present on only some array
 * elements is accepted; an empty sample array disables checking below it.
 */
export function lintTemplate(template: string): MacroWarning[] {
  const eng = engine();
  const root = structureOf(buildSampleContext());
  return [...checkVariablePaths(eng, template, root), ...checkFilterKeys(eng, template, root)];
}
