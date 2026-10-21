import { MapPin, RotateCcw, Settings } from 'lucide-react';
import { type KeyboardEvent, useEffect, useRef, useState } from 'react';
import { errorMessage } from '../../../shared/errors';
import { Skeleton } from '../../components/ui/skeleton';
import { Switch } from '../../components/ui/switch';
import { LABEL_CAPS, META, TelemetryButton, TelemetryCard, TelemetryChip } from '../../features/telemetry/ui';
import { notify } from '../../lib/notify';
import { useStore } from '../../lib/store';
import { cn } from '../../lib/utils';
import type { SensorSettingsControl } from './useSensorSettings';

// "Sensor settings": what the radio reports through its custom vars. The
// firmware lists `gps` only when it detected a GPS, and `gps_interval` is
// write-only, so the interval shows the value last set from CoreSense
// (GpsConfig.intervalSec) and each field saves on its own: a radio that
// takes `gps` but refuses `gps_interval` (T1000) keeps the half that worked.

/** Anchor the GPS-off tile scrolls to. */
export const SENSOR_SETTINGS_ID = 'myradio-sensor-settings';
const GPS_SWITCH_ID = 'myradio-gps-switch';

/** Position's range for the interval (firmware clamps outside it). */
const INTERVAL_MIN = 60;
const INTERVAL_MAX = 86_399;

const ROW = 'flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-cs-border px-3.5 py-2.5 last:border-b-0';
const COPY = 'text-[12px] leading-[18px] text-cs-text-muted';

/** Scroll My radio to its sensor settings and focus the GPS switch. */
export function revealSensorSettings(): void {
  document.getElementById(SENSOR_SETTINGS_ID)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  document.getElementById(GPS_SWITCH_ID)?.focus({ preventScroll: true });
}

function IntervalRow({ write, disabled }: { write: SensorSettingsControl['write']; disabled: boolean }) {
  const saved = useStore((s) => s.gpsConfig.intervalSec);
  const [draft, setDraft] = useState(String(saved));
  const [saving, setSaving] = useState(false);
  const cancelled = useRef(false);
  // A push from main (this write, or Settings › Position) replaces the draft.
  useEffect(() => setDraft(String(saved)), [saved]);

  const commit = async () => {
    if (cancelled.current) {
      cancelled.current = false;
      setDraft(String(saved));
      return;
    }
    const n = Number(draft.trim());
    if (draft.trim() === '' || n === saved) {
      setDraft(String(saved));
      return;
    }
    if (!Number.isInteger(n) || n < INTERVAL_MIN || n > INTERVAL_MAX) {
      notify.error(`GPS interval save failed: use ${INTERVAL_MIN} to ${INTERVAL_MAX} seconds`);
      setDraft(String(saved));
      return;
    }
    setSaving(true);
    try {
      await write('gps_interval', String(n));
      notify.success('GPS interval saved');
    } catch (err) {
      // GPS on/off saved separately, so this is the only half lost.
      notify.error(`GPS interval save failed: ${errorMessage(err)}`, err);
      setDraft(String(useStore.getState().gpsConfig.intervalSec));
    } finally {
      setSaving(false);
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') e.currentTarget.blur();
    if (e.key === 'Escape') {
      cancelled.current = true;
      e.currentTarget.blur();
    }
  };

  return (
    <div className={ROW}>
      <div className="min-w-0 flex-1">
        <label htmlFor="myradio-gps-interval" className="text-[12px] text-cs-text">
          GPS update interval
        </label>
        <div className={META}>gps_interval · seconds · last set from CoreSense</div>
      </div>
      <input
        id="myradio-gps-interval"
        inputMode="numeric"
        value={draft}
        disabled={disabled || saving}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => void commit()}
        onKeyDown={onKeyDown}
        className="h-7 w-20 rounded border border-cs-border bg-cs-bg-3 px-2 text-right font-mono text-[12px] tabular-nums text-cs-text outline-none focus-visible:border-cs-accent disabled:cursor-not-allowed disabled:opacity-50"
      />
    </div>
  );
}

