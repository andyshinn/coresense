import type * as React from 'react';
import { cn } from '@/lib/utils';

// shadcn-style Kbd, themed to the MeshCore "ledger" spec: outline (hairline)
// caps — 20px tall, 20px min-width, 4px radius, transparent fill, mono 11px.
function Kbd({ className, ...props }: React.ComponentProps<'kbd'>) {
  return (
    <kbd
      data-slot="kbd"
      className={cn(
        'inline-flex h-5 min-w-5 items-center justify-center rounded border border-cs-border-strong bg-transparent px-1.5 font-mono text-[11px] leading-none text-cs-text-muted',
        className,
      )}
      {...props}
    />
  );
}

// A row of caps forming one chord (e.g. ⌘ K), 3px gaps.
function KbdGroup({ className, ...props }: React.ComponentProps<'span'>) {
  return <span data-slot="kbd-group" className={cn('inline-flex items-center gap-[3px]', className)} {...props} />;
}

export { Kbd, KbdGroup };
