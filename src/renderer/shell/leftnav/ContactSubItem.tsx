import { BellOff, Star } from 'lucide-react';
import type { MouseEvent } from 'react';
import type { Contact } from '../../../shared/types';
import { SidebarMenuSubButton, SidebarMenuSubItem } from '../../components/ui/sidebar';
import { CONTACT_ICON } from '../../lib/conversationIcons';
import { ACTIVE_BUTTON_CLASS, UnreadChip } from './atoms';

/** Single contact row in a sub-list with unread/mute/pin badges. */
export function ContactSubItem({
  contact,
  active,
  pinned,
  unread,
  onSelect,
  onContextMenu,
}: {
  contact: Contact;
  active: boolean;
  pinned: boolean;
  unread: number;
  onSelect: () => void;
  onContextMenu: (e: MouseEvent) => void;
}) {
  const Icon = CONTACT_ICON[contact.kind];
  const showUnread = unread > 0 && !active;
  return (
    <SidebarMenuSubItem>
      <SidebarMenuSubButton
        isActive={active}
        onClick={onSelect}
        onContextMenu={onContextMenu}
        className={ACTIVE_BUTTON_CLASS}
        asChild
      >
        <button type="button">
          <Icon />
          <span className="flex-1 truncate">{contact.name}</span>
          {showUnread && <UnreadChip count={unread} />}
          {contact.muted && <BellOff aria-label="muted" className="size-3 text-cs-text-dim/60" />}
          {pinned && (
            <Star aria-hidden="true" className="size-3 text-cs-accent" fill="currentColor" />
          )}
        </button>
      </SidebarMenuSubButton>
    </SidebarMenuSubItem>
  );
}
