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
