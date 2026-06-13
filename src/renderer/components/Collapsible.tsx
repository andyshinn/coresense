import { ChevronRight } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '../lib/utils';

interface Props {
  label: ReactNode;
  open: boolean;
  onToggle: () => void;
  // Right-aligned slot for badges, count chips, "+" buttons, etc.
  trailing?: ReactNode;
  children: ReactNode;
  className?: string;
  // When true, label uses the smaller mono-uppercase section style. Default is
  // sentence-case for in-rail subsections.
  sectionHeader?: boolean;
}

export function Collapsible({ label, open, onToggle, trailing, children, className, sectionHeader }: Props) {
  return (
    <div className={cn('flex flex-col', className)}>
      <div
        className={cn(
          'group flex items-center gap-1.5 px-2 py-1',
          sectionHeader ? 'font-mono text-[10px] uppercase tracking-wider text-cs-text-dim' : 'text-xs text-cs-text-muted',
        )}
      >
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          className="flex flex-1 items-center gap-1 truncate text-left hover:text-cs-text"
        >
          <ChevronRight size={12} aria-hidden="true" className={cn('shrink-0 transition-transform', open && 'rotate-90')} />
          <span className="truncate">{label}</span>
        </button>
        {trailing}
      </div>
      {open && <div>{children}</div>}
    </div>
  );
}
