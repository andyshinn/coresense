import type { LucideIcon } from 'lucide-react';
import {
  Activity,
  BellOff,
  Bluetooth,
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
  PinIcon,
  PinOff,
  Plus,
  Radio,
  RotateCw,
  ScrollText,
  Star,
  Trash2,
  Users,
} from 'lucide-react';
import {
  type DragEvent,
  type MouseEvent,
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
import { Collapsible } from '../components/Collapsible';
import {
  ContextMenu,
  type ContextMenuEntry,
  copyToClipboard,
  menuItem,
  menuSeparator,
} from '../components/ContextMenu';
import { Progress } from '../components/ui/progress';
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

const CONTACT_GROUP_LABEL: Record<ContactKind, string> = {
  chat: 'Users',
  repeater: 'Repeaters',
  room: 'Room Servers',
  sensor: 'Sensors',
};

// Render order for the four kind groups, both in nested and top-level modes.
const CONTACT_GROUP_ORDER: ContactKind[] = ['chat', 'repeater', 'room', 'sensor'];

interface ToolEntry {
  key: string;
  label: string;
  icon: LucideIcon;
}

const TOOLS: ToolEntry[] = [
  { key: 'tool:packetlog', label: 'Packet Log', icon: ScrollText },
  { key: 'tool:contacts', label: 'Contact Management', icon: Users },
  { key: 'tool:map', label: 'Map', icon: MapIcon },
  { key: 'tool:settings:app', label: 'Settings', icon: Cog },
];

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

  const [openChannels, setOpenChannels] = useState(true);
  const [openContacts, setOpenContacts] = useState(true);
  const [openContactGroups, setOpenContactGroups] = useState<Record<ContactKind, boolean>>({
    chat: true,
    repeater: true,
    room: true,
    sensor: true,
  });
  const toggleContactGroup = useCallback((kind: ContactKind) => {
    setOpenContactGroups((g) => ({ ...g, [kind]: !g[kind] }));
  }, []);
  const [openTools, setOpenTools] = useState(true);
  const [menu, setMenu] = useState<ChannelMenuState | null>(null);
  const [contactMenu, setContactMenu] = useState<ContactMenuState | null>(null);

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

  const renderContactItem = useCallback(
    (c: Contact) => (
      <NavItem
        key={c.key}
        active={activeKey === c.key}
        pinned={pinSet.has(c.key)}
        icon={CONTACT_ICON[c.kind]}
        label={c.name}
        unread={unreadByKey[c.key] ?? 0}
        muted={c.muted}
        onSelect={() => setActiveKey(c.key)}
        onContextMenu={(e) => {
          e.preventDefault();
          setContactMenu({ contact: c, x: e.clientX, y: e.clientY });
        }}
      />
    ),
    [activeKey, pinSet, unreadByKey, setActiveKey],
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
    <nav
      className="flex h-full w-60 shrink-0 flex-col border-r border-cs-border bg-cs-bg-2"
      aria-label="Primary navigation"
    >
      <OwnerCard owner={owner} />

      <div className="flex-1 overflow-y-auto py-1">
        <Collapsible
          label="Channels"
          sectionHeader
          open={openChannels}
          onToggle={() => setOpenChannels((v) => !v)}
          trailing={<AddButton title="New channel" />}
        >
          {sortedChannels.length === 0 ? (
            <EmptyHint>No channels yet.</EmptyHint>
          ) : (
            <ChannelList
              channels={sortedChannels}
              activeKey={activeKey}
              pinSet={pinSet}
              presence={channelPresence}
              unreadByKey={unreadByKey}
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
        </Collapsible>

        {contactGrouping === 'top-level' ? (
          sortedContacts.length === 0 ? (
            <Collapsible
              label="Contacts"
              sectionHeader
              open={openContacts}
              onToggle={() => setOpenContacts((v) => !v)}
              trailing={<AddButton title="Add contact" />}
            >
              <EmptyHint>Connect a radio to discover contacts.</EmptyHint>
            </Collapsible>
          ) : (
            CONTACT_GROUP_ORDER.filter((k) => contactsByKind[k].length > 0).map((kind) => (
              <Collapsible
                key={kind}
                label={CONTACT_GROUP_LABEL[kind]}
                sectionHeader
                open={openContactGroups[kind]}
                onToggle={() => toggleContactGroup(kind)}
              >
                <ul>{contactsByKind[kind].map(renderContactItem)}</ul>
              </Collapsible>
            ))
          )
        ) : (
          <Collapsible
            label="Contacts"
            sectionHeader
            open={openContacts}
            onToggle={() => setOpenContacts((v) => !v)}
            trailing={<AddButton title="Add contact" />}
          >
            {sortedContacts.length === 0 ? (
              <EmptyHint>Connect a radio to discover contacts.</EmptyHint>
            ) : (
              CONTACT_GROUP_ORDER.filter((k) => contactsByKind[k].length > 0).map((kind) => (
                <Collapsible
                  key={kind}
                  label={CONTACT_GROUP_LABEL[kind]}
                  open={openContactGroups[kind]}
                  onToggle={() => toggleContactGroup(kind)}
                >
                  <ul>{contactsByKind[kind].map(renderContactItem)}</ul>
                </Collapsible>
              ))
            )}
          </Collapsible>
        )}

        <Collapsible
          label="Tools"
          sectionHeader
          open={openTools}
          onToggle={() => setOpenTools((v) => !v)}
        >
          <ul>
            {TOOLS.map((t) => (
              <NavItem
                key={t.key}
                active={activeKey === t.key}
                pinned={false}
                icon={t.icon}
                label={t.label}
                onSelect={() => setActiveKey(t.key)}
              />
            ))}
          </ul>
        </Collapsible>
      </div>

      <ConnectionFooter
        client={client}
        state={transport}
        sync={syncProgress}
        onClick={() => setActiveKey('tool:bleconnect')}
        active={activeKey === 'tool:bleconnect'}
      />

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
    </nav>
  );
}

function ChannelList({
  channels,
  activeKey,
  pinSet,
  presence,
  unreadByKey,
  onSelect,
  onReorder,
  onContext,
}: {
  channels: Channel[];
  activeKey: string;
  pinSet: Set<string>;
  presence: Set<string>;
  unreadByKey: Record<string, number>;
  onSelect: (key: string) => void;
  onReorder: (orderedKeys: string[]) => void;
  onContext: (channel: Channel, e: MouseEvent) => void;
}) {
  const dragKey = useRef<string | null>(null);
  const [dragOver, setDragOver] = useState<string | null>(null);

  const onDragStart = (e: DragEvent, key: string) => {
    dragKey.current = key;
    e.dataTransfer.effectAllowed = 'move';
    // Some browsers require setData to actually start a drag.
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

  return (
    <ul>
      {channels.map((ch) => {
        const onDevice = presence.has(ch.key);
        return (
          <NavItem
            key={ch.key}
            active={activeKey === ch.key}
            pinned={pinSet.has(ch.key)}
            icon={CHANNEL_ICON[ch.kind]}
            label={ch.name}
            unread={unreadByKey[ch.key] ?? 0}
            muted={ch.muted}
            dimmed={!onDevice}
            dragging={dragOver === ch.key}
            draggable
            onDragStart={(e) => onDragStart(e, ch.key)}
            onDragOver={(e) => onDragOver(e, ch.key)}
            onDragLeave={() => setDragOver((k) => (k === ch.key ? null : k))}
            onDrop={(e) => onDrop(e, ch.key)}
            onSelect={() => onSelect(ch.key)}
            onContextMenu={(e) => onContext(ch, e)}
          />
        );
      })}
    </ul>
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

function OwnerCard({ owner }: { owner: Owner | null }) {
  return (
    <div className="border-b border-cs-border px-3 py-3">
      <div className="text-sm font-medium text-cs-text">{owner?.name ?? 'No identity'}</div>
      <div className="mt-0.5 font-mono text-[10px] tracking-wide text-cs-text-dim">
        {owner?.publicKeyShort ?? 'configure to send adverts'}
      </div>
    </div>
  );
}

interface NavItemProps {
  active: boolean;
  pinned: boolean;
  icon: LucideIcon;
  label: string;
  onSelect: () => void;
  unread?: number;
  muted?: boolean;
  dimmed?: boolean;
  dragging?: boolean;
  draggable?: boolean;
  onDragStart?: (e: DragEvent) => void;
  onDragOver?: (e: DragEvent) => void;
  onDragLeave?: () => void;
  onDrop?: (e: DragEvent) => void;
  onContextMenu?: (e: MouseEvent) => void;
}

function NavItem({
  active,
  pinned,
  icon: Icon,
  label,
  onSelect,
  unread = 0,
  muted,
  dimmed,
  dragging,
  draggable,
  onDragStart,
  onDragOver,
  onDragLeave,
  onDrop,
  onContextMenu,
}: NavItemProps) {
  // Hide chip when we're already viewing this conversation — the chip is
  // about "you have unread here"; on the active row the count would only
  // tick down as messages arrive, which is noisy.
  const showUnread = unread > 0 && !active;
  return (
    <li
      draggable={draggable}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      className={dragging ? 'border-t border-cs-accent' : undefined}
    >
      <button
        type="button"
        onClick={onSelect}
        onContextMenu={onContextMenu}
        className={cn(
          'flex w-full items-center gap-2 px-3 py-1 text-left text-sm transition-colors',
          active
            ? 'border-l-2 border-cs-accent bg-cs-accent-soft/30 text-cs-text'
            : 'border-l-2 border-transparent text-cs-text-muted hover:bg-cs-bg-3 hover:text-cs-text',
          dimmed && 'opacity-50',
        )}
      >
        <Icon size={12} aria-hidden="true" className="shrink-0" />
        <span
          className={cn(
            'flex-1 truncate',
            dimmed && 'italic',
            showUnread && 'font-medium text-cs-text',
          )}
        >
          {label}
        </span>
        {showUnread && (
          <span
            role="status"
            aria-label={`${unread} unread`}
            className="rounded-full bg-cs-accent px-1.5 py-px font-mono text-[10px] leading-none text-cs-bg tabular-nums"
          >
            {unread > 99 ? '99+' : unread}
          </span>
        )}
        {muted && <BellOff size={10} aria-label="muted" className="text-cs-text-dim" />}
        {pinned && (
          <Star size={10} aria-hidden="true" className="text-cs-accent" fill="currentColor" />
        )}
      </button>
    </li>
  );
}

function AddButton({ title }: { title: string }) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      className="ml-1 rounded p-0.5 text-cs-text-dim opacity-0 transition-opacity hover:bg-cs-bg-3 hover:text-cs-text group-hover:opacity-100"
    >
      <Plus size={11} />
    </button>
  );
}

function EmptyHint({ children }: { children: React.ReactNode }) {
  return <p className="px-3 py-1.5 text-[11px] italic text-cs-text-dim">{children}</p>;
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
  // Track whether the post-sync fade is still in flight. We render the bar at
  // 100% during this window with opacity-0, letting the transition animate it
  // out. Once the timer fires the bar is fully removed from the DOM.
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
    <div
      className={cn(
        'flex w-full items-stretch border-t border-cs-border text-xs transition-colors',
        active ? 'bg-cs-accent-soft/20 text-cs-text' : 'text-cs-text-muted',
      )}
    >
      <button
        type="button"
        onClick={onClick}
        className={cn(
          'flex flex-1 flex-col gap-1.5 px-3 py-2 text-left transition-colors',
          active ? '' : 'hover:bg-cs-bg-3 hover:text-cs-text',
        )}
      >
        <span className="flex items-center gap-2">
          <span className={cn('h-2 w-2 shrink-0 rounded-full', dotClass)} />
          <span className="flex-1 truncate">{label}</span>
          {syncing && (
            <span className="tabular-nums text-[10px] text-cs-text-dim">
              {done}/{total}
            </span>
          )}
          <Bluetooth size={11} aria-hidden="true" className="text-cs-text-dim" />
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
      </button>
      {canReconnect && (
        <button
          type="button"
          onClick={handleReconnect}
          title={`Reconnect to ${lastDevice?.name ?? 'last radio'}`}
          aria-label={`Reconnect to ${lastDevice?.name ?? 'last radio'}`}
          className="flex items-center justify-center border-l border-cs-border px-3 text-cs-text-muted transition-colors hover:bg-cs-bg-3 hover:text-cs-text"
        >
          <RotateCw size={14} aria-hidden="true" />
        </button>
      )}
    </div>
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
