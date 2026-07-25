import type { Liquid } from 'liquidjs';
import { createMacroEngine, renderTemplate } from '../../shared/macros';
import type { DistanceUnit, MacroContext, RenderOptions, RenderResult } from '../../shared/macros/types';
import { settingsStore } from '../storage/settings';
import { macrosStore } from './store';

let cached: { unit: DistanceUnit; engine: Liquid } | null = null;

function engineForUnit(unit: DistanceUnit): Liquid {
  if (!cached || cached.unit !== unit) cached = { unit, engine: createMacroEngine({ defaultDistanceUnit: unit }) };
  return cached.engine;
}

export function renderMacro(idOrTemplate: string, context: MacroContext, opts?: RenderOptions): RenderResult {
  const macro = macrosStore.list().find((m) => m.id === idOrTemplate);
  const template = macro ? macro.template : idOrTemplate;
  const unit = settingsStore.loadAppSettings().distanceUnit;
  const engine = engineForUnit(unit);
  return renderTemplate(engine, template, context as unknown as Record<string, unknown>, opts);
}
