import { DataList } from '@radix-ui/themes';
import type { Channel } from '../../../../shared/types';
import { KeyValueRow } from '../../../components/ui/KeyValueRow';
import { Placeholder } from '../atoms';

/** Static facts about the active channel: name, kind, secret preview, mute. */
export function ChannelInfoSection({ channel }: { channel: Channel | null }) {
  if (!channel) return <Placeholder label="unknown channel" />;
  return (
    <DataList.Root orientation="horizontal" size="1">
      <KeyValueRow label="Name" value={channel.name} />
      <KeyValueRow label="Kind" value={channel.kind} mono />
      {channel.secretHex && <KeyValueRow label="Secret" value={`${channel.secretHex.slice(0, 16)}…`} mono />}
      <KeyValueRow label="Muted" value={channel.muted ? 'yes' : 'no'} />
    </DataList.Root>
  );
}
