import { Activity, Megaphone, RefreshCw } from 'lucide-react';
import { Fragment, useCallback, useEffect } from 'react';
import type { Contact } from '../../../shared/types';
import { Composer } from '../../components/Composer';
import { MessageList } from '../../components/MessageList';
import { type ApiClient, api } from '../../lib/api';
import { notify } from '../../lib/notify';
import { useStore } from '../../lib/store';

const EMPTY_MESSAGES: never[] = [];

interface Props {
  contact: Contact;
  client: ApiClient | null;
}

// Direct conversation with the repeater plus quick-action buttons for the
// fire-and-forget Status / Telemetry / Advert requests. Snapshots arrive over
// WS push events and render as inline cards above the message list.
export function MessagesTab({ contact, client }: Props) {
  const owner = useStore((s) => s.owner);
  const contacts = useStore((s) => s.contacts);
  const messages = useStore((s) => s.messagesByKey[contact.key]) ?? EMPTY_MESSAGES;
  const selectedId = useStore((s) => s.selectedMessageId);
  const setSelectedMessage = useStore((s) => s.setSelectedMessage);
  const appSettings = useStore((s) => s.appSettings);
  const radioSettings = useStore((s) => s.radioSettings);
  const applyMessages = useStore((s) => s.applyMessages);
  const toggleRightRail = useStore((s) => s.toggleRightRail);
  const rightOpen = useStore((s) => s.ui.rightOpen);
  const lastReadMs = useStore((s) => s.ui.lastReadByKey[contact.key] ?? 0);
  const markRead = useStore((s) => s.markRead);
  const status = useStore((s) => s.repeaterStatusByKey[contact.key]);
  const telemetry = useStore((s) => s.repeaterTelemetryByKey[contact.key]);

  useEffect(() => {
    if (!client) return;
    let cancelled = false;
    void (async () => {
      try {
        const msgs = await api.getMessages(client, contact.key);
        if (!cancelled) applyMessages(contact.key, msgs);
      } catch {
        // non-fatal
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [client, contact.key, applyMessages]);

  const requestStatus = useCallback(async () => {
    if (!client) return;
    try {
      await api.repeaterStatus(client, contact.key);
      notify.success(`Status requested from ${contact.name}`);
    } catch (err) {
      notify.error(`Status request failed: ${(err as Error).message}`, err);
    }
  }, [client, contact.key, contact.name]);

  const requestTelemetry = useCallback(async () => {
    if (!client) return;
    try {
      await api.repeaterTelemetry(client, contact.key);
      notify.success(`Telemetry requested from ${contact.name}`);
    } catch (err) {
      notify.error(`Telemetry request failed: ${(err as Error).message}`, err);
    }
  }, [client, contact.key, contact.name]);

  const sendAdvert = useCallback(async () => {
    if (!client) return;
    try {
      await api.sendAdvert(client);
      notify.success('Self-advert sent');
    } catch (err) {
      notify.error(`Advert failed: ${(err as Error).message}`, err);
    }
  }, [client]);

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

  const onSelectMessage = (id: string) => {
    setSelectedMessage(selectedId === id ? null : id);
    if (!rightOpen) toggleRightRail();
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-1 border-b border-cs-border bg-cs-bg px-4 py-1.5">
        <ActionButton
          icon={RefreshCw}
          label="Request Status"
          disabled={!client}
          onClick={requestStatus}
        />
        <ActionButton
          icon={Activity}
          label="Request Telemetry"
          disabled={!client}
          onClick={requestTelemetry}
        />
        <ActionButton
          icon={Megaphone}
          label="Send Advert"
          disabled={!client}
          onClick={sendAdvert}
        />
      </div>

      {(status || telemetry) && (
        <div className="grid shrink-0 gap-2 border-b border-cs-border bg-cs-bg px-4 py-2 sm:grid-cols-2">
          {status && <StatusCard snap={status} />}
          {telemetry && <TelemetryCard snap={telemetry} />}
        </div>
      )}

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
        />
      </div>

      <Composer
        onSend={onSend}
        radioSettings={radioSettings}
        returnToSend={appSettings.composer.returnToSend}
        disabled={!client}
      />
    </div>
  );
}

interface ActionButtonProps {
  icon: typeof RefreshCw;
  label: string;
  disabled?: boolean;
  onClick: () => void;
}

function ActionButton({ icon: Icon, label, disabled, onClick }: ActionButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      className="flex items-center gap-1 rounded border border-cs-border bg-cs-bg-3 px-2 py-0.5 text-[11px] text-cs-text-muted transition-colors hover:bg-cs-accent-soft/30 hover:text-cs-text disabled:cursor-not-allowed disabled:opacity-50"
    >
      <Icon size={11} aria-hidden="true" />
      <span className="hidden md:inline">{label}</span>
    </button>
  );
}

function StatusCard({
  snap,
}: {
  snap: NonNullable<ReturnType<typeof useStore.getState>['repeaterStatusByKey'][string]>;
}) {
  return (
    <section className="rounded border border-cs-border bg-cs-bg-2 p-2">
      <header className="mb-1 flex items-baseline justify-between">
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-cs-text-muted">
          Status
        </h3>
        <span className="font-mono text-[10px] text-cs-text-dim">{fmtAgo(snap.receivedAt)}</span>
      </header>
      {snap.fields.length === 0 ? (
        <p className="font-mono text-[10px] text-cs-text-dim">raw {snap.payloadHex || '(empty)'}</p>
      ) : (
        <dl className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[11px]">
          {snap.fields.map((f) => (
            <Fragment key={f.name}>
              <dt className="text-cs-text-muted">{f.name}</dt>
              <dd className="text-right font-mono text-cs-text">
                {f.value}
                {f.unit ? ` ${f.unit}` : ''}
              </dd>
            </Fragment>
          ))}
        </dl>
      )}
    </section>
  );
}

function TelemetryCard({
  snap,
}: {
  snap: NonNullable<ReturnType<typeof useStore.getState>['repeaterTelemetryByKey'][string]>;
}) {
  return (
    <section className="rounded border border-cs-border bg-cs-bg-2 p-2">
      <header className="mb-1 flex items-baseline justify-between">
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-cs-text-muted">
          Telemetry
        </h3>
        <span className="font-mono text-[10px] text-cs-text-dim">{fmtAgo(snap.receivedAt)}</span>
      </header>
      {snap.fields.length === 0 ? (
        <p className="font-mono text-[10px] text-cs-text-dim">raw {snap.payloadHex || '(empty)'}</p>
      ) : (
        <ul className="space-y-0.5 text-[11px]">
          {snap.fields.map((f, i) => (
            <li
              // biome-ignore lint/suspicious/noArrayIndexKey: CayenneLPP can repeat (channel, type)
              key={`${f.channel}-${f.typeHex}-${i}`}
              className="flex items-baseline justify-between gap-2"
            >
              <span className="text-cs-text-muted">
                ch{f.channel} · {f.name}
              </span>
              <span className="font-mono text-cs-text">
                {f.value}
                {f.unit ? ` ${f.unit}` : ''}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function fmtAgo(ms: number): string {
  const diff = Date.now() - ms;
  const s = Math.floor(diff / 1000);
  if (s < 5) return 'just now';
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  return `${h}h ago`;
}
