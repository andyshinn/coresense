import { Slot } from 'radix-ui';
import type { ComponentProps } from 'react';
import { cn } from '../../../lib/utils';

/**
 * ↔ `SidebarMenu`. A vertical `<ul>` of menu items. Kept as a real list element
 * (not a Radix layout primitive) to preserve list semantics + the `data-slot`
 * hooks the consumers rely on.
 */
export function NavMenu({ className, ...props }: ComponentProps<'ul'>) {
  return (
    <ul data-slot="nav-menu" className={cn('flex w-full min-w-0 flex-col gap-1 list-none m-0 p-0', className)} {...props} />
  );
}

/** ↔ `SidebarMenuItem`. A positioned `<li>` row; trailing actions anchor to it. */
export function NavItem({ className, ...props }: ComponentProps<'li'>) {
  return <li data-slot="nav-item" className={cn('group/nav-item relative', className)} {...props} />;
}

/**
 * ↔ `SidebarMenuAction`. Absolute-positioned trailing slot (e.g. the Channels "+"
 * add button). Almost always used `asChild` to wrap a PopoverTrigger/button.
 * Hidden while the rail is icon-collapsed via the `.nav-action` rule in nav.css.
 */
export function NavAction({ className, asChild = false, ...props }: ComponentProps<'button'> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : 'button';
  return (
    <Comp
      data-slot="nav-action"
      className={cn(
        'nav-action absolute top-1.5 right-1 flex aspect-square w-5 items-center justify-center rounded-md p-0 text-cs-text-dim outline-none transition-colors hover:bg-cs-bg-3 hover:text-cs-text focus-visible:ring-2 [&>svg]:size-4 [&>svg]:shrink-0',
        className,
      )}
      {...props}
    />
  );
}
