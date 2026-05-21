import { Crosshair, MessageSquare, PanelRightClose, Settings } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import {
  type Channel,
  type Contact,
  hasValidFix,
  type Message,
  type MessageHop,
  type MessagePath,
} from '../../shared/types';
import { Collapsible } from '../components/Collapsible';
import { PathViewer } from '../components/path/PathViewer';
import { SetPathEditor } from '../components/path/SetPathEditor';
import type { ApiClient } from '../lib/api';
import { publish as publishMapBus } from '../lib/map/bus';
import { useStore } from '../lib/store';
import { fmtDateTime, fmtRelative } from '../lib/time';
import { cn } from '../lib/utils';
import { SettingsJumpRail } from './SettingsJumpRail';

// View "kind" derived from activeKey. Each kind has its own rail section set.
export type ViewKind = 'channel' | 'dm' | 'repeater' | 'packetlog' | 'tool' | 'none';

interface RailSection {
  id: string; // persisted key e.g. 'rail.channel.members'
  label: string;
  body: () => React.ReactNode;
  defaultOpen?: boolean;
}

interface RailData {
  channel: Channel | null;
  contact: Contact | null;
  selectedMessage: Message | null;
  mentionedContact: Contact | null;
  repeaters: Contact[];
}

const MIN_WIDTH = 240;
const MAX_WIDTH = 640;

interface RightRailProps {
  client: ApiClient | null;
}

export function RightRail({ client }: RightRailProps) {
  const activeKey = useStore((s) => s.ui.activeKey);
  const rightWidth = useStore((s) => s.ui.rightWidth);
  const openSections = useStore((s) => s.ui.openRailSections);
  const toggleRightRail = useStore((s) => s.toggleRightRail);
  const setRightWidth = useStore((s) => s.setRightWidth);
  const setRailSection = useStore((s) => s.setRailSection);

  // Each selector returns a primitive or a stable reference, so React's
  // snapshot equality check doesn't trip the infinite-update guard.
  const channels = useStore((s) => s.channels);
  const contacts = useStore((s) => s.contacts);
  const messagesByKey = useStore((s) => s.messagesByKey);
  const selectedMessageId = useStore((s) => s.selectedMessageId);
  const selectedContactKey = useStore((s) => s.ui.selectedContactKey);
  const setSelectedContact = useStore((s) => s.setSelectedContact);

  const data: RailData = useMemo(() => {
    const channel = activeKey.startsWith('ch:')
      ? (channels.find((c) => c.key === activeKey) ?? null)
      : null;
    const contact = activeKey.startsWith('c:')
      ? (contacts.find((c) => c.key === activeKey) ?? null)
      : null;
    const selectedMessage =
      selectedMessageId != null
        ? ((messagesByKey[activeKey] ?? []).find((m) => m.id === selectedMessageId) ?? null)
        : null;
    const mentionedContact = selectedContactKey
      ? (contacts.find((c) => c.key === selectedContactKey) ?? null)
      : null;
    const repeaters = contacts.filter((c) => c.kind === 'repeater');
    return { channel, contact, selectedMessage, mentionedContact, repeaters };
  }, [activeKey, channels, contacts, messagesByKey, selectedMessageId, selectedContactKey]);

  const sections = useMemo(
    () =>
      sectionsFor(activeKey, data, {
        clearMentionedContact: () => setSelectedContact(null),
        client,
      }),
    [activeKey, data, setSelectedContact, client],
  );

  return (
    <aside
      className="relative flex h-full shrink-0 flex-col border-l border-cs-border bg-cs-bg-2"
      style={{ width: `${rightWidth}px` }}
      aria-label="Detail rail"
    >
      <ResizeHandle width={rightWidth} onChange={setRightWidth} />

      <header className="flex items-center justify-between border-b border-cs-border px-3 py-2">
        <h2 className="font-mono text-[10px] uppercase tracking-wider text-cs-text-dim">
          {railTitle(activeKey)}
        </h2>
        <button
          type="button"
          onClick={toggleRightRail}
          title="Collapse rail (⌘.)"
          aria-label="Collapse rail"
          className="rounded p-0.5 text-cs-text-dim hover:bg-cs-bg-3 hover:text-cs-text"
        >
          <PanelRightClose size={12} />
        </button>
      </header>

      <div className="flex-1 overflow-y-auto py-1">
        {sections.map((section) => {
          const open = openSections[section.id] ?? section.defaultOpen ?? true;
          return (
            <Collapsible
              key={section.id}
              label={section.label}
              open={open}
              onToggle={() => setRailSection(section.id, !open)}
              className="border-b border-cs-border last:border-b-0"
            >
              <div className="px-3 py-2 text-xs text-cs-text-muted">{section.body()}</div>
            </Collapsible>
          );
        })}
      </div>
    </aside>
  );
}

