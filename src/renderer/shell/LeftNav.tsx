import type { LucideIcon } from 'lucide-react';
import {
  Activity,
  BellOff,
  Bluetooth,
  ChevronRight,
  Cog,
  Copy,
  DoorOpen,
  Globe,
  Hash,
  Lock,
  Map as MapIcon,
  Megaphone,
  MessageCircle,
  Minus,
  MoreHorizontal,
  PinIcon,
  PinOff,
  Plus,
  Radio,
  RotateCw,
  ScrollText,
  Search,
  Star,
  Trash2,
  User,
  Users,
  X,
} from 'lucide-react';
import { Collapsible } from 'radix-ui';
import {
  type DragEvent,
  type MouseEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type {
  Channel,
  ChannelKind,
  Contact,
  ContactKind,
  Owner,
  SyncProgress,
  TransportState,
} from '../../shared/types';
import {
  ContextMenu,
  type ContextMenuEntry,
  copyToClipboard,
  menuItem,
  menuSeparator,
} from '../components/ContextMenu';
import { Progress } from '../components/ui/progress';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarRail,
  useSidebar,
} from '../components/ui/sidebar';
import { type ApiClient, api } from '../lib/api';
import { loadLastDevice } from '../lib/lastDevice';
import { notify } from '../lib/notify';
import { useStore } from '../lib/store';
import { cn } from '../lib/utils';

const CHANNEL_ICON: Record<ChannelKind, LucideIcon> = {
  public: Globe,
  hashtag: Hash,
  private: Lock,
};

const CONTACT_ICON: Record<ContactKind, LucideIcon> = {
  chat: MessageCircle,
  repeater: Radio,
  sensor: Activity,
  room: DoorOpen,
};

const CONTACT_GROUP_ICON: Record<ContactKind, LucideIcon> = {
  chat: Users,
  repeater: Radio,
  room: DoorOpen,
  sensor: Activity,
};

const CONTACT_GROUP_LABEL: Record<ContactKind, string> = {
  chat: 'Users',
  repeater: 'Repeaters',
  room: 'Room Servers',
  sensor: 'Sensors',
};

// Render order for the four kind groups.
const CONTACT_GROUP_ORDER: ContactKind[] = ['chat', 'repeater', 'room', 'sensor'];

interface ToolEntry {
  key: string;
  label: string;
  icon: LucideIcon;
}

const TOOLS: ToolEntry[] = [
  { key: 'tool:search', label: 'Search', icon: Search },
  { key: 'tool:packetlog', label: 'Packet Log', icon: ScrollText },
  { key: 'tool:contacts', label: 'Contact Management', icon: Users },
  { key: 'tool:map', label: 'Map', icon: MapIcon },
  { key: 'tool:settings:app', label: 'Settings', icon: Cog },
];

// Shared active styling: a visible left bar on the menu item (in addition to
// the indent border that SidebarMenuSub already draws) plus a soft accent fill.
// Applied to both top-level buttons and sub buttons so the visual cue is the
// same regardless of depth.
// Active styling that survives hover. The base SidebarMenuButton CVA applies
// `hover:bg-sidebar-accent`, which would otherwise flip an active row off its
// accent fill mid-hover — looks like the highlight is inverted. Re-asserting
// the active treatment under `hover:` keeps it stable.
const ACTIVE_BUTTON_CLASS = cn(
  'border-l-2 border-transparent rounded-l-none text-cs-text-muted hover:text-cs-text',
  // Keep icons at full brightness even when the text is dimmed — matches the
  // sub-button CVA, which pins svg color via `[&>svg]:text-sidebar-accent-foreground`.
  // Without this, a top-level button's icon inherits currentColor and dims with the label.
  '[&>svg]:text-cs-text',
  'data-[active=true]:border-cs-accent data-[active=true]:bg-cs-accent-soft/30 data-[active=true]:text-cs-text data-[active=true]:font-normal',
  'data-[active=true]:hover:bg-cs-accent-soft/30 data-[active=true]:hover:text-cs-text',
);

interface ChannelMenuState {
  channel: Channel;
  onDevice: boolean;
  x: number;
  y: number;
}

interface ContactMenuState {
  contact: Contact;
  x: number;
  y: number;
}

