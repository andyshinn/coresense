import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

/** Label/value row — replaces `DetailRow` in LeftNav.tsx and `Field` in RightRail.tsx. */
export function KeyValueRow({
  label,
  value,
  mono,
  title,
  labelTone = 'dim',
  valueClassName,
}: {
  label: string;
  value: ReactNode;
  mono?: boolean;
  title?: string;
  /** `muted` for labels someone must read on bg-2: `dim` is under 4.5:1 there. */
  labelTone?: 'dim' | 'muted';
  valueClassName?: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-xs">
      <span
        className={cn(
          'shrink-0 text-[10px] uppercase tracking-wider',
          labelTone === 'muted' ? 'text-cs-text-muted' : 'text-cs-text-dim',
        )}
      >
        {label}
      </span>
      <span
        title={title}
        className={cn('truncate text-right text-cs-text', mono && 'font-mono tabular-nums text-[11px]', valueClassName)}
      >
        {value}
      </span>
    </div>
  );
}

/** Section wrapper with uppercase title — replaces `DetailSection` in LeftNav.tsx. */
export function KeyValueGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="text-[10px] font-medium uppercase tracking-wider text-cs-text-dim">{title}</div>
      <div className="flex flex-col gap-1">{children}</div>
    </div>
  );
}
