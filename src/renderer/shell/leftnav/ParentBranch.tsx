import { ChevronRightIcon } from '@radix-ui/react-icons';
import type { LucideIcon } from 'lucide-react';
import { Collapsible } from 'radix-ui';
import type { MouseEvent, ReactNode } from 'react';
import { cn } from '../../lib/utils';
import { NavButton, NavItem, useNav } from './nav';

/** Top-level menu row that opens a submenu with icon + label + rotating chevron and aggregate unread badge. */
export function ParentBranch({
  label,
  icon: Icon,
  open,
  onToggle,
  unreadTotal = 0,
  trailingAction,
  onContextMenu,
  children,
}: {
  label: string;
  icon: LucideIcon;
  open: boolean;
  onToggle: () => void;
  unreadTotal?: number;
  /** Optional action rendered absolute-positioned right of the button — typically wraps a PopoverTrigger via SidebarMenuAction asChild. */
  trailingAction?: ReactNode;
  onContextMenu?: (e: MouseEvent<HTMLButtonElement>) => void;
  children: ReactNode;
}) {
  // In icon-collapsed mode the submenu is hidden via CSS, so a normal
  // Collapsible-toggle click does nothing visible. Treat the click as
  // "expand the sidebar and ensure this branch is open" instead — the user's
  // intent (see this group's contents) is the same either way.
  const { state, setOpen } = useNav();
  const handleClick = () => {
    if (state === 'collapsed') {
      setOpen(true);
      if (!open) onToggle();
      return;
    }
    onToggle();
  };
  return (
    <Collapsible.Root open={open} className="group/collapsible" asChild>
      <NavItem>
        <NavButton tooltip={label} onClick={handleClick} onContextMenu={onContextMenu}>
          <Icon />
          <span>{label}</span>
          {unreadTotal > 0 && (
            <span
              role="status"
              aria-label={`${unreadTotal} unread`}
              className="ml-auto rounded-full bg-cs-accent px-1.5 py-px font-mono text-[10px] leading-none text-cs-bg tabular-nums"
            >
              {unreadTotal > 99 ? '99+' : unreadTotal}
            </span>
          )}
          <ChevronRightIcon
            className={cn(
              'transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90',
              unreadTotal > 0 ? '' : 'ml-auto',
            )}
          />
        </NavButton>
        {trailingAction}
        <Collapsible.Content>{children}</Collapsible.Content>
      </NavItem>
    </Collapsible.Root>
  );
}
