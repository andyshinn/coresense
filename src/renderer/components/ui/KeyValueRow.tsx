import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

/** Label/value row — replaces `DetailRow` in LeftNav.tsx and `Field` in RightRail.tsx. */
export function KeyValueRow({
  label,
  value,
  mono,
  title,
}: {
  label: string;
  value: ReactNode;
  mono?: boolean;
  title?: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-xs">
      <span className="shrink-0 text-[10px] uppercase tracking-wider text-cs-text-dim">{label}</span>
      <span title={title} className={cn('truncate text-right text-cs-text', mono && 'font-mono tabular-nums text-[11px]')}>
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
