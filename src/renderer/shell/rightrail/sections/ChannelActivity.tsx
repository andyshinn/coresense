import type { Channel, ChannelStats } from '../../../../shared/types';
import { Sparkline } from '../../../components/Sparkline';
import { useChannelStats } from '../../../hooks/useChannelStats';
import { useUnreadByKey } from '../../../hooks/useUnreads';
import type { ApiClient } from '../../../lib/api';
import { useStore } from '../../../lib/store';
import { fmtDate } from '../../../lib/time';
import { Placeholder } from '../atoms';

const DAY = 86_400_000;

export function ChannelActivityBody({
  stats,
  loading,
  unread,
  muted,
  onMarkAllRead,
}: {
  stats: ChannelStats | null;
  loading: boolean;
  unread: number;
  muted: boolean;
  onMarkAllRead: () => void;
}) {
  if (!stats) return <Placeholder label={loading ? 'loading…' : 'no activity yet'} />;

  const spanDays =
    stats.firstTs != null && stats.lastTs != null ? Math.max(1, Math.round((stats.lastTs - stats.firstTs) / DAY)) : 0;
  const perDayAvg = spanDays ? (stats.count / spanDays).toFixed(1) : '0';

  return (
    <div className="flex flex-col gap-2 text-cs-text-muted">
      <div className="flex items-center justify-between text-[11px]">
        <span>{muted ? 'muted — not counted' : `${unread} unread`}</span>
        {!muted && unread > 0 && (
          <button type="button" onClick={onMarkAllRead} className="text-cs-accent hover:underline">
            Mark all read
          </button>
        )}
      </div>
      <div className="text-cs-text">{`${stats.count24h} in 24h · ${stats.count7d} in 7d`}</div>
      <Sparkline data={stats.perDay} className="text-cs-accent" />
      <div className="text-[10px] text-cs-text-dim">
        {stats.firstTs != null ? `First seen ${fmtDate(stats.firstTs)} · ${spanDays}d · ~${perDayAvg}/day` : 'no history'}
      </div>
    </div>
  );
}

export function ChannelActivitySection({ channel, client }: { channel: Channel; client: ApiClient | null }) {
  const { stats, loading } = useChannelStats(channel.key, client);
  const unread = useUnreadByKey()[channel.key] ?? 0;
  const markAllRead = useStore((s) => s.markAllRead);
  return (
    <ChannelActivityBody
      stats={stats}
      loading={loading}
      unread={unread}
      muted={!!channel.muted}
      onMarkAllRead={() => markAllRead(channel.key)}
    />
  );
}
