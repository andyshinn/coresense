import { TELEMETRY_RETENTION_BOUNDS, TELEMETRY_RETENTION_DEFAULT } from '../../shared/telemetry/types';
import type { AppSettings } from '../../shared/types';

// Kept out of lib/api.ts on purpose: the store reads retention on every
// telemetry push, and many tests mock lib/api wholesale.

/** Clamp into TELEMETRY_RETENTION_BOUNDS; garbage falls back to `fallback`
 *  (the default unless the caller has a better value to keep). */
export function clampTelemetryRetention(value: unknown, fallback: number = TELEMETRY_RETENTION_DEFAULT): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : fallback;
  return Math.min(TELEMETRY_RETENTION_BOUNDS.max, Math.max(TELEMETRY_RETENTION_BOUNDS.min, n));
}

/** Saved requests kept per node: one global value, applied to every node. The
 *  `?.` covers settings from an older main that predates the field. */
export function telemetryRetentionOf(settings: AppSettings): number {
  return clampTelemetryRetention(settings.telemetry?.retentionPerNode);
}

/** `settings` with the retention replaced (clamped), for the whole-AppSettings
 *  PUT. A non-number `keep` (a cleared number input gives NaN) keeps the
 *  current value: the default would be a shrink, and main prunes on a shrink. */
export function withTelemetryRetention(settings: AppSettings, keep: number): AppSettings {
  const retentionPerNode = clampTelemetryRetention(keep, telemetryRetentionOf(settings));
  return { ...settings, telemetry: { ...settings.telemetry, retentionPerNode } };
}
