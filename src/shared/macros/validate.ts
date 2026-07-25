import type { Liquid } from 'liquidjs';
import { createMacroEngine, DEFAULT_RENDER_LIMIT } from './engine';
import { buildSampleContext } from './manifest';
import { classifyParseError, classifyRenderError } from './render';
import type { ValidateResult } from './types';

let cached: Liquid | null = null;
function engine(): Liquid {
  if (!cached) cached = createMacroEngine({ defaultDistanceUnit: 'metric' });
  return cached;
}

export function validateTemplate(template: string): ValidateResult {
  const eng = engine();
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
