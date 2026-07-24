// A focused tokenizer for MeshCore macro templates: literal text interleaved
// with `{{ variable | filter: arg | … }}` output tags and `{% if/for/assign/… %}`
// block tags. Block tags are painted too, and — importantly — contribute
// variable roots, so `deriveMacroMode` sees a reply-only variable even when it
// only appears inside a `{% if %}`. Names a template introduces itself
// (`{% assign X = … %}`, `{% for X in … %}`, `{% capture X %}`) are treated as
// locals: collected up front into one flat `Set` across the whole template
// (not block-scoped — macros are capped at 132 characters, so a scope stack
// buys nothing real here), then excluded from both `varRoots` and
// unknown-variable errors when painting.
//
// Why a bespoke tokenizer when the app already has a real LiquidJS engine:
// LiquidJS renders and validates, but it cannot hand back per-character token
// runs, which the editor overlay needs to paint syntax colours. This module
// produces those runs (plus the distinct variable roots a template references,
// used to derive a macro's reply/send applicability).
//
// Authoritative validation (unknown filters, parse limits) stays with the
// shared `validateTemplate`; this tokenizer is deliberately lenient about
// filter names it doesn't recognise (it assumes a standard LiquidJS filter and
// colours it as such rather than erroring).

export type TokenType =
  | 'text'
  | 'delim'
  | 'variable'
  | 'unavail'
  | 'filter'
  | 'custom'
  | 'string'
  | 'number'
  | 'tag'
  | 'error';

export interface TokenRun {
  text: string;
  type: TokenType;
}

export type LintSeverity = 'error' | 'warn';
export type LintKind = 'syntax' | 'unknown-var' | 'unavailable';

export interface LintError {
  severity: LintSeverity;
  kind: LintKind;
  message: string;
  name?: string;
}

export interface MacroCatalog {
  /** Every known variable root (the segment before any dot). */
  variableNames: ReadonlySet<string>;
  /** Known variables that only resolve when replying to a message. */
  replyOnlyNames: ReadonlySet<string>;
  /** MeshCore custom filters, painted distinctly from standard ones. */
  customFilterNames: ReadonlySet<string>;
}

export type PreviewMode = 'reply' | 'send';

export interface TokenizeResult {
  /** Runs tile the entire source string exactly, in order. */
  runs: TokenRun[];
  /** Deduplicated lint findings. */
  errors: LintError[];
  /** Distinct known-variable roots referenced, in first-seen order. */
  varRoots: string[];
}

type LexTok = {
  t: 'pipe' | 'colon' | 'comma' | 'string' | 'ident' | 'number' | 'bad';
  v: string;
  start: number;
  end: number;
};

const WS = /\s/;
const ID_START = /[a-zA-Z_]/;
const ID_PART = /[a-zA-Z0-9_.]/;

/** Lex a single tag's inner text into tokens with absolute offsets. */
function lex(inner: string, base: number): LexTok[] {
  const toks: LexTok[] = [];
  let i = 0;
  while (i < inner.length) {
    const c = inner[i];
    if (WS.test(c)) {
      i++;
      continue;
    }
    const start = base + i;
    if (c === '|') {
      toks.push({ t: 'pipe', v: c, start, end: start + 1 });
      i++;
      continue;
    }
    if (c === ':') {
      toks.push({ t: 'colon', v: c, start, end: start + 1 });
      i++;
      continue;
    }
    if (c === ',') {
      toks.push({ t: 'comma', v: c, start, end: start + 1 });
      i++;
      continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < inner.length && inner[j] !== c) j++;
      const end = base + Math.min(j + 1, inner.length);
      toks.push({ t: 'string', v: inner.slice(i, Math.min(j + 1, inner.length)), start, end });
      i = j + 1;
      continue;
    }
    if (ID_START.test(c)) {
      let j = i + 1;
      while (j < inner.length && ID_PART.test(inner[j])) j++;
      toks.push({ t: 'ident', v: inner.slice(i, j), start, end: base + j });
      i = j;
      continue;
    }
    if (/[-0-9]/.test(c)) {
      let j = i + 1;
      while (j < inner.length && /[0-9.]/.test(inner[j])) j++;
      toks.push({ t: 'number', v: inner.slice(i, j), start, end: base + j });
      i = j;
      continue;
    }
    toks.push({ t: 'bad', v: c, start, end: start + 1 });
    i++;
  }
  return toks;
}

type TagFilter = { name: LexTok; args: LexTok[] };
type TagAst = { error: { start: number; end: number; message: string } } | { primary: LexTok; filters: TagFilter[] };

/** Parse one tag's inner text. `innerStart` is the absolute index of the first
 *  character after `{{`. */
