import type { Liquid } from 'liquidjs';
import { createMacroEngine, renderTemplate } from '../../../../shared/macros';
import type { DistanceUnit, MacroContext } from '../../../../shared/macros/types';

/** MeshCore text-frame character budget. */
export const MSG_LIMIT = 132;

const WARN_FRACTION = 0.85;

export type BudgetStatus = 'ok' | 'warn' | 'over';

/** Classify a rendered length against the budget: green under 85%, amber from
 *  85% up to the limit, red past it. */
export function budgetStatus(length: number, limit: number = MSG_LIMIT): BudgetStatus {
  if (length > limit) return 'over';
  if (length >= limit * WARN_FRACTION) return 'warn';
  return 'ok';
}

export interface PreviewResult {
  /** Rendered text, or null when the template failed to render. */
  text: string | null;
  /** Rendered character length, or null on error. */
  length: number | null;
  /** Error message when rendering failed. */
  error: string | null;
}

/** Render a template against a sample context using the real shared engine. */
export function renderPreview(engine: Liquid, template: string, context: MacroContext): PreviewResult {
  const res = renderTemplate(engine, template, context as unknown as Record<string, unknown>, { placeholder: '?' });
  if (res.ok) return { text: res.text, length: res.text.length, error: null };
  return { text: null, length: null, error: res.error.message };
}

/** Build a Liquid engine for the renderer's preview, honouring the user's
 *  distance-unit preference. */
export function previewEngine(unit: DistanceUnit): Liquid {
  return createMacroEngine({ defaultDistanceUnit: unit });
}
