import { Zap } from 'lucide-react';
import { useState } from 'react';
import type { ApiClient } from '@/lib/api';
import { useStore } from '@/lib/store';
import { cn } from '@/lib/utils';
import type { Message } from '../../../../shared/types';
import { Snippet } from '../components/chips';
import { sendMacroReply } from '../lib/inchat';

interface QuickReplyMenuProps {
  message: Message;
  client: ApiClient | null;
}

/** Hover action on a received message — pick a macro and send it, rendered
 *  against that message's reply context. */
export function QuickReplyMenu({ message, client }: QuickReplyMenuProps) {
  const macros = useStore((s) => s.macros);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const choose = async (macroId: string) => {
    const macro = macros.find((m) => m.id === macroId);
    if (!macro || busy) return;
    setBusy(true);
    const ok = await sendMacroReply(client, macro, message);
    setBusy(false);
    if (ok) setOpen(false);
  };

  return (
    <div className="relative">
      <button
        type="button"
        aria-label="Quick reply with macro"
        title="Quick reply with macro"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        className="flex h-5 w-5 items-center justify-center rounded text-cs-text-dim opacity-0 transition-opacity hover:bg-cs-bg-3 hover:text-cs-accent group-hover:opacity-100 focus:opacity-100"
      >
        <Zap size={11} aria-hidden="true" />
      </button>
      {open && (
        <>
          <button
            type="button"
            aria-label="Close quick reply menu"
            className="fixed inset-0 z-40 cursor-default"
            onClick={(e) => {
              e.stopPropagation();
              setOpen(false);
            }}
          />
          <div className="absolute left-6 top-0 z-50 w-72 overflow-hidden rounded-lg border border-cs-border-strong bg-cs-bg-2 shadow-xl">
            <div className="border-b border-cs-border px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider text-cs-text-dim">
              Quick reply
            </div>
            {macros.length === 0 ? (
              <div className="px-3 py-3 text-[12px] text-cs-text-dim">No macros yet — create one in the Macros tool.</div>
            ) : (
              <div className="max-h-64 overflow-y-auto py-1">
                {macros.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    disabled={busy}
                    onClick={(e) => {
                      e.stopPropagation();
                      void choose(m.id);
                    }}
                    className={cn(
                      'flex w-full flex-col items-start gap-0.5 px-3 py-1.5 text-left transition-colors hover:bg-cs-bg-3 disabled:opacity-50',
                    )}
                  >
                    <span className="text-[12.5px] font-medium text-cs-text">{m.name}</span>
                    <Snippet template={m.template} className="block w-full truncate text-[11px]" />
                  </button>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