interface LeftNavProps {
  client: ApiClient | null;
}

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
  const messagesByKey = useStore((s) => s.messagesByKey);
  const lastReadByKey = useStore((s) => s.ui.lastReadByKey);
  const setActiveKey = useStore((s) => s.setActiveKey);

  // Per-conversation unread count. A message is unread when state === 'received'
  // (so our own sends never count) and its timestamp is past the per-key marker
  // we update via markRead(). Cheap O(N) over all rendered messages; for large
  // backlogs (>500 per key) we'd want to short-circuit from the newest end.
  const unreadByKey = useMemo(() => {
    const out: Record<string, number> = {};
    for (const [key, list] of Object.entries(messagesByKey)) {
      const lastRead = lastReadByKey[key] ?? 0;
      let count = 0;
      for (const m of list) {
        if (m.state === 'received' && m.ts > lastRead) count += 1;
      }
      if (count > 0) out[key] = count;
    }
    return out;
  }, [messagesByKey, lastReadByKey]);

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
    () =>
      sortByPinned(contacts, pinSet, pinned, (c) => c.name, pinUnreadToTop ? unreadByKey : null),
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

  // Cmd/Ctrl+F focuses the sidebar search — distinct from the command palette
  // (Cmd+K). Typing into it routes to the tool:search panel; the sidebar tree
  // itself is no longer mutated by search.
  useEffect(() => {
    if (!showLeftNavSearch) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showLeftNavSearch]);

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
    if (preSearchKeyRef.current && activeKey === 'tool:search') {
      setActiveKey(preSearchKeyRef.current);
    }
    preSearchKeyRef.current = null;
    searchRef.current?.blur();
  }, [clearSearch, setActiveKey, activeKey]);

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
    () =>
      contactUnreadByKind.chat +
      contactUnreadByKind.repeater +
      contactUnreadByKind.room +
      contactUnreadByKind.sensor,
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
      const shown =
        collapseListsEnabled && !revealed[key] ? items.slice(0, collapseListsLimit) : items;
      const hidden = items.length - shown.length;
      return (
        <SidebarMenuSub>
          {shown.map(renderContactSubItem)}
          {hidden > 0 && <ShowMoreRow count={hidden} onClick={() => revealList(key)} />}
        </SidebarMenuSub>
      );
    },
    [
      contactsByKind,
      collapseListsEnabled,
      collapseListsLimit,
      revealed,
      revealList,
      renderContactSubItem,
    ],
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
        <OwnerCard owner={owner} />
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
            <ParentBranch
              label="Channels"
              icon={Hash}
              open={openChannels}
              onToggle={() => setLeftNavGroup('channels', !openChannels)}
              unreadTotal={channelUnreadTotal}
            >
              {sortedChannels.length === 0 ? (
                <EmptySubHint>No channels yet.</EmptySubHint>
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
    </Sidebar>
  );
}

// A top-level menu row that opens a submenu. Sidebar-07 pattern: icon + label
// + rotating chevron on the parent button, SidebarMenuSub as the body. The
// chevron rotates via the radix Collapsible's data-state attribute.
function ParentBranch({
  label,
  icon: Icon,
  open,
  onToggle,
  unreadTotal,
  children,
}: {
  label: string;
  icon: LucideIcon;
  open: boolean;
  onToggle: () => void;
  unreadTotal: number;
  children: ReactNode;
}) {
  // In icon-collapsed mode the submenu is hidden via CSS, so a normal
  // Collapsible-toggle click does nothing visible. Treat the click as
  // "expand the sidebar and ensure this branch is open" instead — the user's
  // intent (see this group's contents) is the same either way.
  const { state, setOpen } = useSidebar();
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
      <SidebarMenuItem>
        <SidebarMenuButton tooltip={label} onClick={handleClick}>
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
          <ChevronRight
            className={cn(
              'transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90',
              unreadTotal > 0 ? '' : 'ml-auto',
            )}
          />
        </SidebarMenuButton>
        <Collapsible.Content>{children}</Collapsible.Content>
      </SidebarMenuItem>
    </Collapsible.Root>
  );
}

// Inner branch nested inside a SidebarMenuSub. Follows the sidebar-11 tree
// pattern: chevron-first button (svg:first-child rotates on open), then icon
// + label. Renders as a SidebarMenuItem (li) inside the parent SidebarMenuSub,
// with its own SidebarMenuSub for children — so a second left border + indent
// stacks naturally to mark the nested level.
function KindBranch({
  label,
  icon: Icon,
  open,
  onToggle,
  unreadTotal,
  children,
}: {
  label: string;
  icon: LucideIcon;
  open: boolean;
  onToggle: () => void;
  unreadTotal: number;
  children: ReactNode;
}) {
  return (
    <SidebarMenuItem>
      <Collapsible.Root
        open={open}
        onOpenChange={onToggle}
        className="group/kind [&[data-state=open]>button>svg:first-child]:rotate-90"
      >
        <Collapsible.Trigger asChild>
          <SidebarMenuButton className="h-7 text-xs">
            <ChevronRight className="transition-transform" />
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
          </SidebarMenuButton>
        </Collapsible.Trigger>
        <Collapsible.Content>{children}</Collapsible.Content>
      </Collapsible.Root>
    </SidebarMenuItem>
  );
}

