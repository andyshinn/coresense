import { useState } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '../../components/ui/popover';
import { useStore } from '../../lib/store';
import { cn } from '../../lib/utils';
import type { QuickActionCtx, QuickActionDef } from './catalog';

interface Props {
  def: QuickActionDef;
  ctx: QuickActionCtx;
  variant: 'primary' | 'secondary';
  enabled: boolean;
}

/** One owner-card quick action. Toggles show a live state dot; actions with a
 *  `confirm` open a small anchored popover before firing. */
export function QuickActionButton({ def, ctx, variant, enabled }: Props) {
  const [open, setOpen] = useState(false);
  const on = useStore((s) => (def.getState ? def.getState(s) : false));
  const Icon = def.icon;
  const isToggle = def.kind === 'toggle';
  const isDanger = def.kind === 'danger';

  const fire = () => {
    void def.run(ctx);
  };

  const className = cn(
    'relative flex items-center justify-center gap-1.5 rounded-md border text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-50',
    variant === 'primary' ? 'h-8 w-full px-2' : 'h-7 flex-1 px-0',
    isToggle && on
      ? 'border-cs-accent/30 bg-cs-accent-soft/15 text-cs-text'
      : 'border-cs-border bg-cs-bg-3 text-cs-text-muted hover:bg-cs-bg-2 hover:text-cs-text',
    isDanger && 'hover:border-cs-danger/40 hover:bg-cs-danger/10 hover:text-cs-danger',
  );

  const inner = (
    <>
      <Icon aria-hidden className={cn('size-3.5 shrink-0', isToggle && on && 'text-cs-accent')} />
      {variant === 'primary' && <span>{def.label}</span>}
      {isToggle && (
        <span
          aria-hidden
          className={cn('absolute right-1 top-1 size-1.5 rounded-full', on ? 'bg-cs-online' : 'bg-cs-text-dim')}
        />
      )}
    </>
  );

  if (!def.confirm) {
    return (
      <button
        type="button"
        onClick={fire}
        disabled={!enabled}
        title={def.label}
        aria-label={def.label}
        className={className}
      >
        {inner}
      </button>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" disabled={!enabled} title={def.label} aria-label={def.label} className={className}>
          {inner}
        </button>
      </PopoverTrigger>
      <PopoverContent side="top" align="center" className="w-56 p-3">
        <p className="text-[12px] font-medium text-cs-text">{def.confirm.title}</p>
        {def.confirm.body && <p className="mt-1 text-[11px] text-cs-text-muted">{def.confirm.body}</p>}
        <div className="mt-3 flex justify-end gap-2">
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="rounded border border-cs-border px-2.5 py-0.5 text-[12px] text-cs-text-muted hover:text-cs-text"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              fire();
            }}
            className="rounded border border-cs-danger bg-cs-danger px-2.5 py-0.5 text-[12px] font-medium text-cs-bg hover:bg-cs-danger/90"
          >
            {def.confirm.confirmLabel}
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
