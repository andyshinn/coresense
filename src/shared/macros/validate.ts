import type { Liquid } from 'liquidjs';
import { DEFAULT_RENDER_LIMIT, getMacroEngine } from './engine';
import { buildSampleContext } from './manifest';
import { classifyParseError, classifyRenderError } from './render';
import type { ValidateResult } from './types';

export function validateTemplate(template: string): ValidateResult {
  const eng = getMacroEngine('metric');
  let templates: ReturnType<Liquid['parse']>;
  try {
    templates = eng.parse(template);
  } catch (e) {
    return { ok: false, errors: [classifyParseError(e)] };
  }
  try {
    eng.renderSync(templates, buildSampleContext() as unknown as Record<string, unknown>);
    return { ok: true };
  } catch (e) {
    return { ok: false, errors: [classifyRenderError(e, 0, DEFAULT_RENDER_LIMIT)] };
  }
}