export function SensorSettingsCard({ control, connected }: { control: SensorSettingsControl; connected: boolean }) {
  const { settings, reload, write } = control;
  const vars = settings.status === 'ok' ? settings.vars : null;
  const count = vars ? Object.keys(vars).length : 0;
  const hasGps = vars !== null && 'gps' in vars;
  const gpsOn = hasGps && vars.gps !== '0';

  const setGps = async (on: boolean) => {
    try {
      await write('gps', on ? '1' : '0');
    } catch (err) {
      notify.error(`GPS save failed: ${errorMessage(err)}`, err);
    }
  };

  const meta =
    settings.status === 'ok'
      ? count === 0
        ? 'none reported by the radio'
        : `${count} ${count === 1 ? 'setting' : 'settings'} reported by the radio`
      : null;

  return (
    <TelemetryCard
      id={SENSOR_SETTINGS_ID}
      aria-label="Sensor settings"
      className="scroll-mt-4"
      header={
        <>
          <Settings aria-hidden="true" className="size-3.5 shrink-0 text-cs-accent" />
          <h3 className="text-[13px] font-semibold text-cs-text">Sensor settings</h3>
          {meta && <span className={cn(META, 'ml-auto')}>{meta}</span>}
        </>
      }
    >
      {settings.status === 'offline' ? (
        <p className={cn(COPY, 'px-3.5 py-3')}>Connect your radio to see its sensor settings.</p>
      ) : settings.status === 'loading' ? (
        <div role="status" aria-busy="true" aria-label="Reading sensor settings" className={ROW}>
          <div className="flex flex-1 flex-col gap-1.5">
            <Skeleton className="h-3 w-24 rounded" />
            <Skeleton className="h-2.5 w-32 rounded" />
          </div>
          <Skeleton className="h-5 w-8 rounded-full" />
        </div>
      ) : settings.status === 'error' ? (
        <div className="flex flex-col gap-2 px-3.5 py-3">
          <p className="text-[12px] leading-[18px] text-cs-text">Reading sensor settings failed: {settings.error}</p>
          <div>
            <TelemetryButton onClick={reload}>
              <RotateCcw aria-hidden="true" />
              Try again
            </TelemetryButton>
          </div>
        </div>
      ) : hasGps ? (
        <>
          <div className={ROW}>
            <div className="min-w-0 flex-1">
              <label htmlFor={GPS_SWITCH_ID} className="text-[12px] text-cs-text">
                GPS
              </label>
              <div className={META}>gps · 0 / 1</div>
            </div>
            <Switch id={GPS_SWITCH_ID} checked={gpsOn} disabled={!connected} onCheckedChange={(on) => void setGps(on)} />
          </div>
          <IntervalRow write={write} disabled={!connected} />
        </>
      ) : (
        <div className="flex flex-col gap-1 px-3.5 py-3">
          <p className={COPY}>No GPS detected on this radio.</p>
          <p className={META}>the firmware lists sensor settings only for a GPS it detected at boot</p>
        </div>
      )}
    </TelemetryCard>
  );
}

/**
 * Ch 1's stand-in for a GPS reading when the radio has a GPS that is
 * switched off: says why there's no position and links to the switch.
 */
export function GpsOffTile() {
  return (
    <div
      data-testid="gps-off-tile"
      className="flex min-w-0 flex-col justify-center gap-1.25 bg-cs-bg-2 px-3.5 py-3 shadow-[inset_-1px_-1px_0_0_rgb(var(--cs-border))]"
    >
      <div className="flex min-w-0 items-center gap-1.5 text-cs-text-dim">
        <MapPin aria-hidden="true" className="size-3.5 shrink-0" />
        <span className={LABEL_CAPS}>GPS</span>
        <TelemetryChip tone="off" className="ml-auto">
          off
        </TelemetryChip>
      </div>
      <p className={COPY}>GPS is off on this radio. Turn it on in sensor settings to report position on channel 1.</p>
      <div>
        <TelemetryButton onClick={revealSensorSettings}>Sensor settings</TelemetryButton>
      </div>
    </div>
  );
}