function ResizeHandle({ width, onChange }: { width: number; onChange: (w: number) => void }) {
  const startRef = useRef<{ x: number; w: number } | null>(null);

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const target = e.currentTarget;
      target.setPointerCapture(e.pointerId);
      startRef.current = { x: e.clientX, w: width };
    },
    [width],
  );
  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!startRef.current) return;
      // Width grows as the pointer moves leftward (handle is on the rail's left edge).
      const delta = startRef.current.x - e.clientX;
      const next = clamp(startRef.current.w + delta, MIN_WIDTH, MAX_WIDTH);
      onChange(next);
    },
    [onChange],
  );
  const onPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.releasePointerCapture(e.pointerId);
    startRef.current = null;
  }, []);

  // Esc cancels an in-progress drag.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') startRef.current = null;
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      className="absolute -left-1 top-0 z-10 h-full w-2 cursor-col-resize"
    />
  );
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function viewKindFor(activeKey: string): ViewKind {
  if (activeKey.startsWith('ch:')) return 'channel';
  if (activeKey.startsWith('c:')) return 'dm'; // Repeater contacts route to 'repeater' once the protocol layer differentiates.
  if (activeKey === 'tool:packetlog') return 'packetlog';
  if (activeKey === 'tool:bleconnect') return 'none';
  if (activeKey.startsWith('tool:')) return 'tool';
  return 'none';
}

function railTitle(activeKey: string): string {
  if (activeKey.startsWith('tool:settings')) return 'Settings';
  const kind = viewKindFor(activeKey);
  switch (kind) {
    case 'channel':
      return 'Channel';
    case 'dm':
      return 'Contact';
    case 'repeater':
      return 'Repeater';
    case 'packetlog':
      return 'Packet';
    case 'tool':
      return 'Details';
    default:
      return 'Details';
  }
}

function sectionsFor(
  activeKey: string,
  data: RailData,
  actions: { clearMentionedContact: () => void; client: ApiClient | null },
): RailSection[] {
  // The Settings panel uses the rail as its section jump list — no message or
  // contact sections apply here.
  if (activeKey.startsWith('tool:settings')) {
    return [
      {
        id: 'rail.settings.jump',
        label: 'On this page',
        defaultOpen: true,
        body: () => <SettingsJumpRail />,
      },
    ];
  }

  // A selected message always promotes a "Message info" + "Heard via" pair at
  // the top of whichever view it belongs to.
  const sel = data.selectedMessage;
  const messageSections: RailSection[] = sel
    ? [
        {
          id: 'rail.message.info',
          label: 'Message info',
          defaultOpen: true,
          body: () => <MessageInfoSection message={sel} />,
        },
        {
          id: 'rail.message.heard',
          label: 'Heard via',
          body: () => <HeardViaSection message={sel} repeaters={data.repeaters} />,
        },
      ]
    : [];

  // A clicked @mention surfaces the mentioned contact above everything else.
  const mentioned = data.mentionedContact;
  const mentionedSections: RailSection[] = mentioned
    ? [
        {
          id: 'rail.mentioned.contact',
          label: `@${mentioned.name}`,
          defaultOpen: true,
          body: () => (
            <MentionedContactSection contact={mentioned} onClear={actions.clearMentionedContact} />
          ),
        },
      ]
    : [];

  const baseDefaultOpen = messageSections.length === 0 && mentionedSections.length === 0;
  switch (viewKindFor(activeKey)) {
    case 'channel':
      return [
        ...mentionedSections,
        ...messageSections,
        {
          id: 'rail.channel.info',
          label: 'Channel info',
          defaultOpen: baseDefaultOpen,
          body: () => <ChannelInfoSection channel={data.channel} />,
        },
        {
          id: 'rail.channel.members',
          label: 'Members',
          body: () => <Placeholder label="contacts heard in this channel" />,
        },
        {
          id: 'rail.channel.pinned',
          label: 'Pinned messages',
          body: () => <Placeholder label="pinned messages — coming in Phase 11" />,
        },
      ];
    case 'dm':
    case 'repeater':
      return [
        ...mentionedSections,
        ...messageSections,
        {
          id: 'rail.contact.card',
          label: 'Contact card',
          defaultOpen: baseDefaultOpen,
          body: () => <ContactCardSection contact={data.contact} />,
        },
        {
          id: 'rail.contact.path',
          label: 'Path',
          body: () =>
            data.contact && data.contact.publicKeyHex.length >= 64 ? (
              <SetPathEditor contact={data.contact} client={actions.client} />
            ) : (
              <Placeholder label="path editor needs a full public key (waiting on advert)" />
            ),
        },
        {
          id: 'rail.contact.advert',
          label: 'Last advert',
          body: () => <Placeholder label="advertised position, settings, hops" />,
        },
        {
          id: 'rail.contact.shared',
          label: 'Shared channels',
          body: () => <Placeholder label="channels this contact also sends to" />,
        },
      ];
    case 'packetlog':
      return [
        ...mentionedSections,
        {
          id: 'rail.packet.filter',
          label: 'Filter',
          defaultOpen: baseDefaultOpen,
          body: () => <Placeholder label="filter by kind, hex, RSSI" />,
        },
        {
          id: 'rail.packet.decoder',
          label: 'Decoder details',
          body: () => <Placeholder label="decoded fields of the selected packet" />,
        },
      ];
    default:
      return [
        ...mentionedSections,
        {
          id: 'rail.tool.placeholder',
          label: 'Details',
          defaultOpen: baseDefaultOpen,
          body: () => <Placeholder label="select a channel, contact, or message" />,
        },
      ];
  }
}

