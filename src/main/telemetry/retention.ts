import { TELEMETRY_RETENTION_BOUNDS, TELEMETRY_RETENTION_DEFAULT } from '../../shared/telemetry/types';
import type { AppSettings } from '../../shared/types';

/** Clamp a telemetry retention value into TELEMETRY_RETENTION_BOUNDS. Garbage
 *  (missing, null, NaN, a string from a hand-edited app-settings.json) falls
 *  back to `fallback` rather than being clamped into a bound — the default,
 *  the same rule shared/packetLog.ts applies to the Packet Log's retention,
 *  unless the caller has a better value to keep. */
export function clampTelemetryRetention(value: unknown, fallback: number = TELEMETRY_RETENTION_DEFAULT): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : fallback;
  return Math.min(TELEMETRY_RETENTION_BOUNDS.max, Math.max(TELEMETRY_RETENTION_BOUNDS.min, n));
}

/** AppSettings with `telemetry` normalised. Applied where the value ENTERS
 *  main — loadAppSettings (disk) and PUT /api/settings/app (clients) — so the
 *  holder never stores, serves or re-broadcasts an out-of-range value. With
 *  `current` (the PUT), a body that omits `telemetry` (a renderer older than
 *  this field) or sends garbage for it keeps the current value: falling back
 *  to the default there would be a shrink, and a shrink prunes saved rows. */
export function normalizeTelemetrySettings(next: AppSettings, current?: AppSettings): AppSettings {
  const sent = (next as Partial<AppSettings>).telemetry?.retentionPerNode;
  const fallback = current ? telemetryRetention(current) : TELEMETRY_RETENTION_DEFAULT;
  return { ...next, telemetry: { retentionPerNode: clampTelemetryRetention(sent, fallback) } };
}

/** The per-node retention in force for a settings object. */
export function telemetryRetention(settings: AppSettings): number {
  return clampTelemetryRetention(settings.telemetry?.retentionPerNode);
}
