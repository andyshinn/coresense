import { randomUUID } from 'node:crypto';
import { validateTemplate } from '../../shared/macros';
import type { MacroError, MacroTemplate } from '../../shared/macros/types';
import { settingsStore } from '../storage/settings';

export type NewMacro = Omit<MacroTemplate, 'id' | 'createdAt' | 'updatedAt'>;

export class MacroValidationError extends Error {
  constructor(public readonly errors: MacroError[]) {
    super('invalid macro template');
    this.name = 'MacroValidationError';
  }
}

function assertValid(template: string): void {
  const v = validateTemplate(template);
  if (!v.ok) throw new MacroValidationError(v.errors);
}

// In-memory cache so reads are consistent with writes even before the async
// disk write drains (writeJson is fire-and-forget).
let cache: MacroTemplate[] | null = null;

function getCache(): MacroTemplate[] {
  if (cache === null) cache = settingsStore.loadMacros();
  return cache;
}

function setCache(next: MacroTemplate[]): void {
  cache = next;
  settingsStore.saveMacros(next);
}

export const macrosStore = {
  list(): MacroTemplate[] {
    return getCache();
  },
  add(input: NewMacro): MacroTemplate {
    assertValid(input.template);
    const now = Date.now();
    const macro: MacroTemplate = { ...input, id: randomUUID(), createdAt: now, updatedAt: now };
    setCache([...getCache(), macro]);
    return macro;
  },
  update(id: string, patch: Partial<NewMacro>): MacroTemplate | null {
    if (patch.template != null) assertValid(patch.template);
    const list = getCache();
    const idx = list.findIndex((m) => m.id === id);
    if (idx === -1) return null;
    const updated: MacroTemplate = { ...list[idx], ...patch, id, updatedAt: Date.now() };
    setCache(list.map((m, i) => (i === idx ? updated : m)));
    return updated;
  },
  remove(id: string): boolean {
    const list = getCache();
    const next = list.filter((m) => m.id !== id);
    if (next.length === list.length) return false;
    setCache(next);
    return true;
  },
};
