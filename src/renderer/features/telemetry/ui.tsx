import type { ComponentProps, ReactNode } from 'react';
import { cn } from '../../lib/utils';
import type { ChipTone } from './format';

// Small primitives the telemetry screens share. The app has no shared cs
// button at the mockups' 28 px size (shadcn's `sm` is 32 px, the admin tabs
// hand-roll 11 px ones), so the telemetry kit carries one here.

// Tones are measured against each chip's OWN fill composited over every
// substrate it lands on (bg list column, bg-2 cards, the selected row's
// accent-soft/30 tint), not against the page. Several mockup colours fail AA
// that way, hence the swaps (ratios dark / light, worst substrate):
//   ok    online/15 fill, trend-up text      6.14 / 5.78  (online text in light: 2.45)
//   warn  warn/10 fill, hop-far text         5.97 / 4.63  (warn text in light: 2.52)
//   bad   danger/12 fill, trend-down text    4.97 / 5.45  (mockup #f08a7e in light: 1.74)
//   off   bg-3 fill, muted text              8.15 / 6.01  (mockup's dim text: 3.76 / 3.03)
const TONE: Record<ChipTone, string> = {
  ok: 'border-cs-online/40 bg-cs-online/15 text-cs-trend-up',
  warn: 'border-cs-warn/40 bg-cs-warn/10 text-[rgb(var(--cs-hop-far))]',
  bad: 'border-cs-danger/45 bg-cs-danger/12 text-cs-trend-down',
  off: 'border-cs-border-strong bg-cs-bg-3 text-cs-text-muted',
};

/** The mockups' `.chip`: 20 px, mono 10.5, one of four tones. */
export function TelemetryChip({
  tone,
  children,
  className,
  title,
}: {
  tone: ChipTone;
  children: ReactNode;
  className?: string;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={cn(
        'inline-flex h-5 shrink-0 items-center gap-1 whitespace-nowrap rounded border px-1.75 font-mono text-[10.5px] font-medium leading-none [&>svg]:size-3',
        TONE[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

type ButtonVariant = 'primary' | 'secondary';
type ButtonProps = ComponentProps<'button'> & { variant?: ButtonVariant };

/** Classes of the mockups' `.btn` (28 px, secondary) and `.btn-primary`, for buttons rendered by other components (CopyButton). */
export function telemetryButtonClass(variant: ButtonVariant = 'secondary', className?: string): string {
  return cn(
    'inline-flex h-7 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md border px-2.5 text-[12px] font-medium leading-none transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-cs-accent disabled:cursor-not-allowed disabled:opacity-50 [&>svg]:size-3.5',
    variant === 'primary'
      ? 'border-cs-accent bg-cs-accent text-cs-bg hover:bg-cs-accent/90 disabled:hover:bg-cs-accent'
      : // Hover shows on the border only: accent text on bg-3 is 3.7:1 in light, and the
        // destructive "Clear saved requests…" keeps its red.
        'border-cs-border-strong bg-cs-bg-3 text-cs-text hover:border-cs-accent disabled:hover:border-cs-border-strong',
    className,
  );
}

/** The mockups' `.btn` (28 px, secondary) and `.btn-primary`. */
export function TelemetryButton({ variant = 'secondary', className, type = 'button', ...props }: ButtonProps) {
  return <button type={type} className={telemetryButtonClass(variant, className)} {...props} />;
}

/** The mockups' `.card` + `.card-h`: a bordered bg-2 panel with a header row. */
export function TelemetryCard({
  header,
  children,
  className,
  tone,
  ...rest
}: {
  header: ReactNode;
  children?: ReactNode;
  className?: string;
  /** `danger` tints the border (the failed state). */
  tone?: 'danger';
} & Omit<ComponentProps<'section'>, 'children'>) {
  return (
    <section
      className={cn(
        'overflow-hidden rounded-lg border bg-cs-bg-2',
        tone === 'danger' ? 'border-cs-danger/45' : 'border-cs-border',
        className,
      )}
      {...rest}
    >
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 border-b border-cs-border px-3.5 py-2.25">
        {header}
      </div>
      {children}
    </section>
  );
}

/** Level of a telemetry view's top heading; My radio nests it under its own. */
export type HeadingLevel = 2 | 3 | 4;

/** Mono-caps label (`.lcm`). */
export const LABEL_MONO = 'font-mono text-[10px] uppercase leading-[15px] tracking-wider text-cs-text-muted';
/** Caps label (`.lc`), the KeyValueRow label style. */
export const LABEL_CAPS = 'text-[10px] uppercase leading-[15px] tracking-wider text-cs-text-dim';
/** Meta mono line (`.meta`). */
export const META = 'font-mono text-[10px] leading-[15px] tabular-nums text-cs-text-dim';