function parseTag(inner: string, innerStart: number, rawStart: number, rawEnd: number): TagAst {
  const toks = lex(inner, innerStart);
  if (!toks.length) return { error: { start: rawStart, end: rawEnd, message: 'Empty tag' } };
  let p = 0;
  const peek = () => toks[p];
  const primary = toks[p++];
  if (primary.t !== 'ident' && primary.t !== 'string' && primary.t !== 'number') {
    return { error: { start: primary.start, end: primary.end, message: `Unexpected “${primary.v}”` } };
  }
  const filters: TagFilter[] = [];
  while (p < toks.length) {
    const pipe = toks[p++];
    if (pipe.t !== 'pipe') {
      return { error: { start: pipe.start, end: pipe.end, message: `Expected “|” before “${pipe.v}”` } };
    }
    const name = toks[p++];
    if (name?.t !== 'ident') {
      return { error: { start: pipe.start, end: pipe.end, message: 'Filter name expected after “|”' } };
    }
    const args: LexTok[] = [];
    if (peek()?.t === 'colon') {
      p++; // consume colon
      while (true) {
        const a = toks[p++];
        if (!a || (a.t !== 'ident' && a.t !== 'string' && a.t !== 'number')) {
          return { error: { start: name.start, end: name.end, message: `Argument expected for “${name.v}”` } };
        }
        args.push(a);
        if (peek()?.t === 'comma') {
          p++;
          continue;
        }
        break;
      }
    }
    filters.push({ name, args });
  }
  return { primary, filters };
}

type Node =
  | { kind: 'text'; start: number; end: number }
  | { kind: 'unclosed'; start: number; end: number }
  | { kind: 'tag'; start: number; end: number; ast: TagAst }
  | { kind: 'block'; start: number; end: number; innerStart: number; inner: string };

/** Split the source into text / output-tag / block-tag / unclosed nodes. */
function scan(src: string): Node[] {
  const nodes: Node[] = [];
  let i = 0;
  const nextOpen = (from: number) => {
    const a = src.indexOf('{{', from);
    const b = src.indexOf('{%', from);
    if (a === -1) return b;
    if (b === -1) return a;
    return Math.min(a, b);
  };
  while (i < src.length) {
    if (src[i] === '{' && (src[i + 1] === '{' || src[i + 1] === '%')) {
      const isBlock = src[i + 1] === '%';
      const closer = isBlock ? '%}' : '}}';
      const close = src.indexOf(closer, i + 2);
      if (close === -1) {
        nodes.push({ kind: 'unclosed', start: i, end: src.length });
        break;
      }
      const inner = src.slice(i + 2, close);
      nodes.push(
        isBlock
          ? { kind: 'block', start: i, end: close + 2, innerStart: i + 2, inner }
          : { kind: 'tag', start: i, end: close + 2, ast: parseTag(inner, i + 2, i, close + 2) },
      );
      i = close + 2;
    } else {
      const next = nextOpen(i);
      const end = next === -1 ? src.length : next;
      nodes.push({ kind: 'text', start: i, end });
      i = end;
    }
  }
  return nodes;
}

/** Words that are Liquid syntax inside a `{% %}` tag, not variables. */
const TAG_KEYWORDS = new Set([
  'if',
  'elsif',
  'else',
  'endif',
  'unless',
  'endunless',
  'case',
  'when',
  'endcase',
  'for',
  'endfor',
  'break',
  'continue',
  'in',
  'assign',
  'capture',
  'endcapture',
  'increment',
  'decrement',
  'cycle',
  'tablerow',
  'endtablerow',
  'raw',
  'endraw',
  'comment',
  'endcomment',
  'echo',
  'liquid',
  'render',
  'include',
  'and',
  'or',
  'not',
  'contains',
  'true',
  'false',
  'nil',
  'null',
  'empty',
  'blank',
  'limit',
  'offset',
  'reversed',
  'by',
]);

/** Names a template introduces itself. Collected across the whole template
 *  before painting, because `{% for h in … %}` introduces `h` for the output
 *  tags that follow it. Flat rather than block-scoped: macros are capped at 132
 *  characters, so a scope stack buys nothing real here. */
function collectLocals(nodes: Node[]): Set<string> {
  const locals = new Set<string>();
  for (const node of nodes) {
    if (node.kind !== 'block') continue;
    const toks = lex(node.inner, node.innerStart);
    const kw = toks[0];
    if (kw?.t !== 'ident') continue;
    if (kw.v === 'for') {
      locals.add('forloop');
      if (toks[1]?.t === 'ident') locals.add(toks[1].v);
    } else if (kw.v === 'assign' || kw.v === 'capture') {
      if (toks[1]?.t === 'ident') locals.add(toks[1].v);
    } else if (kw.v === 'tablerow') {
      locals.add('tablerowloop');
      if (toks[1]?.t === 'ident') locals.add(toks[1].v);
    }
  }
  return locals;
}

