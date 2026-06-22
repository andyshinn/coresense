import type { Liquid } from 'liquidjs';
import { DEFAULT_RENDER_LIMIT } from './engine';
import { PlaceholderDrop } from './placeholder';
import type { MacroError, RenderOptions, RenderResult } from './types';

function wrapScope(context: Record<string, unknown>, placeholder: string): Record<string, unknown> {
  const ph = new PlaceholderDrop(placeholder);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(context)) out[k] = v === null || v === undefined ? ph : v;
  return out;
}

function nameFromMessage(msg: string): string | undefined {
  const m = msg.match(/:\s*([^\s]+)\s*$/);
  return m ? m[1] : undefined;
}

function lineCol(e: unknown): { line?: number; col?: number } {
  const t = (e as { token?: { line?: number; col?: number } }).token;
  return { line: t?.line, col: t?.col };
}

export function classifyParseError(e: unknown): MacroError {
  return { kind: 'parse', message: (e as Error).message, ...lineCol(e) };
}

export function classifyRenderError(e: unknown, elapsedMs: number, limit: number): MacroError {
  const message = (e as Error).message ?? String(e);
  const low = message.toLowerCase();
  if (low.includes('undefined filter')) return { kind: 'unknown-filter', message, name: nameFromMessage(message) };
  if (low.includes('undefined variable')) return { kind: 'unknown-variable', message, name: nameFromMessage(message) };
  if (low.includes('limit') || elapsedMs >= limit) return { kind: 'timeout', message };
  return { kind: 'render', message };
}

export function renderTemplate(
  engine: Liquid,
  template: string,
  context: Record<string, unknown>,
  opts: RenderOptions = {},
): RenderResult {
  const placeholder = opts.placeholder ?? '?';
  let templates: ReturnType<Liquid['parse']>;
  try {
    templates = engine.parse(template);
  } catch (e) {
    return { ok: false, error: classifyParseError(e) };
  }
  const limit = opts.renderLimit ?? DEFAULT_RENDER_LIMIT;
  const renderOpts = opts.renderLimit != null ? { renderLimit: opts.renderLimit } : {};
  const scope = wrapScope(context, placeholder);
  const start = Date.now();
  try {
    const text = engine.renderSync(templates, scope, renderOpts);
    return { ok: true, text };
  } catch (e) {
    return { ok: false, error: classifyRenderError(e, Date.now() - start, limit) };
  }
}
