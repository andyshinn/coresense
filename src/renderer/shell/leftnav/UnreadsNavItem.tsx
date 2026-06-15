import { Inbox } from 'lucide-react';
import { SidebarMenuButton, SidebarMenuItem } from '../../components/ui/sidebar';
import { ACTIVE_BUTTON_CLASS, UnreadChip } from './atoms';

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
          {hasUnread && <span className="absolute -right-1 -top-1 size-1.5 animate-pulse rounded-full bg-cs-accent" />}
        </span>
        <span>Unreads</span>
        <UnreadChip count={totalUnread} muted={!hasUnread} className="ml-auto" />
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}
