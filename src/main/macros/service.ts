import { getMacroEngine, renderTemplate } from '../../shared/macros';
import type { MacroContext, RenderOptions, RenderResult } from '../../shared/macros/types';
import { settingsStore } from '../storage/settings';
import { macrosStore } from './store';

export function renderMacro(idOrTemplate: string, context: MacroContext, opts?: RenderOptions): RenderResult {
  const macro = macrosStore.list().find((m) => m.id === idOrTemplate);
  const template = macro ? macro.template : idOrTemplate;
  const engine = getMacroEngine(settingsStore.loadAppSettings().distanceUnit);
  return renderTemplate(engine, template, context, opts);
}
