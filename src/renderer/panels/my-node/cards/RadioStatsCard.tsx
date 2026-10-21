import { Signal } from 'lucide-react';
import type { ReactNode } from 'react';
import { fmtAge, fmtDuration, unicodeMinus } from '../../../../shared/telemetry/format';
import type { DeviceStats } from '../../../../shared/types';
import { SignalBars } from '../../../components/path/SignalBars';
import type { StreamState } from '../../../features/my-node/poll';
import { fmtWhen } from '../../../features/telemetry/format';
import { useNowTick } from '../../../hooks/useNowTick';
import { fmtSnr, snrBand } from '../../../lib/signal';
import { useStore } from '../../../lib/store';
import { NodeCard, UpdatedAgo } from '../NodeCard';

const BAND_WORD = { strong: 'Strong', mid: 'Mid', weak: 'Weak' } as const;

const count = (n: number) => n.toLocaleString('en-US');

/** Airtime as a share of uptime: "0.3% of uptime". */
function shareOfUptime(airSecs: number, uptimeSecs: number): string | null {
  if (uptimeSecs <= 0) return null;
  const pct = (airSecs / uptimeSecs) * 100;
  return `${pct < 10 ? pct.toFixed(1) : Math.round(pct)}% of uptime`;
}

function Stat({ label, value, sub, extra }: { label: string; value: string; sub?: string | null; extra?: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className="label-caps text-cs-text-muted">{label}</span>
      <span className="flex items-center gap-2 font-mono text-[16px] leading-6 tabular-nums text-cs-text">
        {value}
        {extra}
      </span>
      {sub && <span className="truncate text-[11px] text-cs-text-muted">{sub}</span>}
    </div>
  );
}

/** The radio's own counters (CMD_GET_STATS), refreshed with the telemetry
 *  poll. The page hides this card on firmware without the command. */
export function RadioStatsCard({ stream, className }: { stream: StreamState<DeviceStats>; className?: string }) {
  const now = useNowTick(1_000);
  const timeFormat = useStore((s) => s.appSettings.timeFormat);
  const stats = stream.value;

  return (
    <NodeCard
      icon={Signal}
      title="Radio stats"
      className={className}
      extras={
        <UpdatedAgo
          text={stream.updatedAt !== null ? `Updated ${fmtAge(stream.updatedAt, now)}` : null}
          warn={stream.warn}
        />
      }
    >
      {!stats ? (
        <p className="text-[12px] text-cs-text-muted">{stream.error ? `Read failed: ${stream.error}` : 'Reading…'}</p>
      ) : (
        <div className="grid grid-cols-2 gap-x-4 gap-y-3">
          <Stat
            label="Uptime"
            value={fmtDuration(stats.core.uptimeSecs * 1000)}
            sub={`Since ${fmtWhen(stats.at - stats.core.uptimeSecs * 1000, timeFormat, now)}`}
          />
          <Stat label="Noise floor" value={unicodeMinus(`${stats.radio.noiseFloor} dBm`)} />
          <Stat label="Last RSSI" value={unicodeMinus(`${stats.radio.lastRssi} dBm`)} />
          <Stat
            label="Last SNR"
            value={unicodeMinus(fmtSnr(stats.radio.lastSnrDb))}
            extra={<SignalBars snr={stats.radio.lastSnrDb} />}
            sub={BAND_WORD[snrBand(stats.radio.lastSnrDb)]}
          />
          <Stat
            label="TX airtime"
            value={fmtDuration(stats.radio.txAirSecs * 1000)}
            sub={shareOfUptime(stats.radio.txAirSecs, stats.core.uptimeSecs)}
          />
          <Stat
            label="RX airtime"
            value={fmtDuration(stats.radio.rxAirSecs * 1000)}
            sub={shareOfUptime(stats.radio.rxAirSecs, stats.core.uptimeSecs)}
          />
          <Stat
            label="Packets received"
            value={count(stats.packets.recv)}
            sub={`Flood ${count(stats.packets.nRecvFlood)} · direct ${count(stats.packets.nRecvDirect)}`}
          />
          <Stat
            label="Packets sent"
            value={count(stats.packets.sent)}
            sub={`Flood ${count(stats.packets.nSentFlood)} · direct ${count(stats.packets.nSentDirect)}`}
          />
        </div>
      )}
    </NodeCard>
  );
}
