export { createMacroEngine, getMacroEngine, type MacroEngineOptions } from './engine';
export { lintTemplate, type MacroWarning } from './lint';
export { buildSampleContext, getManifest, MACRO_FILTERS, MACRO_VARIABLES, replyOnlyVariableNames } from './manifest';
export { MACRO_PLACEHOLDER, renderTemplate } from './render';
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