function ChannelSubList({
  channels,
  activeKey,
  pinSet,
  presence,
  unreadByKey,
  limit,
  revealed,
  onShowMore,
  onSelect,
  onReorder,
  onContext,
}: {
  channels: Channel[];
  activeKey: string;
  pinSet: Set<string>;
  presence: Set<string>;
  unreadByKey: Record<string, number>;
  /** Max rows to render before the Show-more affordance; `null` disables capping. */
  limit: number | null;
  revealed: boolean;
  onShowMore: () => void;
  onSelect: (key: string) => void;
  onReorder: (orderedKeys: string[]) => void;
  onContext: (channel: Channel, e: MouseEvent) => void;
}) {
  const dragKey = useRef<string | null>(null);
  const [dragOver, setDragOver] = useState<string | null>(null);

  const onDragStart = (e: DragEvent, key: string) => {
    dragKey.current = key;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', key);
  };
  const onDragOver = (e: DragEvent, key: string) => {
    if (!dragKey.current || dragKey.current === key) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOver(key);
  };
  const onDrop = (e: DragEvent, key: string) => {
    e.preventDefault();
    const src = dragKey.current;
    dragKey.current = null;
    setDragOver(null);
    if (!src || src === key) return;
    const keys = channels.map((c) => c.key);
    const from = keys.indexOf(src);
    const to = keys.indexOf(key);
    if (from === -1 || to === -1) return;
    keys.splice(from, 1);
    keys.splice(to, 0, src);
    onReorder(keys);
  };

  const shown = limit !== null && !revealed ? channels.slice(0, limit) : channels;
  const hidden = channels.length - shown.length;
  return (
    <SidebarMenuSub>
      {shown.map((ch) => {
        const onDevice = presence.has(ch.key);
        const Icon = CHANNEL_ICON[ch.kind];
        const unread = unreadByKey[ch.key] ?? 0;
        const active = activeKey === ch.key;
        const showUnread = unread > 0 && !active;
        return (
          <SidebarMenuSubItem
            key={ch.key}
            draggable
            onDragStart={(e) => onDragStart(e, ch.key)}
            onDragOver={(e) => onDragOver(e, ch.key)}
            onDragLeave={() => setDragOver((k) => (k === ch.key ? null : k))}
            onDrop={(e) => onDrop(e, ch.key)}
            className={dragOver === ch.key ? 'border-t border-cs-accent' : undefined}
          >
            <SidebarMenuSubButton
              isActive={active}
              onClick={() => onSelect(ch.key)}
              onContextMenu={(e) => onContext(ch, e)}
              className={cn(ACTIVE_BUTTON_CLASS, !onDevice && 'opacity-50')}
              asChild
            >
              <button type="button">
                <Icon />
                <span className={cn('flex-1 truncate', !onDevice && 'italic')}>{ch.name}</span>
                {showUnread && <UnreadChip count={unread} />}
                {ch.muted && <BellOff aria-label="muted" className="size-3 text-cs-text-dim" />}
                {pinSet.has(ch.key) && (
                  <Star aria-hidden="true" className="size-3 text-cs-accent" fill="currentColor" />
                )}
              </button>
            </SidebarMenuSubButton>
          </SidebarMenuSubItem>
        );
      })}
      {hidden > 0 && <ShowMoreRow count={hidden} onClick={onShowMore} />}
    </SidebarMenuSub>
  );
}

function ContactSubItem({
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
          {contact.muted && <BellOff aria-label="muted" className="size-3 text-cs-text-dim" />}
          {pinned && (
            <Star aria-hidden="true" className="size-3 text-cs-accent" fill="currentColor" />
          )}
        </button>
      </SidebarMenuSubButton>
    </SidebarMenuSubItem>
  );
}

function UnreadChip({ count }: { count: number }) {
  return (
    <span
      role="status"
      aria-label={`${count} unread`}
      className="rounded-full bg-cs-accent px-1.5 py-px font-mono text-[10px] leading-none text-cs-bg tabular-nums"
    >
      {count > 99 ? '99+' : count}
    </span>
  );
}

