import { Slot } from 'radix-ui';
import type { ComponentProps } from 'react';
import { cn } from '../../../lib/utils';

/**
 * ↔ `SidebarMenuSub`. The nested `<ul>` revealed under a parent branch (channel
 * rows, contact rows, …). Indented with a left rule. Hidden while the rail is
 * icon-collapsed via the `.nav-sub` rule in nav.css.
 */
export function NavSub({ className, ...props }: ComponentProps<'ul'>) {
  return (
    <ul
      data-slot="nav-sub"
      className={cn(
        'nav-sub mx-3.5 flex min-w-0 translate-x-px flex-col gap-1 border-l border-cs-border px-2.5 py-0.5 list-none',
        className,
      )}
      {...props}
    />
  );
}

/** ↔ `SidebarMenuSubItem`. A positioned `<li>` sub-row (drag-to-reorder anchors here). */
export function NavSubItem({ className, ...props }: ComponentProps<'li'>) {
  return <li data-slot="nav-sub-item" className={cn('group/nav-sub-item relative', className)} {...props} />;
}

/**
 * ↔ `SidebarMenuSubButton`. A sub-row link. Renders an `<a>` by default but is
 * almost always used `asChild` to wrap a real `<button>` (so click/context-menu
 * handlers + `data-testid`/`data-channel-key` land on a focusable element). Sets
 * `data-active` for the active-row styling.
 */
export function NavSubButton({
  asChild = false,
  isActive = false,
  className,
  ...props
}: ComponentProps<'a'> & { asChild?: boolean; isActive?: boolean }) {
  const Comp = asChild ? Slot.Root : 'a';
  return (
    <Comp
      data-slot="nav-sub-button"
      data-active={isActive}
      className={cn(
        'flex h-7 min-w-0 -translate-x-px items-center gap-2 overflow-hidden rounded-md px-2 text-sm text-cs-text-muted outline-none hover:bg-cs-bg-3 hover:text-cs-text focus-visible:ring-2 disabled:pointer-events-none disabled:opacity-50 [&>span:last-child]:truncate [&>svg]:size-4 [&>svg]:shrink-0',
        className,
      )}
      {...props}
    />
  );
}
