import { Users } from 'lucide-react';
import { useCallback, useMemo } from 'react';
import type { Contact, ContactKind } from '../../../shared/types';
import { SidebarMenuButton, SidebarMenuItem, SidebarMenuSub } from '../../components/ui/sidebar';
import { shouldShowUnread } from '../../hooks/useUnreads';
import { capList } from '../../lib/capList';
import { useStore } from '../../lib/store';
import { ShowMoreRow } from './atoms';
import type { ContactMenuState } from './ContactContextMenu';
import { ContactSubItem } from './ContactSubItem';
import { CONTACT_GROUP_ICON, CONTACT_GROUP_LABEL, CONTACT_GROUP_ORDER } from './constants';
import { KindBranch } from './KindBranch';
import { ParentBranch } from './ParentBranch';
import { sortByPinned } from './sorting';

/** Sorted contacts bucketed by kind, plus the per-kind and overall unread sums
 *  the branch headers show. */
function useContactBuckets(sortedContacts: Contact[], unreadByKey: Record<string, number>) {
  // Bucket sorted contacts by kind. Empty groups are dropped at render time
  // (hide-empty behavior — preferred over zero-count placeholders).
  const contactsByKind = useMemo(() => {
    const out: Record<ContactKind, Contact[]> = { chat: [], repeater: [], room: [], sensor: [] };
    for (const c of sortedContacts) out[c.kind].push(c);
    return out;
  }, [sortedContacts]);

  // Aggregate counts shown on the contact parent buttons — sums per-key counts
  // for items in the group, so a collapsed branch still surfaces "there's
  // something new".
  const unreadByKind = useMemo(() => {
    const out: Record<ContactKind, number> = { chat: 0, repeater: 0, room: 0, sensor: 0 };
    for (const c of sortedContacts) {
      out[c.kind] += unreadByKey[c.key] ?? 0;
    }
    return out;
  }, [sortedContacts, unreadByKey]);
  const unreadTotal = unreadByKind.chat + unreadByKind.repeater + unreadByKind.room + unreadByKind.sensor;

  return { contactsByKind, unreadByKind, unreadTotal };
}

/** The contact half of the conversation tree, grouped by kind either as
 *  top-level branches or nested under one "Contacts" branch, per the
 *  contactGrouping setting. */
export function ContactsTree({
  activeKey,
  pinned,
  pinSet,
  unreadByKey,
  capFor,
  onShowMore,
  onContactMenu,
}: {
  activeKey: string;
  pinned: string[];
  pinSet: Set<string>;
  unreadByKey: Record<string, number>;
  /** Row cap for a branch's reveal key; `null` when uncapped or revealed. */
  capFor: (revealKey: string) => number | null;
  onShowMore: (revealKey: string) => void;
  onContactMenu: (state: ContactMenuState) => void;
}) {
  const contacts = useStore((s) => s.contacts);
  const pinUnreadToTop = useStore((s) => s.appSettings.pinUnreadToTop);
  const contactGrouping = useStore((s) => s.appSettings.contactGrouping);
  const windowFocused = useStore((s) => s.windowFocused);
  const setActiveKey = useStore((s) => s.setActiveKey);
  // Open state per branch, persisted to ui-state.json so collapse choices
  // survive across launches.
  const leftNavOpen = useStore((s) => s.ui.leftNavOpen);
  const setLeftNavGroup = useStore((s) => s.setLeftNavGroup);

  const sortedContacts = useMemo(
    () => sortByPinned(contacts, pinSet, pinned, (c) => c.name, pinUnreadToTop ? unreadByKey : null),
    [contacts, pinSet, pinned, pinUnreadToTop, unreadByKey],
  );
  const { contactsByKind, unreadByKind, unreadTotal } = useContactBuckets(sortedContacts, unreadByKey);
  const kinds = CONTACT_GROUP_ORDER.filter((k) => contactsByKind[k].length > 0);

  const toggleKind = useCallback(
    (kind: ContactKind) => {
      setLeftNavGroup(kind, !leftNavOpen[kind]);
    },
    [leftNavOpen, setLeftNavGroup],
  );

  const renderContactSubItem = useCallback(
    (c: Contact) => {
      const active = activeKey === c.key;
      const unread = unreadByKey[c.key] ?? 0;
      return (
        <ContactSubItem
          key={c.key}
          contact={c}
          active={active}
          pinned={pinSet.has(c.key)}
          unread={unread}
          showUnread={shouldShowUnread(unread, active, windowFocused)}
          onSelect={() => setActiveKey(c.key)}
          onContextMenu={(e) => {
            e.preventDefault();
            onContactMenu({ contact: c, x: e.clientX, y: e.clientY });
          }}
        />
      );
    },
    [activeKey, pinSet, unreadByKey, windowFocused, setActiveKey, onContactMenu],
  );

  const renderKindSub = (kind: ContactKind) => {
    const revealKey = `contact:${kind}`;
    const { rows: shown, hidden } = capList(contactsByKind[kind], capFor(revealKey));
    return (
      <SidebarMenuSub>
        {shown.map(renderContactSubItem)}
        {hidden > 0 && <ShowMoreRow count={hidden} onClick={() => onShowMore(revealKey)} />}
      </SidebarMenuSub>
    );
  };

  if (contactGrouping === 'top-level') {
    return kinds.map((kind) => (
      <ParentBranch
        key={kind}
        label={CONTACT_GROUP_LABEL[kind]}
        icon={CONTACT_GROUP_ICON[kind]}
        open={leftNavOpen[kind]}
        onToggle={() => toggleKind(kind)}
        unreadTotal={unreadByKind[kind]}
      >
        {renderKindSub(kind)}
      </ParentBranch>
    ));
  }

  if (sortedContacts.length === 0) {
    return (
      <SidebarMenuItem>
        <SidebarMenuButton disabled className="italic text-cs-text-dim">
          <Users />
          <span>No contacts yet</span>
        </SidebarMenuButton>
      </SidebarMenuItem>
    );
  }

  return (
    <ParentBranch
      label="Contacts"
      icon={Users}
      open={leftNavOpen.contacts}
      onToggle={() => setLeftNavGroup('contacts', !leftNavOpen.contacts)}
      unreadTotal={unreadTotal}
    >
      <SidebarMenuSub>
        {kinds.map((kind) => (
          <KindBranch
            key={kind}
            label={CONTACT_GROUP_LABEL[kind]}
            icon={CONTACT_GROUP_ICON[kind]}
            open={leftNavOpen[kind]}
            onToggle={() => toggleKind(kind)}
            unreadTotal={unreadByKind[kind]}
          >
            {renderKindSub(kind)}
          </KindBranch>
        ))}
      </SidebarMenuSub>
    </ParentBranch>
  );
}
