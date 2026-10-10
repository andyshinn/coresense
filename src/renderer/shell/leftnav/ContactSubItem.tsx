import type { MouseEvent } from 'react';
import type { Contact } from '../../../shared/types';
import { SidebarMenuSubButton, SidebarMenuSubItem } from '../../components/ui/sidebar';
import { CONTACT_ICON } from '../../lib/conversationIcons';
import { ACTIVE_BUTTON_CLASS, NavRowTrailing } from './atoms';

/** Single contact row in a sub-list with unread/mute/pin badges. */
export function ContactSubItem({
  contact,
  active,
  pinned,
  unread,
  showUnread,
  onSelect,
  onContextMenu,
}: {
  contact: Contact;
  active: boolean;
  pinned: boolean;
  unread: number;
  /** From shouldShowUnread, computed by the list so the window-focus
   *  subscription is one per list rather than one per row. */
  showUnread: boolean;
  onSelect: () => void;
  onContextMenu: (e: MouseEvent) => void;
}) {
  const Icon = CONTACT_ICON[contact.kind];
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
          <NavRowTrailing unread={unread} showUnread={showUnread} muted={contact.muted} pinned={pinned} />
        </button>
      </SidebarMenuSubButton>
    </SidebarMenuSubItem>
  );
}
