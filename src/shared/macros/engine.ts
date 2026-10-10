import { Liquid } from 'liquidjs';
import { registerMacroFilters } from './filters';
import type { DistanceUnit } from './types';

export const DEFAULT_RENDER_LIMIT = 1000;
export const DEFAULT_PARSE_LIMIT = 10000;
export const DEFAULT_MEMORY_LIMIT = 10000000;

export interface MacroEngineOptions {
  defaultDistanceUnit: DistanceUnit;
  parseLimit?: number;
  renderLimit?: number;
  memoryLimit?: number;
}

export function createMacroEngine(opts: MacroEngineOptions): Liquid {
  const engine = new Liquid({
    ownPropertyOnly: true,
    strictVariables: true,
    strictFilters: true,
    parseLimit: opts.parseLimit ?? DEFAULT_PARSE_LIMIT,
    renderLimit: opts.renderLimit ?? DEFAULT_RENDER_LIMIT,
    memoryLimit: opts.memoryLimit ?? DEFAULT_MEMORY_LIMIT,
  });
  registerMacroFilters(engine, { defaultDistanceUnit: opts.defaultDistanceUnit });
  return engine;
}

const engines = new Map<DistanceUnit, Liquid>();

/** The shared engine for a distance unit, built on first use. An engine keeps no
 *  per-render state, so validation, lint, the Studio preview and the main-process
 *  render all reuse one per unit instead of each caching its own. */
export function getMacroEngine(unit: DistanceUnit): Liquid {
  let engine = engines.get(unit);
  if (!engine) {
    engine = createMacroEngine({ defaultDistanceUnit: unit });
    engines.set(unit, engine);
  }
  return engine;
}
