import { describeChannels } from '../../../shared/telemetry/describe';
import type { SavedRequestDto } from '../../../shared/telemetry/types';
import type { TimeFormatPref } from '../../../shared/types';
import { fmtTime } from '../../lib/time';
import { dayLabel } from '../telemetry/format';

/** How many values a snapshot row shows after its time. */
const SNAPSHOT_VALUES = 3;

/**
 * One row of My Node's snapshot list: "Today 09:12 · 3.81 V · 54% · 24.1 °C".
 * Battery first (with its charge estimate), then the other readings in
 * channel order; positions are left out, they don't fit a one-line summary.
 */
export function snapshotLine(req: SavedRequestDto, timeFormat: TimeFormatPref, now: number = Date.now()): string {
  const when = `${dayLabel(req.requestedAt, now)} ${fmtTime(req.requestedAt, timeFormat)}`;
  if (req.outcome !== 'ok') return `${when} · ${req.outcome === 'timeout' ? 'no reply' : 'failed'}`;
  const values: string[] = [];
  for (const group of describeChannels(req.readings, 'companion')) {
    for (const r of group.readings) {
      if (r.kind === 'gps') continue;
      values.push(r.text);
      if (r.kind === 'battery' && r.batteryPercent !== null) values.push(`${r.batteryPercent}%`);
    }
  }
  return [when, ...values.slice(0, SNAPSHOT_VALUES)].join(' · ');
}
