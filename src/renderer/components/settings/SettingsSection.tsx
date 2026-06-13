import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '../../lib/utils';

interface SettingsSectionProps {
  /** Stable id — also the `data-section` anchor for scroll-spy / jump rail. */
  id: string;
  icon: LucideIcon;
  title: string;
  description?: string;
  footnote?: string;
  dirty: boolean;
  saving?: boolean;
  /** When false the Save button stays disabled (e.g. no API client). */
  canSave?: boolean;
  /** Omit for read-only sections — no Save button / badge is rendered. */
  onSave?: () => void;
  children: ReactNode;
}

// Presentational per-section wrapper for the redesigned Settings panel: icon +
// title header, an "Unsaved" badge + Save button when dirty, and a footnote.
// Dirty state is owned by the section container (via useSettingsSection) and
// passed in — this component is purely visual.
export function SettingsSection({
  id,
  icon: Icon,
  title,
  description,
  footnote,
  dirty,
  saving,
  canSave = true,
  onSave,
  children,
}: SettingsSectionProps) {
  return (
    <section data-section={id} className="scroll-mt-4 border-b border-cs-border py-5 last:border-b-0">
      <header className="mb-3 flex items-start gap-3">
        <div className="flex-1">
          <h2 className="flex items-center gap-2 text-[13px] font-semibold text-cs-text">
            <Icon className="size-3.5 shrink-0 text-cs-accent" aria-hidden />
            {title}
          </h2>
          {description && <p className="mt-1 max-w-115 text-[11px] text-cs-text-muted">{description}</p>}
        </div>
        {onSave && (
          <div className="flex shrink-0 items-center gap-2">
            {dirty && (
              <span className="inline-flex items-center gap-1 rounded-full border border-cs-warn/40 bg-cs-warn/10 px-1.5 py-0.5 text-[10px] font-medium text-cs-warn">
                <span className="size-1.5 rounded-full bg-cs-warn" aria-hidden />
                Unsaved
              </span>
            )}
            <button
              type="button"
              onClick={onSave}
              disabled={!dirty || !canSave || saving}
              className={cn(
                'rounded border px-2.5 py-0.5 text-[12px] font-medium transition-colors disabled:cursor-not-allowed',
                dirty && canSave
                  ? 'border-cs-accent bg-cs-accent text-cs-bg hover:bg-cs-accent/90'
                  : 'border-cs-border bg-transparent text-cs-text-dim opacity-60',
              )}
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        )}
      </header>
      <div className="space-y-0.5">{children}</div>
      {footnote && <p className="mt-2 px-2 text-[10px] italic text-cs-text-dim">{footnote}</p>}
    </section>
  );
}
