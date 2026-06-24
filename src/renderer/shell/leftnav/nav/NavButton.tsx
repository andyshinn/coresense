import { Button, Tooltip } from '@radix-ui/themes';
import type { ComponentProps, MouseEvent, ReactNode } from 'react';
import { cn } from '../../../lib/utils';
import { useNav } from './NavRoot';

/**
 * ↔ `SidebarMenuButton`. The primary clickable menu row. Renders a Radix Themes
 * ghost `Button` (or `asChild` to adopt the child element — e.g. a Collapsible
 * trigger). Sets `data-active` so the existing `ACTIVE_BUTTON_CLASS` styling
 * keys off it unchanged, and applies a `Tooltip` (shown only while the rail is
 * icon-collapsed, mirroring the shadcn `hidden={state !== 'collapsed'}` rule).
 *
 * The shadcn `variant`/`size` CVA knobs are intentionally omitted — the left-nav
 * only ever uses the default variant + className overrides.
 */
export interface NavButtonProps {
  isActive?: boolean;
  onClick?: (e: MouseEvent<HTMLButtonElement>) => void;
  onContextMenu?: (e: MouseEvent<HTMLButtonElement>) => void;
  /** Tooltip content shown only while collapsed. String or any node. */
  tooltip?: ReactNode;
  disabled?: boolean;
  /** Adopt the single child element instead of rendering a `<button>`. */
  asChild?: boolean;
  className?: string;
  children?: ReactNode;
}

export function NavButton({
  isActive = false,
  onClick,
  onContextMenu,
  tooltip,
  disabled,
  asChild = false,
  className,
  children,
  ...rest
}: NavButtonProps & Omit<ComponentProps<typeof Button>, keyof NavButtonProps>) {
  const { state } = useNav();

  const button = (
    <Button
      type="button"
      variant="ghost"
      color="gray"
      asChild={asChild}
      data-slot="nav-button"
      data-active={isActive}
      disabled={disabled}
      onClick={onClick}
      onContextMenu={onContextMenu}
      className={cn(
        // Reset Radix Button's centered/inline-flex defaults to a full-width,
        // left-aligned menu row matching the shadcn SidebarMenuButton.
        'nav-button flex w-full items-center gap-2 overflow-hidden rounded-md p-2 text-left text-sm justify-start',
        'disabled:pointer-events-none disabled:opacity-50',
        '[&>span:last-child]:truncate [&>svg]:size-4 [&>svg]:shrink-0',
        className,
      )}
      {...rest}
    >
      {children}
    </Button>
  );

  if (!tooltip) return button;

  return (
    <Tooltip content={tooltip} side="right" align="center" hidden={state !== 'collapsed'}>
      {button}
    </Tooltip>
  );
}
