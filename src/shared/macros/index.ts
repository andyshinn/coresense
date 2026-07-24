export { createMacroEngine, type MacroEngineOptions } from './engine';
export { buildSampleContext, getManifest, MACRO_FILTERS, MACRO_VARIABLES } from './manifest';
export { renderTemplate } from './render';
export {
  fieldsAt,
  type PathSegment,
  type ResolveResult,
  resolvePath,
  type ScalarType,
  type StructureField,
  type StructureNode,
  structureOf,
} from './structure';
export * from './types';
export { validateTemplate } from './validate';
