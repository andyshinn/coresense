import { forwardRef, useEffect, useImperativeHandle, useMemo, useState } from 'react';
import type { ApiClient } from '@/lib/api';
import { useStore } from '@/lib/store';
import { cn } from '@/lib/utils';
import type { MacroTemplate } from '../../../../shared/macros/types';
import { Snippet } from '../components/chips';
import { filterMacros } from '../lib/filterMacros';
import { expandMacro } from '../lib/inchat';

export interface ComposerMacroPopoverHandle {
  /** Move the highlighted item; wraps around. */
  move: (dir: 1 | -1) => void;
  /** Expand the highlighted macro into the composer. */
  choose: () => void;
  /** Number of matching macros. */
  count: number;
}

interface ComposerMacroPopoverProps {
  /** Text typed after the leading `/`. */
  query: string;
  client: ApiClient | null;
  /** The conversation key the composer targets (`ch:…` / `c:…`). */
  targetKey?: string;
  /** Called with the rendered text to drop into the composer. */
  onExpand: (text: string) => void;
  onClose: () => void;
}

/** Slash-command macro picker shown above the composer. Selecting a macro
 *  expands it to plain text (send context) and replaces the composer input. */
export const ComposerMacroPopover = forwardRef<ComposerMacroPopoverHandle, ComposerMacroPopoverProps>(
  function ComposerMacroPopover({ query, client, targetKey, onExpand, onClose }, ref) {
    const macros = useStore((s) => s.macros);
    const items = useMemo(() => filterMacros(macros, query, 'all'), [macros, query]);
    const [sel, setSel] = useState(0);

    // Keep the highlight in range as the query narrows the list.
    useEffect(() => {
      setSel((s) => (items.length === 0 ? 0 : Math.min(s, items.length - 1)));
    }, [items.length]);

    const choose = async (macro: MacroTemplate) => {
      const text = await expandMacro(client, macro, targetKey);
      if (text != null) onExpand(text);
      onClose();
    };

    // biome-ignore lint/correctness/useExhaustiveDependencies: choose closes over items/sel, which are the listed deps
    useImperativeHandle(
      ref,
      () => ({
        move: (dir) => setSel((s) => (items.length === 0 ? 0 : (s + dir + items.length) % items.length)),
        choose: () => {
          const macro = items[sel];
          if (macro) void choose(macro);
        },
        count: items.length,
      }),
      [items, sel],
    );

    return (
      <div className="absolute bottom-full left-0 z-50 mb-1 w-full max-w-md overflow-hidden rounded-lg border border-cs-border-strong bg-cs-bg-2 shadow-xl">
        <div className="flex items-center justify-between border-b border-cs-border px-3 py-1.5">
          <span className="font-mono text-[10px] uppercase tracking-wider text-cs-text-dim">Macros</span>
          <span className="font-mono text-[10px] text-cs-text-dim">↑↓ · ⏎ insert · esc</span>
        </div>
        {items.length === 0 ? (
          <div className="px-3 py-3 text-[12px] text-cs-text-dim">No macros match.</div>
        ) : (
          <div className="max-h-64 overflow-y-auto py-1">
            {items.map((m, i) => (
              <button
                key={m.id}
                type="button"
                onMouseEnter={() => setSel(i)}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => void choose(m)}
                className={cn(
                  'flex w-full flex-col items-start gap-0.5 px-3 py-1.5 text-left transition-colors',
                  i === sel ? 'bg-cs-bg-3' : 'hover:bg-cs-bg-3',
                )}
              >
                <span className="text-[12.5px] font-medium text-cs-text">{m.name}</span>
                <Snippet template={m.template} className="block w-full truncate text-[11px]" />
              </button>
            ))}
          </div>
        )}
      </div>
    );
  },
);
