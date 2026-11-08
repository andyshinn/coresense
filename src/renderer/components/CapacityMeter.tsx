import { cn } from '../lib/utils';

interface Props {
  used: number;
  /** 0 or less means unknown: the bar stays empty and the total reads "—". */
  max: number;
  /** Turn the bar `cs-warn` at this fraction of `max` (0–1). Default 0.9. */
  warnAt?: number;
  /** The value text; defaults to "used / max". */
  label?: string;
  title?: string;
  /** Bar width classes; the Contact Manager's toolbar meter is narrow. */
  barClassName?: string;
  className?: string;
}

/** A count against a limit: mono "used / max" and a small bar that turns
 *  `cs-warn` near the limit. */
export function CapacityMeter({ used, max, warnAt = 0.9, label, title, barClassName, className }: Props) {
  const pct = max > 0 ? Math.min(100, Math.round((used / max) * 100)) : 0;
  const warn = max > 0 && used >= max * warnAt;
  return (
    <div className={cn('flex items-center gap-2', className)} title={title}>
      <div className="text-right">
        <div className="font-mono text-[11px] tabular-nums">
          {label ?? (
            <>
              <span className={warn ? 'text-cs-warn' : 'text-cs-accent'}>{used}</span>
              <span className="text-cs-text-dim"> / {max > 0 ? max : '—'}</span>
            </>
          )}
        </div>
      </div>
      <div
        className={cn('h-1.5 w-14 overflow-hidden rounded-full border border-cs-border bg-cs-bg-3', barClassName)}
        aria-hidden="true"
      >
        <div className={cn('h-full', warn ? 'bg-cs-warn' : 'bg-cs-accent')} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