// Trailing affordance for capped branches. Reveals the rest of the list for
// the current session — there's no Show-less counterpart by design (the
// re-collapse happens implicitly on next launch).
function ShowMoreRow({ count, onClick }: { count: number; onClick: () => void }) {
  return (
    <SidebarMenuSubItem>
      <SidebarMenuSubButton
        onClick={onClick}
        className="text-cs-text-muted hover:text-cs-text"
        asChild
      >
        <button type="button">
          <MoreHorizontal />
          <span>Show {count} more</span>
        </button>
      </SidebarMenuSubButton>
    </SidebarMenuSubItem>
  );
}

function EmptySubHint({ children }: { children: ReactNode }) {
  return (
    <SidebarMenuSub>
      <SidebarMenuSubItem>
        <span className="px-2 py-1 text-[11px] italic text-cs-text-dim">{children}</span>
      </SidebarMenuSubItem>
    </SidebarMenuSub>
  );
}

function ChannelContextMenu({
  state,
  client,
  isPinned,
  onTogglePin,
  onClose,
}: {
  state: ChannelMenuState;
  client: ApiClient | null;
  isPinned: boolean;
  onTogglePin: (key: string) => void;
  onClose: () => void;
}) {
  const { channel, onDevice, x, y } = state;
  const transport = useStore((s) => s.transportState);
  const connected = transport === 'connected';

  const items: ContextMenuEntry[] = [
    menuItem(isPinned ? 'Unpin' : 'Pin to top', () => onTogglePin(channel.key), {
      icon: isPinned ? PinOff : PinIcon,
    }),
    menuItem(
      channel.muted ? 'Unmute' : 'Mute',
      async () => {
        if (!client) return;
        try {
          await api.putChannel(client, { ...channel, muted: !channel.muted });
        } catch (err) {
          notify.error(`Mute toggle failed: ${(err as Error).message}`, err);
        }
      },
      { icon: BellOff, disabled: !client },
    ),
    menuItem('Copy name', () => copyToClipboard(channel.name, () => notify.success('Copied')), {
      icon: Copy,
    }),
    menuSeparator,
    onDevice
      ? menuItem(
          'Remove from device',
          async () => {
            if (!client) return;
            try {
              await api.removeChannelFromDevice(client, channel.key);
              notify.success(`Removed "${channel.name}" from device`);
            } catch (err) {
              notify.error(`Remove failed: ${(err as Error).message}`, err);
            }
          },
          { icon: Minus, disabled: !connected || !client },
        )
      : menuItem(
          'Add to device',
          async () => {
            if (!client) return;
            try {
              const res = await api.pushChannelToDevice(client, channel.key);
              notify.success(`Added "${channel.name}" to device (slot ${res.idx})`);
            } catch (err) {
              notify.error(`Add failed: ${(err as Error).message}`, err);
            }
          },
          { icon: Plus, disabled: !connected || !client },
        ),
    menuSeparator,
    menuItem(
      'Delete from app (clears history)',
      async () => {
        if (!client) return;
        try {
          await api.deleteChannel(client, channel.key);
          notify.success(`Deleted "${channel.name}" from app`);
        } catch (err) {
          notify.error(`Delete failed: ${(err as Error).message}`, err);
        }
      },
      { icon: Trash2, danger: true, disabled: !client },
    ),
  ];

  return <ContextMenu x={x} y={y} items={items} onClose={onClose} />;
}