function ChannelInfoSection({ channel }: { channel: Channel | null }) {
  if (!channel) return <Placeholder label="unknown channel" />;
  return (
    <div className="space-y-1.5 text-cs-text-muted">
      <Field label="Name" value={channel.name} />
      <Field label="Kind" value={channel.kind} mono />
      {channel.secretHex && (
        <Field label="Secret" value={`${channel.secretHex.slice(0, 16)}…`} mono />
      )}
      <Field label="Muted" value={channel.muted ? 'yes' : 'no'} />
    </div>
  );
}

function MentionedContactSection({ contact, onClear }: { contact: Contact; onClear: () => void }) {
  return (
    <div className="space-y-2">
      <ContactCardSection contact={contact} />
      <button
        type="button"
        onClick={onClear}
        className="text-[10px] uppercase tracking-wider text-cs-text-dim hover:text-cs-text"
      >
        Clear
      </button>
    </div>
  );
}

function ContactCardSection({ contact }: { contact: Contact | null }) {
  const setActiveKey = useStore((s) => s.setActiveKey);
  const timeFormat = useStore((s) => s.appSettings.timeFormat);
  if (!contact) return <Placeholder label="unknown contact" />;
  const hasFix = hasValidFix(contact);
  const canAdminister = contact.kind === 'repeater' || contact.kind === 'sensor';
  return (
    <div className="space-y-1.5 text-cs-text-muted">
      <Field label="Name" value={contact.name} />
      <Field label="Kind" value={contact.kind} mono />
      <Field label="Public key" value={`${contact.publicKeyHex.slice(0, 16)}…`} mono />
      {contact.lastSeenMs != null && (
        <Field
          label="Last seen"
          value={fmtRelative(contact.lastSeenMs)}
          title={fmtDateTime(contact.lastSeenMs, timeFormat)}
        />
      )}
      {contact.rssi != null && <Field label="RSSI" value={`${contact.rssi} dBm`} mono />}
      {contact.hops != null && <Field label="Hops" value={String(contact.hops)} mono />}
      {hasFix && (
        <>
          <Field
            label="Position"
            value={`${(contact.gpsLat as number).toFixed(5)}, ${(contact.gpsLon as number).toFixed(5)}`}
            mono
          />
          <div className="flex flex-wrap gap-1.5 pt-1">
            <CardActionButton
              icon={MessageSquare}
              label="Open conversation"
              onClick={() => setActiveKey(contact.key)}
            />
            {canAdminister && (
              <CardActionButton
                icon={Settings}
                label="Administer"
                onClick={() => setActiveKey(contact.key)}
              />
            )}
            <CardActionButton
              icon={Crosshair}
              label="Center on map"
              onClick={() => {
                // Open the Map panel first; if it isn't mounted yet the bus
                // stashes this flyTo and replays it once MapCanvas subscribes.
                setActiveKey('tool:map');
                publishMapBus({
                  kind: 'flyTo',
                  lng: contact.gpsLon as number,
                  lat: contact.gpsLat as number,
                  zoom: 12,
                });
              }}
            />
          </div>
        </>
      )}
    </div>
  );
}

