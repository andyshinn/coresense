import type { MacroTemplate } from '../../../shared/macros/types';
import type { UsageMap } from '../../../shared/types';
import { score } from './frecency';

/** Macros valid for one conversation: `global` everywhere, `channel`/`contact`
 *  only on the conversation their key names. A scoped macro with no key is
 *  unroutable and therefore shown nowhere. */
export function applicableMacros(macros: MacroTemplate[], conversationKey: string): MacroTemplate[] {
  return macros.filter((m) => {
    if (m.scope === 'channel') return m.channelKey === conversationKey;
    if (m.scope === 'contact') return m.contactKey === conversationKey;
    return true;
  });
}

/** The n most-frecent macros. Array#sort is stable, so never-used macros (all
 *  scoring 0) keep their store order — "most-frecent, else the first n" falls
 *  out of the one sort, with no separate seed list. */
export function topMacros(macros: MacroTemplate[], usage: UsageMap, nowMs: number, n: number): MacroTemplate[] {
  return [...macros].sort((a, b) => score(usage[b.id], nowMs) - score(usage[a.id], nowMs)).slice(0, n);
}
