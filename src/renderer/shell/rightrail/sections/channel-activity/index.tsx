import { useEffect, useState } from 'react';
import type { ActivityWindowKey, Channel, ChannelActivity } from '../../../../../shared/types';
import { useChannelActivity } from '../../../../hooks/useChannelActivity';
import type { ApiClient } from '../../../../lib/api';
import { useStore } from '../../../../lib/store';
import { Placeholder } from '../../atoms';
import { type ActivityMode, COLLAPSE_WIDTH, trendPct } from './activity';
import { RhythmFooter } from './RhythmFooter';
import { TrendChip } from './TrendChip';
import { VolumeChart } from './VolumeChart';
import { WindowTabs } from './WindowTabs';

/** The "3m ago" label would otherwise only refresh on the hook's 5-minute poll,
 *  which is long enough to be visibly wrong. Same cadence as RelativeTime. */
function useMinuteTick(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);
  return now;
}

export function ActivityBody({
  activity,
  loading,
  error,
  mode,
  win,
  onWindow,
  now,
}: {
  activity: ChannelActivity | null;
  loading: boolean;
  error: string | null;
  mode: ActivityMode;
  win: ActivityWindowKey;
  onWindow: (w: ActivityWindowKey) => void;
  /** Tests pin this; production lets the minute tick drive it. */
  now?: number;
}) {
  // Must run unconditionally, before any early return below — React forbids
  // conditional hook calls and the loading→loaded transition would crash otherwise.
  const tick = useMinuteTick();
  const at = now ?? tick;

  if (!activity) {
    // Deliberately --cs-trend-down, not --cs-danger: at 12px on bg-2, --cs-danger
    // measures 3.83:1 in dark mode, under the 4.5:1 AA floor. --cs-trend-down was
    // already tuned to clear AA in both themes, so it stands in here too — do not
    // "correct" this back to --cs-danger.
    if (error) return <p className="italic text-cs-trend-down">{error}</p>;
    return <Placeholder label={loading ? 'loading…' : 'no activity yet'} />;
  }
  if (activity.lastTs == null) return <Placeholder label="no activity yet" />;

  const full = mode === 'full';
  // Narrow rails have no room for tabs, so the window is pinned to 24h for
  // display only — the stored preference is untouched and returns on widening.
  const active: ActivityWindowKey = full ? win : '24h';
  const data = activity.windows[active];
  const pct = trendPct(data.total, data.prevTotal);

  return (
    <div>
      {full && <WindowTabs value={win} onChange={onWindow} />}
      <div className="flex items-baseline gap-2">
        <span
          className={`font-mono font-semibold tabular-nums tracking-[-0.01em] text-cs-text ${full ? 'text-[30px]' : 'text-[21px]'}`}
        >
          {data.total}
        </span>
        <span className={full ? 'text-[12.5px] text-cs-text-muted' : 'text-[11.5px] text-cs-text-muted'}>
          {full ? `in ${active}` : 'msgs · 24h'}
        </span>
        {pct !== null && <TrendChip pct={pct} showVsPrev={full} />}
      </div>
      <VolumeChart winKey={active} data={data} mode={mode} />
      <RhythmFooter peak={activity.peakBand} quiet={activity.quietBand} lastTs={activity.lastTs} mode={mode} now={at} />
    </div>
  );
}

export function ChannelActivitySection({ channel, client }: { channel: Channel; client: ApiClient | null }) {
  const { activity, loading, error } = useChannelActivity(channel.key, client);
  // The rail's own px width is already in the store, so no ResizeObserver is needed.
  const railWidth = useStore((s) => s.ui.rightWidth);
  const win = useStore((s) => s.ui.channelActivityWindow);
  const setWin = useStore((s) => s.setChannelActivityWindow);
  return (
    <ActivityBody
      activity={activity}
      loading={loading}
      error={error}
      mode={railWidth < COLLAPSE_WIDTH ? 'collapsed' : 'full'}
      win={win}
      onWindow={setWin}
    />
  );
}
