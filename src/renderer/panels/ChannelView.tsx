import type { LucideIcon } from 'lucide-react';
import { Globe, Hash, Lock, Plus } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Channel } from '../../shared/types';
import { Composer, type ComposerHandle } from '../components/Composer';
import { MessageList } from '../components/MessageList';
import { type ApiClient, api } from '../lib/api';
import { notify } from '../lib/notify';
import { useStore } from '../lib/store';

const CHANNEL_ICON: Record<Channel['kind'], LucideIcon> = {
  public: Globe,
  hashtag: Hash,
  private: Lock,
};

// Stable empty-array reference so the selector returns the same `[]` for keys
// without messages — otherwise `?? []` would allocate every render and Zustand
// would treat each call as a state change → infinite loop.
const EMPTY_MESSAGES: never[] = [];

interface Props {
  channel: Channel;
  client: ApiClient | null;
}

export function ChannelView({ channel, client }: Props) {
  const owner = useStore((s) => s.owner);
  const contacts = useStore((s) => s.contacts);
  const messages = useStore((s) => s.messagesByKey[channel.key]) ?? EMPTY_MESSAGES;
  const selectedId = useStore((s) => s.selectedMessageId);
  const setSelectedMessage = useStore((s) => s.setSelectedMessage);
  const pendingJumpMid = useStore((s) => s.pendingJumpMid);
  const setPendingJump = useStore((s) => s.setPendingJump);
  const appSettings = useStore((s) => s.appSettings);
  const radioSettings = useStore((s) => s.radioSettings);
  const applyMessages = useStore((s) => s.applyMessages);
  const toggleRightRail = useStore((s) => s.toggleRightRail);
  const rightOpen = useStore((s) => s.ui.rightOpen);
  const lastReadMs = useStore((s) => s.ui.lastReadByKey[channel.key] ?? 0);
  const markRead = useStore((s) => s.markRead);
  const channelPresence = useStore((s) => s.channelPresence);
  const transportState = useStore((s) => s.transportState);
  const onDevice = channelPresence.has(channel.key);
  const connected = transportState === 'connected';
  const [pushing, setPushing] = useState(false);
  const composerRef = useRef<ComposerHandle>(null);

  // Fetch history on activate.
  useEffect(() => {
    if (!client) return;
    let cancelled = false;
    void (async () => {
      try {
        const msgs = await api.getMessages(client, channel.key);
        if (!cancelled) applyMessages(channel.key, msgs);
      } catch {
        // non-fatal; the WS push will catch us up
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [client, channel.key, applyMessages]);

  const onSend = useCallback(
    async (body: string) => {
      if (!client) return;
      try {
        await api.sendMessage(client, channel.key, body);
      } catch (err) {
        notify.error(`Send failed: ${(err as Error).message}`, err);
      }
    },
    [client, channel.key],
  );

  const onSelectMessage = (id: string) => {
    setSelectedMessage(selectedId === id ? null : id);
    if (!rightOpen) toggleRightRail();
  };

  const onAddToDevice = useCallback(async () => {
    if (!client || pushing) return;
    setPushing(true);
    try {
      const res = await api.pushChannelToDevice(client, channel.key);
      notify.success(`Added "${channel.name}" to device (slot ${res.idx})`);
    } catch (err) {
      notify.error(`Add failed: ${(err as Error).message}`, err);
    } finally {
      setPushing(false);
    }
  }, [client, channel.key, channel.name, pushing]);

  const Icon = CHANNEL_ICON[channel.kind];
  const composerDisabled = !client || !onDevice;

  return (
    <div className="flex h-full flex-col">
      <header className="flex shrink-0 items-center gap-2 border-b border-cs-border bg-cs-bg-2 px-4 py-2.5">
        <Icon size={14} aria-hidden="true" className="text-cs-text-muted" />
        <h2 className="font-medium text-cs-text">{channel.name}</h2>
        <span className="font-mono text-[10px] uppercase tracking-wider text-cs-text-dim">
          {channel.kind}
        </span>
        {!onDevice && (
          <>
            <span className="rounded bg-cs-bg-3 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-cs-text-dim">
              Not on device
            </span>
            <button
              type="button"
              onClick={onAddToDevice}
              disabled={!connected || pushing || !client}
              title={
                !connected
                  ? 'Connect a radio to add this channel'
                  : `Add "${channel.name}" to the connected device`
              }
              className="ml-auto flex items-center gap-1 rounded border border-cs-border bg-cs-bg-3 px-2 py-0.5 text-[11px] text-cs-text-muted transition-colors hover:bg-cs-accent-soft/30 hover:text-cs-text disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Plus size={11} aria-hidden="true" />
              {pushing ? 'Adding…' : 'Add to device'}
            </button>
          </>
        )}
      </header>

      <div className="flex-1 overflow-hidden">
        <MessageList
          conversationKey={channel.key}
          messages={messages}
          owner={owner}
          contacts={contacts}
          selectedId={selectedId}
          onSelect={onSelectMessage}
          style={appSettings.messageStyle}
          lastReadMs={lastReadMs}
          onMarkRead={(ts) => markRead(channel.key, ts)}
          onResend={(m) => onSend(m.body)}
          onReply={(name) => composerRef.current?.insertMention(name)}
          jumpToId={pendingJumpMid}
          onJumpConsumed={() => setPendingJump(null)}
        />
      </div>

      {!onDevice && (
        <div className="border-t border-cs-border bg-cs-bg-2 px-4 py-2 text-[11px] italic text-cs-text-dim">
          This channel isn't on the connected device. Add it to send messages — history is preserved
          either way.
        </div>
      )}

      <Composer
        ref={composerRef}
        onSend={onSend}
        radioSettings={radioSettings}
        returnToSend={appSettings.composer.returnToSend}
        disabled={composerDisabled}
        draftKey={channel.key}
      />
    </div>
  );
}
