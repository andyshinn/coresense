import { Hash, Plus, Search, Users, X } from 'lucide-react';
import { useCallback, useMemo, useRef, useState } from 'react';
import type { Contact, ContactKind } from '../../../shared/types';
import { AddChannelPopover } from '../../components/AddChannelPopover';
import { ContextMenu, menuItem } from '../../components/ContextMenu';
import { Popover, PopoverContent, PopoverTrigger } from '../../components/ui/popover';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarRail,
} from '../../components/ui/sidebar';
import { useUnreadByKey } from '../../hooks/useUnreads';
import { type ApiClient, api } from '../../lib/api';
import { notify } from '../../lib/notify';
import { useStore } from '../../lib/store';
import { ACTIVE_BUTTON_CLASS, EmptySubHint, ShowMoreRow } from './atoms';
import { ChannelContextMenu, type ChannelMenuState } from './ChannelContextMenu';
import { ChannelSubList } from './ChannelSubList';
import { ConnectionFooter } from './ConnectionFooter';
import { ContactContextMenu, type ContactMenuState } from './ContactContextMenu';
import { ContactSubItem } from './ContactSubItem';
import { CONTACT_GROUP_ICON, CONTACT_GROUP_LABEL, CONTACT_GROUP_ORDER, TOOLS } from './constants';
import { KindBranch } from './KindBranch';
import { OwnerCard } from './OwnerCard';
import { ParentBranch } from './ParentBranch';
import { sortByPinned, sortChannels } from './sorting';
import { UnreadsNavItem } from './UnreadsNavItem';

interface LeftNavProps {
  client: ApiClient | null;
}

