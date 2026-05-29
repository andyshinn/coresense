import { randomUUID } from 'node:crypto';
import { compileRuleRegex } from '../../shared/blocking/match';
import type { BlockRule } from '../../shared/types';
import { child } from '../log';
import { settingsStore } from '../storage/settings';

const log = child('blocking');

/** ms between counter flushes to disk. Counters live in memory; this is just
 *  the persistence cadence. */
const COUNTER_FLUSH_DEBOUNCE_MS = 30_000;

class BlockingStore {
  private rules: BlockRule[] = [];
  private regexCache = new Map<string, RegExp>();
  /** Rule ids whose regex source failed to compile. The matcher treats them
   *  as disabled; the UI surfaces them as "invalid". */
  private invalidRegexIds = new Set<string>();
  private counterDirty = false;
  private flushTimer: NodeJS.Timeout | null = null;

  load(): void {
    this.rules = settingsStore.loadBlockRules();
    this.sortByCreatedAt();
    this.rebuildRegexCache();
  }

  private sortByCreatedAt(): void {
    this.rules.sort((a, b) => a.createdAt - b.createdAt);
  }

  private rebuildRegexCache(): void {
    this.regexCache.clear();
    this.invalidRegexIds.clear();
    for (const r of this.rules) {
      if (r.type !== 'nameRegex') continue;
      const compiled = compileRuleRegex(r.pattern);
      if (compiled) {
        this.regexCache.set(r.id, compiled);
      } else {
        this.invalidRegexIds.add(r.id);
        log.warn(`block rule ${r.id} has invalid regex source; treating as disabled`);
      }
    }
  }

  /** Snapshot the rule list. Returned array is a shallow copy so callers
   *  can pass it to the matcher without worrying about live mutation. */
  list(): BlockRule[] {
    return this.rules.slice();
  }

  regexFor(ruleId: string): RegExp | undefined {
    return this.regexCache.get(ruleId);
  }

  regexCacheRef(): Map<string, RegExp> {
    return this.regexCache;
  }

  isInvalidRegex(ruleId: string): boolean {
    return this.invalidRegexIds.has(ruleId);
  }

  /** Append the given rules with fresh ids + createdAt. Persists immediately.
   *  Returns the inserted rules so callers can echo them back over the wire. */
  addMany(partials: Array<Omit<BlockRule, 'id' | 'createdAt' | 'matchCount'>>): BlockRule[] {
    const now = Date.now();
    const inserted: BlockRule[] = partials.map((p) => ({
      ...p,
      id: randomUUID(),
      createdAt: now,
      matchCount: 0,
    }));
    this.rules = [...this.rules, ...inserted];
    this.sortByCreatedAt();
    this.rebuildRegexCache();
    settingsStore.saveBlockRules(this.rules);
    return inserted;
  }

  update(id: string, patch: Partial<Omit<BlockRule, 'id' | 'createdAt'>>): BlockRule | null {
    const idx = this.rules.findIndex((r) => r.id === id);
    if (idx === -1) return null;
    const merged: BlockRule = { ...this.rules[idx], ...patch };
    this.rules[idx] = merged;
    this.rebuildRegexCache();
    settingsStore.saveBlockRules(this.rules);
    return merged;
  }

  remove(id: string): boolean {
    const next = this.rules.filter((r) => r.id !== id);
    if (next.length === this.rules.length) return false;
    this.rules = next;
    this.rebuildRegexCache();
    settingsStore.saveBlockRules(this.rules);
    return true;
  }

  /** Increment matchCount for `ruleId`. Debounced flush — counter changes
   *  don't write to disk until the timer fires or `flushNow` is called. */
  bumpMatchCount(ruleId: string): BlockRule | null {
    const idx = this.rules.findIndex((r) => r.id === ruleId);
    if (idx === -1) return null;
    this.rules[idx] = { ...this.rules[idx], matchCount: this.rules[idx].matchCount + 1 };
    this.counterDirty = true;
    if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => this.flushNow(), COUNTER_FLUSH_DEBOUNCE_MS);
    }
    return this.rules[idx];
  }

  /** Persist the current rule list now (used by app-quit). */
  flushNow(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    if (!this.counterDirty) return;
    this.counterDirty = false;
    settingsStore.saveBlockRules(this.rules);
  }
}

let instance: BlockingStore | null = null;

export function blockingStore(): BlockingStore {
  if (!instance) {
    instance = new BlockingStore();
    instance.load();
  }
  return instance;
}