function ContactContextMenu({
  state,
  client,
  isPinned,
  onTogglePin,
  onClose,
}: {
  state: ContactMenuState;
  client: ApiClient | null;
  isPinned: boolean;
  onTogglePin: (key: string) => void;
  onClose: () => void;
}) {
  const { contact, x, y } = state;
  const transport = useStore((s) => s.transportState);
  const connected = transport === 'connected';
  const setActiveKey = useStore((s) => s.setActiveKey);

  const items: ContextMenuEntry[] = [
    menuItem('Open', () => setActiveKey(contact.key)),
    menuItem(isPinned ? 'Unpin' : 'Pin to top', () => onTogglePin(contact.key), {
      icon: isPinned ? PinOff : PinIcon,
    }),
    menuItem(
      contact.muted ? 'Unmute' : 'Mute',
      async () => {
        if (!client) return;
        try {
          await api.putContact(client, { ...contact, muted: !contact.muted });
        } catch (err) {
          notify.error(`Mute toggle failed: ${(err as Error).message}`, err);
        }
      },
      { icon: BellOff, disabled: !client },
    ),
    menuSeparator,
    menuItem(
      'Copy public key',
      () => copyToClipboard(contact.publicKeyHex, () => notify.success('Public key copied')),
      { icon: Copy },
    ),
    menuItem(
      'Send self-advert',
      async () => {
        if (!client) return;
        try {
          await api.sendAdvert(client);
          notify.success('Self-advert sent');
        } catch (err) {
          notify.error(`Advert failed: ${(err as Error).message}`, err);
        }
      },
      { icon: Megaphone, disabled: !connected || !client },
    ),
    menuSeparator,
    menuItem(
      'Remove (clears history)',
      async () => {
        if (!client) return;
        try {
          await api.deleteContact(client, contact.key);
          notify.success(`Removed "${contact.name}"`);
        } catch (err) {
          notify.error(`Remove failed: ${(err as Error).message}`, err);
        }
      },
      { icon: Trash2, danger: true, disabled: !client },
    ),
  ];

  return <ContextMenu x={x} y={y} items={items} onClose={onClose} />;
}

// Header card — team-switcher pattern from sidebar-07 so it collapses
// gracefully to just the avatar tile in icon mode.
function OwnerCard({ owner }: { owner: Owner | null }) {
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <SidebarMenuButton
          size="lg"
          tooltip={owner?.name ?? 'No identity'}
          className="cursor-default hover:bg-transparent hover:text-cs-text"
        >
          <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-cs-accent-soft/40 text-cs-accent">
            <User className="size-4" />
          </div>
          <div className="grid flex-1 text-left text-sm leading-tight">
            <span className="truncate font-medium text-cs-text">
              {owner?.name ?? 'No identity'}
            </span>
            <span className="truncate font-mono text-[10px] tracking-wide text-cs-text-dim">
              {owner?.publicKeyShort ?? 'configure to send adverts'}
            </span>
          </div>
        </SidebarMenuButton>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}

const TRANSPORT_LABEL: Record<TransportState, string> = {
  idle: 'Not connected',
  scanning: 'Scanning',
  connecting: 'Connecting',
  connected: 'Connected',
  error: 'Error',
};

const TRANSPORT_DOT: Record<TransportState, string> = {
  idle: 'bg-cs-text-dim',
  scanning: 'bg-cs-warn animate-pulse',
  connecting: 'bg-cs-accent animate-pulse',
  connected: 'bg-cs-online',
  error: 'bg-cs-danger',
};

// After the handshake completes we briefly keep the 100% progress bar visible
// so the user can register the jump to "Connected", then fade it out. Keep
// this short enough that it doesn't linger but long enough to be perceptible.
const SYNC_DONE_FADE_MS = 800;