/** Primary sidebar — owner card, channel/contact tree, tools, and connection footer. */
export function LeftNav({ client }: LeftNavProps) {
  const owner = useStore((s) => s.owner);
  const channels = useStore((s) => s.channels);
  const contacts = useStore((s) => s.contacts);
  const channelPresence = useStore((s) => s.channelPresence);
  const pinned = useStore((s) => s.ui.pinned);
  const activeKey = useStore((s) => s.ui.activeKey);
  const transport = useStore((s) => s.transportState);
  const syncProgress = useStore((s) => s.syncProgress);
  const hideUnsynced = useStore((s) => s.appSettings.hideUnsyncedChannels);
  const pinUnreadToTop = useStore((s) => s.appSettings.pinUnreadToTop);
  const showLeftNavUnreads = useStore((s) => s.appSettings.showLeftNavUnreads);
  const setActiveKey = useStore((s) => s.setActiveKey);

  // Per-conversation unread counts, shared with the Unreads panel.
  const unreadByKey = useUnreadByKey();
  const totalUnread = useMemo(() => Object.values(unreadByKey).reduce((a, b) => a + b, 0), [unreadByKey]);

  const addChannelOpen = useStore((s) => s.addChannelOpen);
  const setAddChannelOpen = useStore((s) => s.setAddChannelOpen);
  const connected = transport === 'connected';

  const contactGrouping = useStore((s) => s.appSettings.contactGrouping);
  const togglePin = useStore((s) => s.togglePin);

  const pinSet = useMemo(() => new Set(pinned), [pinned]);

  // Sort channels: pinned first (in pin order), then by `order` (seeded from
  // radio idx on first sync), then alphabetical. Filter out unsynced channels
  // when the user has opted into device-only parity.
  const sortedChannels = useMemo(() => {
    const filtered = hideUnsynced ? channels.filter((c) => channelPresence.has(c.key)) : channels;
    return sortChannels(filtered, pinSet, pinned, pinUnreadToTop ? unreadByKey : null);
  }, [channels, channelPresence, hideUnsynced, pinSet, pinned, pinUnreadToTop, unreadByKey]);
  const sortedContacts = useMemo(
    () => sortByPinned(contacts, pinSet, pinned, (c) => c.name, pinUnreadToTop ? unreadByKey : null),
    [contacts, pinSet, pinned, pinUnreadToTop, unreadByKey],
  );
  // Bucket sorted contacts by kind. Empty groups are dropped at render time
  // (hide-empty behavior — preferred over zero-count placeholders).
  const contactsByKind = useMemo(() => {
    const out: Record<ContactKind, Contact[]> = { chat: [], repeater: [], room: [], sensor: [] };
    for (const c of sortedContacts) out[c.kind].push(c);
    return out;
  }, [sortedContacts]);

  const showLeftNavSearch = useStore((s) => s.appSettings.showLeftNavSearch);
  const searchQuery = useStore((s) => s.searchQuery);
  const setSearchQuery = useStore((s) => s.setSearchQuery);
  const clearSearch = useStore((s) => s.clearSearch);
  const searchRef = useRef<HTMLInputElement>(null);
  // The activeKey before the user opened the search panel. On Esc we restore
  // it — so typing then escaping doesn't leave the user staring at an empty
  // search result page.
  const preSearchKeyRef = useRef<string | null>(null);

  const onSearchChange = useCallback(
    (next: string) => {
      setSearchQuery(next);
      if (next.length > 0) {
        // Remember where the user was so Esc can restore it. If they're
        // already on tool:search, leave the saved key alone.
        if (activeKey !== 'tool:search') preSearchKeyRef.current = activeKey;
        setActiveKey('tool:search');
      }
    },
    [setSearchQuery, setActiveKey, activeKey],
  );

  const onSearchEscape = useCallback(() => {
    clearSearch();
    // Restoring from search is conceptually a back-navigation: the user is
    // returning to the conversation they were in before the search input grabbed
    // focus. goBack() pops navPast (where typing in the search input pushed the
    // prior activeKey) and leaves tool:search on navFuture so Cmd+Right returns
    // to it — matches browser semantics.
    if (preSearchKeyRef.current && activeKey === 'tool:search') {
      useStore.getState().goBack();
    }
    preSearchKeyRef.current = null;
    searchRef.current?.blur();
  }, [clearSearch, activeKey]);

  // Open state per parent branch. Per-branch booleans drive the Collapsibles.
  // Persisted to ui-state.json so collapse choices survive across launches.
  const leftNavOpen = useStore((s) => s.ui.leftNavOpen);
  const setLeftNavGroup = useStore((s) => s.setLeftNavGroup);
  const openChannels = leftNavOpen.channels;
  const openContactGroups = leftNavOpen;
  const toggleContactGroup = useCallback(
    (kind: ContactKind) => {
      setLeftNavGroup(kind, !leftNavOpen[kind]);
    },
    [leftNavOpen, setLeftNavGroup],
  );

  const [menu, setMenu] = useState<ChannelMenuState | null>(null);
  const [contactMenu, setContactMenu] = useState<ContactMenuState | null>(null);
  const [channelsRowMenu, setChannelsRowMenu] = useState<{ x: number; y: number } | null>(null);

  // Per-branch "user clicked Show more" flags. Session-only by design — each
  // launch starts collapsed back to the limit so a bloated branch can't
  // permanently wedge the nav into a multi-hundred-row scroll.
  const collapseListsEnabled = useStore((s) => s.appSettings.leftNavCollapseLists.enabled);
  const collapseListsLimit = useStore((s) => s.appSettings.leftNavCollapseLists.limit);
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const revealList = useCallback((key: string) => {
    setRevealed((m) => ({ ...m, [key]: true }));
  }, []);

  // Aggregate counts shown on the parent button — sums per-key counts for items
  // in the group, so a collapsed branch still surfaces "there's something new".
  const channelUnreadTotal = useMemo(
    () => sortedChannels.reduce((acc, ch) => acc + (unreadByKey[ch.key] ?? 0), 0),
    [sortedChannels, unreadByKey],
  );
  const contactUnreadByKind = useMemo(() => {
    const out: Record<ContactKind, number> = { chat: 0, repeater: 0, room: 0, sensor: 0 };
    for (const c of sortedContacts) {
      out[c.kind] += unreadByKey[c.key] ?? 0;
    }
    return out;
  }, [sortedContacts, unreadByKey]);
  const contactsUnreadTotal = useMemo(
    () => contactUnreadByKind.chat + contactUnreadByKind.repeater + contactUnreadByKind.room + contactUnreadByKind.sensor,
    [contactUnreadByKind],
  );

  // Single combined open flag for the wrapping "Contacts" branch in nested mode.
  const openContacts = leftNavOpen.contacts;

  const renderContactSubItem = useCallback(
    (c: Contact) => (
      <ContactSubItem
        key={c.key}
        contact={c}
        active={activeKey === c.key}
        pinned={pinSet.has(c.key)}
        unread={unreadByKey[c.key] ?? 0}
        onSelect={() => setActiveKey(c.key)}
        onContextMenu={(e) => {
          e.preventDefault();
          setContactMenu({ contact: c, x: e.clientX, y: e.clientY });
        }}
      />
    ),
    [activeKey, pinSet, unreadByKey, setActiveKey],
  );

  const renderContactKindSub = useCallback(
    (kind: ContactKind) => {
      const items = contactsByKind[kind];
      const key = `contact:${kind}`;
      const shown = collapseListsEnabled && !revealed[key] ? items.slice(0, collapseListsLimit) : items;
      const hidden = items.length - shown.length;
      return (
        <SidebarMenuSub>
          {shown.map(renderContactSubItem)}
          {hidden > 0 && <ShowMoreRow count={hidden} onClick={() => revealList(key)} />}
        </SidebarMenuSub>
      );
    },
    [contactsByKind, collapseListsEnabled, collapseListsLimit, revealed, revealList, renderContactSubItem],
  );

  const onReorder = useCallback(
    async (orderedKeys: string[]) => {
      if (!client) return;
      try {
        await api.reorderChannels(client, orderedKeys);
      } catch (err) {
        notify.error(`Reorder failed: ${(err as Error).message}`, err);
      }
    },
    [client],
  );

  return (
    <Sidebar collapsible="icon" aria-label="Primary navigation">
      <SidebarHeader>
        <OwnerCard owner={owner} client={client} />
      </SidebarHeader>

      <SidebarContent className="[scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {showLeftNavSearch && (
          <div className="px-2 pt-2 group-data-[collapsible=icon]:hidden">
            <div className="relative">
              <Search
                aria-hidden="true"
                className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-cs-text-dim"
              />
              <input
                ref={searchRef}
                type="search"
                value={searchQuery}
                onChange={(e) => onSearchChange(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    e.preventDefault();
                    onSearchEscape();
                  }
                }}
                placeholder="Search messages…"
                aria-label="Search messages, channels, and contacts"
                className="h-7 w-full rounded-md border border-cs-border bg-cs-bg-3 pl-7 pr-7 text-xs text-cs-text outline-none placeholder:text-cs-text-dim focus:border-cs-accent"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={onSearchEscape}
                  aria-label="Clear search"
                  className="absolute right-1 top-1/2 flex size-5 -translate-y-1/2 items-center justify-center rounded text-cs-text-muted hover:bg-cs-bg-2 hover:text-cs-text"
                >
                  <X className="size-3" />
                </button>
              )}
            </div>
          </div>
        )}
        <SidebarGroup>
          <SidebarGroupLabel>Conversations</SidebarGroupLabel>
          <SidebarMenu>
            {showLeftNavUnreads && (
              <UnreadsNavItem
                totalUnread={totalUnread}
                isActive={activeKey === 'tool:unreads'}
                onSelect={() => setActiveKey('tool:unreads')}
              />
            )}
            <Popover open={addChannelOpen} onOpenChange={setAddChannelOpen}>
              <ParentBranch
                label="Channels"
                icon={Hash}
                open={openChannels}
                onToggle={() => setLeftNavGroup('channels', !openChannels)}
                unreadTotal={channelUnreadTotal}
                onContextMenu={(e) => {
                  if (!connected) return;
                  e.preventDefault();
                  setChannelsRowMenu({ x: e.clientX, y: e.clientY });
                }}
                trailingAction={
                  <SidebarMenuAction
                    asChild
                    aria-label="Add channel"
                    title={connected ? 'Add channel' : 'Connect a radio to add channels'}
                    disabled={!connected}
                    onClick={(e) => {
                      // Don't let the click bubble up to SidebarMenuButton, which would toggle the collapsible.
                      e.stopPropagation();
                    }}
                    className="text-cs-text-dim hover:text-cs-text disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <PopoverTrigger asChild>
                      <button type="button">
                        <Plus className="size-3" />
                      </button>
                    </PopoverTrigger>
                  </SidebarMenuAction>
                }
              >
                {sortedChannels.length === 0 ? (
                  <EmptySubHint>
                    {connected ? 'No channels on this radio.' : 'Connect a radio to sync channels.'}
                  </EmptySubHint>
                ) : (
                  <ChannelSubList
                    channels={sortedChannels}
                    activeKey={activeKey}
                    pinSet={pinSet}
                    presence={channelPresence}
                    unreadByKey={unreadByKey}
                    limit={collapseListsEnabled ? collapseListsLimit : null}
                    revealed={!!revealed.channels}
                    onShowMore={() => revealList('channels')}
                    onSelect={setActiveKey}
                    onReorder={onReorder}
                    onContext={(channel, e) => {
                      e.preventDefault();
                      setMenu({
                        channel,
                        onDevice: channelPresence.has(channel.key),
                        x: e.clientX,
                        y: e.clientY,
                      });
                    }}
                  />
                )}
              </ParentBranch>
              <PopoverContent
                align="start"
                sideOffset={6}
                className="w-72 p-0"
                onOpenAutoFocus={(e) => {
                  // Let the form's autoFocus input win instead of Radix's default
                  // focus-to-content behavior.
                  e.preventDefault();
                }}
              >
                <AddChannelPopover client={client} onClose={() => setAddChannelOpen(false)} />
              </PopoverContent>
            </Popover>

            {contactGrouping === 'top-level' ? (
              CONTACT_GROUP_ORDER.filter((k) => contactsByKind[k].length > 0).map((kind) => (
                <ParentBranch
                  key={kind}
                  label={CONTACT_GROUP_LABEL[kind]}
                  icon={CONTACT_GROUP_ICON[kind]}
                  open={openContactGroups[kind]}
                  onToggle={() => toggleContactGroup(kind)}
                  unreadTotal={contactUnreadByKind[kind]}
                >
                  {renderContactKindSub(kind)}
                </ParentBranch>
              ))
            ) : sortedContacts.length === 0 ? (
              <SidebarMenuItem>
                <SidebarMenuButton disabled className="italic text-cs-text-dim">
                  <Users />
                  <span>No contacts yet</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ) : (
              <ParentBranch
                label="Contacts"
                icon={Users}
                open={openContacts}
                onToggle={() => setLeftNavGroup('contacts', !openContacts)}
                unreadTotal={contactsUnreadTotal}
              >
                <SidebarMenuSub>
                  {CONTACT_GROUP_ORDER.filter((k) => contactsByKind[k].length > 0).map((kind) => (
                    <KindBranch
                      key={kind}
                      label={CONTACT_GROUP_LABEL[kind]}
                      icon={CONTACT_GROUP_ICON[kind]}
                      open={openContactGroups[kind]}
                      onToggle={() => toggleContactGroup(kind)}
                      unreadTotal={contactUnreadByKind[kind]}
                    >
                      {renderContactKindSub(kind)}
                    </KindBranch>
                  ))}
                </SidebarMenuSub>
              </ParentBranch>
            )}
          </SidebarMenu>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel>Tools</SidebarGroupLabel>
          <SidebarMenu>
            {TOOLS.map((t) => (
              <SidebarMenuItem key={t.key}>
                <SidebarMenuButton
                  tooltip={t.label}
                  isActive={activeKey === t.key}
                  onClick={() => setActiveKey(t.key)}
                  className={ACTIVE_BUTTON_CLASS}
                >
                  <t.icon />
                  <span>{t.label}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <ConnectionFooter
          client={client}
          state={transport}
          sync={syncProgress}
          onClick={() => setActiveKey('tool:bleconnect')}
          active={activeKey === 'tool:bleconnect'}
        />
      </SidebarFooter>

      <SidebarRail />

      {menu && (
        <ChannelContextMenu
          state={menu}
          client={client}
          isPinned={pinSet.has(menu.channel.key)}
          onTogglePin={togglePin}
          onClose={() => setMenu(null)}
        />
      )}
      {contactMenu && (
        <ContactContextMenu
          state={contactMenu}
          client={client}
          isPinned={pinSet.has(contactMenu.contact.key)}
          onTogglePin={togglePin}
          onClose={() => setContactMenu(null)}
        />
      )}
      {channelsRowMenu && (
        <ContextMenu
          x={channelsRowMenu.x}
          y={channelsRowMenu.y}
          items={[
            menuItem('Add channel…', () => setAddChannelOpen(true), {
              icon: Plus,
              disabled: !connected,
            }),
          ]}
          onClose={() => setChannelsRowMenu(null)}
        />
      )}
    </Sidebar>
  );
}
