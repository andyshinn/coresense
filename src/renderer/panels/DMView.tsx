import type { LucideIcon } from 'lucide-react';
import { Activity, DoorOpen, MessageCircle, Radio } from 'lucide-react';
import { useCallback, useEffect, useRef } from 'react';
import type { Contact } from '../../shared/types';
import { Composer, type ComposerHandle } from '../components/Composer';
import { MessageList } from '../components/MessageList';
import { RssiChip } from '../components/RssiChip';
import { type ApiClient, api } from '../lib/api';
import { notify } from '../lib/notify';
import { useStore } from '../lib/store';

const CONTACT_ICON: Record<Contact['kind'], LucideIcon> = {
  chat: MessageCircle,
  repeater: Radio,
  sensor: Activity,
  room: DoorOpen,
};

// Same reasoning as ChannelView — a stable empty array prevents the
// snapshot-cache infinite-loop when this DM has no messages yet.
const EMPTY_MESSAGES: never[] = [];

interface Props {
  contact: Contact;
  client: ApiClient | null;
}

export function DMView({ contact, client }: Props) {
  const owner = useStore((s) => s.owner);
  const contacts = useStore((s) => s.contacts);
  const messages = useStore((s) => s.messagesByKey[contact.key]) ?? EMPTY_MESSAGES;
  const selectedId = useStore((s) => s.selectedMessageId);
  const setSelectedMessage = useStore((s) => s.setSelectedMessage);
  const pendingJumpMid = useStore((s) => s.pendingJumpMid);
  const setPendingJump = useStore((s) => s.setPendingJump);
  const appSettings = useStore((s) => s.appSettings);
  const radioSettings = useStore((s) => s.radioSettings);
  const applyMessages = useStore((s) => s.applyMessages);
  const toggleRightRail = useStore((s) => s.toggleRightRail);
  const rightOpen = useStore((s) => s.ui.rightOpen);
  const lastReadMs = useStore((s) => s.ui.lastReadByKey[contact.key] ?? 0);
  const markRead = useStore((s) => s.markRead);
  const composerRef = useRef<ComposerHandle>(null);

  useEffect(() => {
    if (!client) return;
    let cancelled = false;
    void (async () => {
      try {
        const msgs = await api.getMessages(client, contact.key);
        if (!cancelled) applyMessages(contact.key, msgs);
      } catch {
        // non-fatal; WS push will catch us up
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [client, contact.key, applyMessages]);

  const onSend = useCallback(
    async (body: string) => {
      if (!client) return;
      try {
        await api.sendMessage(client, contact.key, body);
      } catch (err) {
        notify.error(`Send failed: ${(err as Error).message}`, err);
      }
    },
    [client, contact.key],
  );

  const handleReply = (name: string) => {
    composerRef.current?.insertMention(name);
  };

  const handleReact = (name: string, emoji: string) => {
    composerRef.current?.insertReaction(name, emoji);
  };

  const onSelectMessage = (id: string) => {
    setSelectedMessage(selectedId === id ? null : id);
    if (!rightOpen) toggleRightRail();
  };

  const Icon = CONTACT_ICON[contact.kind];

  return (
    <div className="flex h-full flex-col">
      <header className="flex shrink-0 items-center gap-2 border-b border-cs-border bg-cs-bg-2 px-4 py-2.5">
        <Icon size={14} aria-hidden="true" className="text-cs-text-muted" />
        <div className="flex flex-col">
          <h2 className="font-medium leading-tight text-cs-text">{contact.name}</h2>
          {contact.lastSeenMs != null && (
            <span className="font-mono text-[10px] text-cs-text-dim">last seen {fmtAgo(contact.lastSeenMs)}</span>
          )}
        </div>
        {contact.rssi != null && <RssiChip rssi={contact.rssi} hops={contact.hops} className="ml-auto" />}
      </header>

      <div className="flex-1 overflow-hidden">
        <MessageList
          conversationKey={contact.key}
          messages={messages}
          owner={owner}
          contacts={contacts}
          selectedId={selectedId}
          onSelect={onSelectMessage}
          style={appSettings.messageStyle}
          lastReadMs={lastReadMs}
          onMarkRead={(ts) => markRead(contact.key, ts)}
          onResend={(m) => onSend(m.body)}
          onReply={handleReply}
          onReact={handleReact}
          client={client}
          jumpToId={pendingJumpMid}
          onJumpConsumed={() => setPendingJump(null)}
        />
      </div>

      <Composer
        ref={composerRef}
        onSend={onSend}
        radioSettings={radioSettings}
        returnToSend={appSettings.composer.returnToSend}
        autoFocus={appSettings.composer.autoFocus}
        disabled={!client}
        draftKey={contact.key}
        client={client}
      />
    </div>
  );
}

function fmtAgo(ms: number): string {
  const diff = Date.now() - ms;
  const m = Math.floor(diff / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}