function ConnectionFooter({
  client,
  state,
  sync,
  onClick,
  active,
}: {
  client: ApiClient | null;
  state: TransportState;
  sync: SyncProgress;
  onClick: () => void;
  active: boolean;
}) {
  const syncing = state === 'connected' && sync.phase === 'syncing';
  const justFinished = state === 'connected' && sync.phase === 'done';
  const [reconnecting, setReconnecting] = useState(false);
  const lastDevice = loadLastDevice();
  const canReconnect =
    !!client && !!lastDevice && (state === 'idle' || state === 'error') && !reconnecting;

  const handleReconnect = useCallback(
    async (e: MouseEvent) => {
      e.stopPropagation();
      if (!client || !lastDevice) return;
      setReconnecting(true);
      try {
        await api.connect(client, lastDevice.id);
      } catch (err) {
        notify.error(`Reconnect failed: ${(err as Error).message}`, err);
      } finally {
        setReconnecting(false);
      }
    },
    [client, lastDevice],
  );
  const [showFinishedBar, setShowFinishedBar] = useState(false);
  useEffect(() => {
    if (!justFinished) {
      setShowFinishedBar(false);
      return;
    }
    setShowFinishedBar(true);
    const t = setTimeout(() => setShowFinishedBar(false), SYNC_DONE_FADE_MS);
    return () => clearTimeout(t);
  }, [justFinished]);

  const showProgress = syncing || showFinishedBar;
  const dotClass = syncing ? TRANSPORT_DOT.scanning : TRANSPORT_DOT[state];
  const done = sync.channels.done + sync.contacts.done;
  const total = sync.channels.total + sync.contacts.total;
  const pct = syncing && total > 0 ? Math.round((done / total) * 100) : 100;
  const label = syncing ? 'Syncing' : TRANSPORT_LABEL[state];

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <SidebarMenuButton
          tooltip={label}
          isActive={active}
          onClick={onClick}
          className={cn(
            ACTIVE_BUTTON_CLASS,
            'h-auto flex-col items-stretch gap-1.5 group-data-[collapsible=icon]:flex-row',
          )}
        >
          <span className="flex w-full items-center gap-2">
            <Bluetooth
              aria-hidden="true"
              className="shrink-0 group-data-[collapsible=icon]:hidden"
            />
            {/* In icon mode this dot is the only visible element. Bumping it
                from size-2 to size-2.5 there gives a more legible target inside
                the 32px icon button. */}
            <span
              className={cn(
                'size-2 shrink-0 rounded-full group-data-[collapsible=icon]:size-2.5',
                dotClass,
              )}
            />
            <span className="flex-1 truncate text-left group-data-[collapsible=icon]:hidden">
              {label}
            </span>
            {syncing && (
              <span className="tabular-nums text-[10px] text-cs-text-dim group-data-[collapsible=icon]:hidden">
                {done}/{total}
              </span>
            )}
          </span>
          {showProgress && (
            <Progress
              value={pct}
              aria-label="Sync progress"
              className={cn(
                'h-1 bg-cs-warn/20 transition-opacity duration-500 *:data-[slot=progress-indicator]:bg-cs-warn',
                syncing ? 'opacity-100' : 'opacity-0',
              )}
            />
          )}
        </SidebarMenuButton>
        {canReconnect && (
          <button
            type="button"
            onClick={handleReconnect}
            title={`Reconnect to ${lastDevice?.name ?? 'last radio'}`}
            aria-label={`Reconnect to ${lastDevice?.name ?? 'last radio'}`}
            className="absolute right-1 top-1/2 flex aspect-square size-7 -translate-y-1/2 items-center justify-center rounded-md text-cs-text-muted transition-colors hover:bg-cs-bg-3 hover:text-cs-text group-data-[collapsible=icon]:hidden"
          >
            <RotateCw aria-hidden="true" className="size-4" />
          </button>
        )}
      </SidebarMenuItem>
    </SidebarMenu>
  );
}

// Channels: when `unreadByKey` is provided (Pin-unread-to-top app setting),
// any item with an unread count floats above both pinned and ordered rows.
// Within unread, pinned still wins; within everything else, the existing
// pin → order → alpha ordering applies.
function sortChannels(
  items: Channel[],
  pinSet: Set<string>,
  pinnedOrder: string[],
  unreadByKey: Record<string, number> | null,
): Channel[] {
  const pinnedIdx = new Map(pinnedOrder.map((k, i) => [k, i]));
  return [...items].sort((a, b) => {
    if (unreadByKey) {
      const au = (unreadByKey[a.key] ?? 0) > 0;
      const bu = (unreadByKey[b.key] ?? 0) > 0;
      if (au !== bu) return au ? -1 : 1;
    }
    const ap = pinSet.has(a.key);
    const bp = pinSet.has(b.key);
    if (ap && !bp) return -1;
    if (!ap && bp) return 1;
    if (ap && bp) return (pinnedIdx.get(a.key) ?? 0) - (pinnedIdx.get(b.key) ?? 0);
    const ao = a.order ?? Number.POSITIVE_INFINITY;
    const bo = b.order ?? Number.POSITIVE_INFINITY;
    if (ao !== bo) return ao - bo;
    return a.name.localeCompare(b.name);
  });
}

// Generic pinned-then-alphabetical sort for contacts (no manual order yet).
function sortByPinned<T extends { key: string }>(
  items: T[],
  pinSet: Set<string>,
  pinnedOrder: string[],
  fallbackSort: (item: T) => string,
  unreadByKey: Record<string, number> | null,
): T[] {
  const pinnedIdx = new Map(pinnedOrder.map((k, i) => [k, i]));
  return [...items].sort((a, b) => {
    if (unreadByKey) {
      const au = (unreadByKey[a.key] ?? 0) > 0;
      const bu = (unreadByKey[b.key] ?? 0) > 0;
      if (au !== bu) return au ? -1 : 1;
    }
    const ap = pinSet.has(a.key);
    const bp = pinSet.has(b.key);
    if (ap && !bp) return -1;
    if (!ap && bp) return 1;
    if (ap && bp) return (pinnedIdx.get(a.key) ?? 0) - (pinnedIdx.get(b.key) ?? 0);
    return fallbackSort(a).localeCompare(fallbackSort(b));
  });
}
