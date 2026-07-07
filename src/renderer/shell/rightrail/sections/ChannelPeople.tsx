import type { Channel, ChannelStats } from '../../../../shared/types';
import { ColoredUsername } from '../../../components/ColoredUsername';
import { RelativeTime } from '../../../components/RelativeTime';
import { useChannelStats } from '../../../hooks/useChannelStats';
import type { ApiClient } from '../../../lib/api';
import { Placeholder } from '../atoms';

export function ChannelPeopleBody({ stats, loading }: { stats: ChannelStats | null; loading: boolean }) {
  if (!stats) return <Placeholder label={loading ? 'loading…' : 'nobody seen yet'} />;
  const noun = stats.distinctSenders === 1 ? 'person' : 'people';
  return (
    <div className="flex flex-col gap-2 text-cs-text-muted">
      <div className="text-[11px] text-cs-text-dim">{`${stats.distinctSenders} ${noun} seen`}</div>
      <div className="max-h-40 overflow-y-auto">
        {stats.roster.map((r) => (
          <div key={r.fromPk ?? 'self'} className="flex items-center justify-between gap-2 py-1">
            <ColoredUsername sender={r.fromPk ?? undefined} size="sm" />
            <span className="flex shrink-0 items-center gap-2 text-[10px] text-cs-text-dim">
              <span className="tabular-nums">{r.count}</span>
              <RelativeTime ts={r.lastTs} />
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function ChannelPeopleSection({ channel, client }: { channel: Channel; client: ApiClient | null }) {
  const { stats, loading } = useChannelStats(channel.key, client);
  return <ChannelPeopleBody stats={stats} loading={loading} />;
}