function CardActionButton({
  icon: Icon,
  label,
  onClick,
}: {
  icon: typeof MessageSquare;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1 rounded border border-cs-border bg-cs-bg-3 px-2 py-0.5 text-[10px] text-cs-text hover:bg-cs-border"
    >
      <Icon size={11} aria-hidden />
      {label}
    </button>
  );
}

function MessageInfoSection({ message }: { message: Message }) {
  const timeFormat = useStore((s) => s.appSettings.timeFormat);
  return (
    <div className="space-y-1.5 text-cs-text-muted">
      <Field label="Time" value={fmtDateTime(message.ts, timeFormat)} mono />
      <Field label="State" value={message.state} mono />
      <Field label="From" value={message.fromPublicKeyHex ?? '(self)'} mono />
      {message.meta?.rssi != null && <Field label="RSSI" value={`${message.meta.rssi} dBm`} mono />}
      {message.meta?.snr != null && <Field label="SNR" value={`${message.meta.snr} dB`} mono />}
      {message.meta?.hops != null && <Field label="Hops" value={String(message.meta.hops)} mono />}
      {message.meta?.signatureHex && (
        <Field label="Sig" value={`${message.meta.signatureHex.slice(0, 16)}…`} mono />
      )}
    </div>
  );
}

function HeardViaSection({ message, repeaters }: { message: Message; repeaters: Contact[] }) {
  const paths = message.meta?.paths ?? [];
  const fallbackHops = message.meta?.hops;

  // Fallback for messages without correlated mesh observations (e.g. ones that
  // came in before the bridge connected): synthesize a single path of N
  // unnamed hops from the hop count alone so the user still sees a timeline.
  const effectivePaths: MessagePath[] =
    paths.length > 0
      ? paths
      : fallbackHops != null && fallbackHops > 0
        ? [synthesizeUnnamedPath(message, fallbackHops)]
        : [];

  if (effectivePaths.length === 0) return <Placeholder label="no path data" />;

  return (
    <PathViewer
      paths={effectivePaths}
      timesHeard={message.meta?.timesHeard ?? 1}
      knownRepeaters={repeaters}
    />
  );
}

function synthesizeUnnamedPath(message: Message, hopCount: number): MessagePath {
  const hops: MessageHop[] = [];
  const senderName = message.fromPublicKeyHex?.startsWith('name:')
    ? message.fromPublicKeyHex.slice(5)
    : null;
  hops.push({
    kind: 'origin',
    shortId: senderName ? senderName.slice(0, 2).toLowerCase() : '??',
    name: senderName ?? null,
    pk: null,
    unnamed: senderName == null,
  });
  for (let i = 0; i < hopCount; i++) {
    hops.push({ kind: 'hop', shortId: '??', name: null, pk: null, unnamed: true });
  }
  hops.push({ kind: 'sink', shortId: 'me', name: 'My radio', pk: null });
  return {
    id: `synth-${message.id}`,
    hops,
    hashMode: 1,
    finalSnr: message.meta?.snr ?? 0,
  };
}

function Field({
  label,
  value,
  mono,
  title,
}: {
  label: string;
  value: string;
  mono?: boolean;
  /** Hover text — used to show the absolute timestamp behind a relative one. */
  title?: string;
}) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="w-16 shrink-0 text-[10px] uppercase tracking-wider text-cs-text-dim">
        {label}
      </span>
      <span title={title} className={cn('truncate text-cs-text', mono && 'font-mono text-[11px]')}>
        {value}
      </span>
    </div>
  );
}

function Placeholder({ label }: { label: string }) {
  return <p className={cn('italic text-cs-text-dim')}>{label}</p>;
}
