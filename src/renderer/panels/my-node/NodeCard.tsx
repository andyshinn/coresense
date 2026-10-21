import type { LucideIcon } from 'lucide-react';
import { type ReactNode, useId } from 'react';
import { cn } from '../../lib/utils';

interface Props {
  icon: LucideIcon;
  title: string;
  /** Right-aligned header content: timers, links, switches, buttons. */
  extras?: ReactNode;
  /** Grid placement (column spans). */
  className?: string;
  /** `accent` tints the border: the disconnected page's connection card. */
  tone?: 'accent';
  bodyClassName?: string;
  children: ReactNode;
}

/** My Node card chrome: bg-2, border, rounded-lg, no shadow; a 36 px header
 *  with an accent icon, the title and optional extras. Labelled by its title
 *  for assistive tech. */
export function NodeCard({ icon: Icon, title, extras, className, tone, bodyClassName, children }: Props) {
  const titleId = useId();
  return (
    <section
      aria-labelledby={titleId}
      className={cn(
        'flex min-w-0 flex-col overflow-hidden rounded-lg border bg-cs-bg-2',
        tone === 'accent' ? 'border-cs-accent/60' : 'border-cs-border',
        className,
      )}
    >
      <header className="flex h-9 shrink-0 items-center gap-2 border-b border-cs-border px-3">
        <Icon aria-hidden="true" className="size-3.5 shrink-0 text-cs-accent" />
        <h3 id={titleId} className="section-title min-w-0 truncate text-cs-text">
          {title}
        </h3>
        {extras && <div className="ml-auto flex min-w-0 shrink-0 items-center gap-2">{extras}</div>}
      </header>
      {/* A named container, so a card's insides can respond to the card's own width. */}
      <div className={cn('@container/card flex min-w-0 flex-1 flex-col gap-3 p-3', bodyClassName)}>{children}</div>
    </section>
  );
}

/** "Updated 4 s ago": the live indicator in a card header. `warn` after
 *  repeated failures. */
export function UpdatedAgo({ text, warn }: { text: string | null; warn?: boolean }) {
  if (!text) return null;
  return (
    <span className={cn('font-mono text-[10px] tabular-nums', warn ? 'text-cs-warn' : 'text-cs-text-muted')} aria-live="off">
      {text}
    </span>
  );
}

/** A small "label › " link in a card header or footer. */
export function CardLink({ onClick, children, label }: { onClick: () => void; children: ReactNode; label?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="rounded-sm text-[11px] text-cs-accent underline-offset-2 hover:underline focus-visible:outline-1 focus-visible:outline-cs-accent"
    >
      {children}
    </button>
  );
}