export function tokenize(src: string, mode: PreviewMode, catalog: MacroCatalog): TokenizeResult {
  const type: TokenType[] = new Array(src.length).fill('text');
  const errors: LintError[] = [];
  const varRoots: string[] = [];
  const seenRoots = new Set<string>();
  const nodes = scan(src);
  const locals = collectLocals(nodes);

  const paint = (s: number, e: number, t: TokenType) => {
    for (let k = s; k < e && k < src.length; k++) type[k] = t;
  };
  const recordRoot = (name: string) => {
    const root = name.split('.')[0];
    if (!seenRoots.has(root)) {
      seenRoots.add(root);
      varRoots.push(root);
    }
  };

  // Classify an ident used in *variable* position (primary or arg).
  const paintVar = (tok: LexTok) => {
    const root = tok.v.split('.')[0];
    if (locals.has(root)) {
      paint(tok.start, tok.end, 'variable');
      return;
    }
    if (!catalog.variableNames.has(root)) {
      paint(tok.start, tok.end, 'error');
      errors.push({ severity: 'error', kind: 'unknown-var', message: `Unknown variable “${root}”`, name: tok.v });
      return;
    }
    recordRoot(tok.v);
    if (mode === 'send' && catalog.replyOnlyNames.has(root)) {
      paint(tok.start, tok.end, 'unavail');
      errors.push({
        severity: 'warn',
        kind: 'unavailable',
        message: `“${tok.v}” isn’t available when composing a new message`,
        name: tok.v,
      });
      return;
    }
    paint(tok.start, tok.end, 'variable');
  };
  const paintArg = (a: LexTok) => {
    if (a.t === 'string') paint(a.start, a.end, 'string');
    else if (a.t === 'number') paint(a.start, a.end, 'number');
    else paintVar(a);
  };

  for (const node of nodes) {
    if (node.kind === 'unclosed') {
      paint(node.start, node.end, 'error');
      const opener = src.slice(node.start, node.start + 2);
      const closer = opener === '{%' ? '%}' : '}}';
      errors.push({ severity: 'error', kind: 'syntax', message: `Unclosed “${opener}” — expected “${closer}”` });
      continue;
    }
    if (node.kind === 'block') {
      paint(node.start, node.end, 'delim');
      const toks = lex(node.inner, node.innerStart);
      for (let k = 0; k < toks.length; k++) {
        const t = toks[k];
        if (t.t === 'string') paint(t.start, t.end, 'string');
        else if (t.t === 'number') paint(t.start, t.end, 'number');
        else if (t.t === 'bad' || t.t === 'pipe' || t.t === 'colon' || t.t === 'comma') paint(t.start, t.end, 'delim');
        else if (t.t === 'ident' && (k === 0 || TAG_KEYWORDS.has(t.v))) paint(t.start, t.end, 'tag');
        else if (t.t === 'ident') paintVar(t);
      }
      continue;
    }
    if (node.kind !== 'tag') continue;
    paint(node.start, node.end, 'delim');
    const ast = node.ast;
    if ('error' in ast) {
      paint(ast.error.start, ast.error.end, 'error');
      errors.push({ severity: 'error', kind: 'syntax', message: ast.error.message });
      continue;
    }
    const pr = ast.primary;
    if (pr.t === 'string') paint(pr.start, pr.end, 'string');
    else if (pr.t === 'number') paint(pr.start, pr.end, 'number');
    else paintVar(pr);
    for (const f of ast.filters) {
      paint(f.name.start, f.name.end, catalog.customFilterNames.has(f.name.v) ? 'custom' : 'filter');
      for (const a of f.args) paintArg(a);
    }
  }

  // Coalesce per-character types into runs.
  const runs: TokenRun[] = [];
  let cur: TokenRun | null = null;
  for (let k = 0; k < src.length; k++) {
    if (cur && cur.type === type[k]) cur.text += src[k];
    else {
      cur = { text: src[k], type: type[k] };
      runs.push(cur);
    }
  }

  // Dedupe errors by kind + message.
  const seen = new Set<string>();
  const uniq = errors.filter((e) => {
    const key = `${e.kind}${e.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return { runs, errors: uniq, varRoots };
}

export interface KeyedRun extends TokenRun {
  /** Stable React key from the run's character offset (not the array index). */
  key: string;
}

/** Attach a stable key to each run, derived from its start offset, so React
 *  lists don't fall back to array-index keys. */
export function keyedRuns(runs: TokenRun[]): KeyedRun[] {
  let offset = 0;
  return runs.map((run) => {
    const keyed: KeyedRun = { ...run, key: `${offset}:${run.type}` };
    offset += run.text.length;
    return keyed;
  });
}
