import type { Channel } from '../../../../shared/types';
import { RelativeTime } from '../../../components/RelativeTime';
import { SecretField } from '../../../components/SecretField';
import { KeyValueRow } from '../../../components/ui/KeyValueRow';
import { type ApiClient, api } from '../../../lib/api';
import { notify } from '../../../lib/notify';
import { useStore } from '../../../lib/store';
import { fmtDate } from '../../../lib/time';
import { Placeholder } from '../atoms';

/** Pure presentational Overview body. */
export function ChannelInfoBody({
  channel,
  lastActiveTs,
  muted,
  onToggleMuted,
}: {
  channel: Channel;
  lastActiveTs: number | null;
  muted: boolean;
  onToggleMuted: () => void;
}) {
  return (
    <div className="space-y-1.5 text-cs-text-muted">
      <KeyValueRow label="Name" value={channel.name} />
      <KeyValueRow label="Kind" value={channel.kind} mono />
      {channel.secretHex && <KeyValueRow label="Secret" value={<SecretField secretHex={channel.secretHex} />} />}
      <KeyValueRow
        label="Muted"
        value={
          <button type="button" onClick={onToggleMuted} className="text-cs-text hover:text-cs-accent">
            {muted ? 'yes' : 'no'}
          </button>
        }
      />
      <KeyValueRow label="Slot" value={typeof channel.idx === 'number' ? channel.idx : 'not synced'} mono />
      <KeyValueRow
        label="Added"
        value={channel.createdAt ? <RelativeTime ts={channel.createdAt} /> : 'unknown'}
        title={channel.createdAt ? fmtDate(channel.createdAt) : undefined}
      />
      <KeyValueRow label="Last active" value={lastActiveTs ? <RelativeTime ts={lastActiveTs} /> : '—'} />
    </div>
  );
}

/** Container: resolves last-active from the store and wires the mute toggle. */
export function ChannelInfoSection({ channel, client }: { channel: Channel | null; client: ApiClient | null }) {
  const messages = useStore((s) => (channel ? s.messagesByKey[channel.key] : undefined));
  if (!channel) return <Placeholder label="unknown channel" />;
  const lastActiveTs = messages && messages.length > 0 ? messages[messages.length - 1].ts : null;
  const onToggleMuted = () => {
    if (!client) return;
    api
      .putChannel(client, { ...channel, muted: !channel.muted })
      .catch((err) => notify.error(`Couldn't update channel: ${(err as Error).message}`, err));
  };
  return (
    <ChannelInfoBody channel={channel} lastActiveTs={lastActiveTs} muted={!!channel.muted} onToggleMuted={onToggleMuted} />
  );
}
