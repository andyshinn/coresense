import type { LucideIcon } from 'lucide-react';
import { cn } from '../../lib/utils';

export interface PillTab<T extends string> {
  id: T;
  label: string;
  icon: LucideIcon;
  /** Shows a warn dot on the pill when the tab has unsaved changes. */
  dirty?: boolean;
}

interface PillTabsProps<T extends string> {
  tabs: PillTab<T>[];
  active: T;
  onChange: (id: T) => void;
}

// Custom segmented control for the Settings panel header. Not shadcn Tabs —
// the panel owns its own scroll column so the jump-rail scroll-spy works.
export function PillTabs<T extends string>({ tabs, active, onChange }: PillTabsProps<T>) {
  return (
    <div role="tablist" aria-label="Settings tabs" className="flex items-center gap-1">
      {tabs.map((t) => {
        const Icon = t.icon;
        const isActive = t.id === active;
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(t.id)}
            className={cn(
              'flex items-center gap-1.5 rounded-md border px-3 py-1 text-[12px] font-medium transition-colors',
              isActive
                ? 'border-cs-border bg-cs-accent-soft/30 text-cs-text'
                : 'border-transparent text-cs-text-muted hover:bg-cs-bg-3 hover:text-cs-text',
            )}
          >
            <Icon className="size-3.5 shrink-0" aria-hidden />
            <span>{t.label}</span>
            {t.dirty && <span className="size-1.5 rounded-full bg-cs-warn" aria-hidden />}
          </button>
        );
      })}
    </div>
  );
}
