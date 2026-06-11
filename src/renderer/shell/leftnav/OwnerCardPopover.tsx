import { MapPin } from 'lucide-react';
import type { ReactNode } from 'react';
import { lipoPercent } from '../../lib/battery';
import { useStore } from '../../lib/store';
import { cn } from '../../lib/utils';
import { fmtBandwidth, fmtFreqMhz, fmtGpsInterval, fmtStorageKb } from './ownerFormat';

function Ring({
  pct,
  label,
  sub,
  tone = 'accent',
}: {
  pct: number;
  label: string;
  sub: string;
  tone?: 'accent' | 'dim' | 'online';
}) {
  const r = 17;
  const c = 2 * Math.PI * r;
  const off = c * (1 - Math.min(100, Math.max(0, pct)) / 100);
  const stroke =
    tone === 'online'
      ? 'rgb(var(--cs-online))'
      : tone === 'dim'
        ? 'rgb(var(--cs-accent-soft))'
        : 'rgb(var(--cs-accent))';
  return (
    <div className="flex flex-col items-center gap-1.5">
      <div className="relative size-11">
        <svg width="44" height="44" viewBox="0 0 44 44" aria-hidden="true">
          <circle cx="22" cy="22" r={r} fill="none" stroke="rgb(var(--cs-bg-3))" strokeWidth="4" />
          <circle
            cx="22"
            cy="22"
            r={r}
            fill="none"
            stroke={stroke}
            strokeWidth="4"
            strokeLinecap="round"
            strokeDasharray={c}
            strokeDashoffset={off}
            transform="rotate(-90 22 22)"
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center font-mono text-[11px] text-cs-text">
          {label}
        </div>
      </div>
      <span className="font-mono text-[8.5px] uppercase tracking-wide text-cs-text-dim">{sub}</span>
    </div>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <div className="mb-1.5 font-mono text-[9px] uppercase tracking-wide text-cs-text-dim">
        {title}
      </div>
      {children}
    </div>
  );
}

function KV({ k, v, accent }: { k: string; v: string; accent?: boolean }) {
  return (
    <div className="flex items-center justify-between py-0.5">
      <span className="text-[11px] text-cs-text-muted">{k}</span>
      <span className={cn('font-mono text-[11px]', accent ? 'text-cs-accent' : 'text-cs-text')}>
        {v}
      </span>
    </div>
  );
}

function CapBar({ k, used, max, value }: { k: string; used: number; max: number; value: string }) {
  const pct = max > 0 ? Math.min(100, (used / max) * 100) : 0;
  return (
    <div className="flex items-center gap-2 py-0.5">
      <span className="w-14 text-[11px] text-cs-text-muted">{k}</span>
      <div className="h-1 flex-1 overflow-hidden rounded-full bg-cs-bg-3">
        <div className="h-full rounded-full bg-cs-accent" style={{ width: `${pct}%` }} />
      </div>
      <span className="w-20 text-right font-mono text-[10px] text-cs-text">{value}</span>
    </div>
  );
}

function MiniStat({ on, label }: { on: boolean; label: string }) {
  return (
    <span
      className={cn(
        'flex-1 rounded border px-1.5 py-1 text-center font-mono text-[9.5px]',
        on
          ? 'border-cs-accent/25 bg-cs-accent-soft/15 text-cs-text'
          : 'border-cs-border bg-cs-bg-3 text-cs-text-dim',
      )}
    >
      {label}
    </span>
  );
}

/** Instrument-style hover popover: gauges, radio grid, capacity bars, position.
 *  Reads everything from the store, so it takes no props. */
export function OwnerCardPopover() {
  const deviceInfo = useStore((s) => s.deviceInfo);
  const radio = useStore((s) => s.radioSettings);
  const identity = useStore((s) => s.deviceIdentity);
  const gps = useStore((s) => s.gpsConfig);
  const contactCount = useStore((s) => s.contacts.length);
  const channelCount = useStore((s) => s.channels.length);

  const battPct = lipoPercent(deviceInfo.batteryMv) ?? 0;
  const maxContacts = deviceInfo.maxContacts || 0;
  const maxChannels = deviceInfo.maxChannels || 0;
  const storageTotal = deviceInfo.storageTotalKb || 0;
  const storagePct = storageTotal > 0 ? (deviceInfo.storageUsedKb / storageTotal) * 100 : 0;
  const hasLocation = identity.lat !== null && identity.lon !== null;

  return (
    <div className="flex flex-col gap-3">
      {/* Gauges */}
      <div className="flex justify-around">
        <Ring pct={battPct} label={`${battPct}`} sub="Battery %" />
        <Ring
          pct={storagePct}
          label={fmtStorageKb(deviceInfo.storageUsedKb).replace(/ (KB|MB)$/, '')}
          sub="Storage"
          tone="dim"
        />
        <Ring
          pct={maxContacts > 0 ? (contactCount / maxContacts) * 100 : 0}
          label={`${contactCount}`}
          sub="Contacts"
          tone="online"
        />
      </div>

      <Group title="Radio">
        <div className="grid grid-cols-2 gap-x-4 gap-y-0.5">
          <KV k="Freq" v={`${fmtFreqMhz(radio.frequencyHz)} MHz`} accent />
          <KV k="BW" v={fmtBandwidth(radio.bandwidthHz)} />
          <KV k="SF" v={`${radio.spreadingFactor}`} />
          <KV k="CR" v={`4/${radio.codingRate}`} />
          <KV k="TX" v={`${radio.txPowerDbm} dBm`} />
          <KV k="Repeat" v={radio.repeatMode ? 'On' : 'Off'} />
        </div>
      </Group>

      <Group title="Capacity">
        <CapBar
          k="Contacts"
          used={contactCount}
          max={maxContacts}
          value={`${contactCount} / ${maxContacts || '—'}`}
        />
        <CapBar
          k="Channels"
          used={channelCount}
          max={maxChannels}
          value={`${channelCount} / ${maxChannels || '—'}`}
        />
        <CapBar
          k="Storage"
          used={deviceInfo.storageUsedKb}
          max={storageTotal}
          value={
            storageTotal > 0
              ? `${fmtStorageKb(deviceInfo.storageUsedKb)} / ${fmtStorageKb(storageTotal)}`
              : '—'
          }
        />
      </Group>

      <Group title="Position">
        <div className="flex items-center gap-2">
          <MapPin
            className={cn(
              'size-3.5',
              identity.sharePositionInAdvert ? 'text-cs-accent' : 'text-cs-text-dim',
            )}
            aria-hidden
          />
          <span className="font-mono text-[11px] text-cs-text">
            {hasLocation ? `${identity.lat?.toFixed(5)}, ${identity.lon?.toFixed(5)}` : 'Not set'}
          </span>
        </div>
        <div className="mt-1.5 flex gap-1.5">
          <MiniStat
            on={gps.enabled}
            label={gps.enabled ? `GPS ${fmtGpsInterval(gps.intervalSec)}` : 'GPS off'}
          />
          <MiniStat
            on={identity.sharePositionInAdvert}
            label={identity.sharePositionInAdvert ? 'shared in advert' : 'not shared'}
          />
        </div>
      </Group>
    </div>
  );
}
