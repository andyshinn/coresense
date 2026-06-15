import { Inbox } from 'lucide-react';
import { SidebarMenuButton, SidebarMenuItem } from '../../components/ui/sidebar';
import { ACTIVE_BUTTON_CLASS } from './atoms';

interface UnreadsNavItemProps {
  totalUnread: number;
  isActive: boolean;
  onSelect: () => void;
}

/** Fixed "Unreads" shortcut at the top of the Conversations group. Its
 *  visibility is owned by the parent (the `showLeftNavUnreads` setting), so it
 *  renders independently of `totalUnread` — the list below never shifts when
 *  unread counts change. When there are no unreads it shows a dimmed `0` chip
 *  and omits the pulse dot. */
export function UnreadsNavItem({ totalUnread, isActive, onSelect }: UnreadsNavItemProps) {
  const hasUnread = totalUnread > 0;
  return (
    <SidebarMenuItem>
      <SidebarMenuButton tooltip="Unreads" isActive={isActive} onClick={onSelect} className={ACTIVE_BUTTON_CLASS}>
        <span className="relative flex shrink-0 items-center">
          <Inbox className="size-4" />
          {hasUnread && (
            <span className="absolute -right-1 -top-1 size-1.5 animate-pulse rounded-full bg-cs-accent" />
          )}
        </span>
        <span>Unreads</span>
        <span
          role="status"
          aria-label={`${totalUnread} unread`}
          className={
            hasUnread
              ? 'ml-auto rounded-full bg-cs-accent px-1.5 py-px font-mono text-[10px] leading-none text-cs-bg tabular-nums'
              : 'ml-auto rounded-full bg-cs-bg-2 px-1.5 py-px font-mono text-[10px] leading-none text-cs-text-dim tabular-nums'
          }
        >
          {totalUnread > 99 ? '99+' : totalUnread}
        </span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}
