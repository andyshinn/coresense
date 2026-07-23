import { Zap } from 'lucide-react';
import type { ReactNode } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '../../components/ui/popover';
import { SEED_MACROS } from './quickBarData';

export function MacroChip({ label }: { label: string }) {
  return (
    <button
      type="button"
      disabled
      className="inline-flex cursor-default items-center gap-1 rounded-md border border-cs-border bg-cs-bg-2 px-2 py-1 text-[11px] font-medium text-cs-text-muted opacity-70"
    >
      <span className="text-cs-accent">
        <Zap size={11} aria-hidden="true" />
      </span>
      {label}
    </button>
  );
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
}

export function MacroPanel({ open, onOpenChange, children }: Props) {
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent side="top" align="end" sideOffset={8} className="w-[244px] border-cs-border-strong bg-cs-bg-2 p-1.5">
        <div className="flex items-center gap-2 px-1.5 pb-1.5 pt-1">
          <span className="text-[10px] uppercase tracking-wider text-cs-text-dim">Reply macros</span>
          <span className="rounded border border-cs-border px-1 text-[9px] text-cs-text-dim">soon</span>
        </div>
        <div className="flex flex-col gap-0.5">
          {SEED_MACROS.map((mac) => (
            <div key={mac.label} className="flex items-center gap-2.5 rounded-md px-2 py-1.5 opacity-60">
              <span className="text-cs-accent">
                <Zap size={14} aria-hidden="true" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[12px] font-medium text-cs-text">{mac.label}</span>
                <span className="block truncate font-mono text-[11px] text-cs-text-dim">{mac.text}</span>
              </span>
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
