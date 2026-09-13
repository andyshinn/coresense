import { DEFAULT_PACKET_LOG_SETTINGS, PACKET_LOG_BOUNDS, type UiState } from './types';

function clampBound(value: unknown, lo: number, hi: number, fallback: number): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  return Math.min(hi, Math.max(lo, Math.floor(n)));
}

/**
 * Clamp a persisted packetLog retention config into PACKET_LOG_BOUNDS before
 * it's used to size a disk write or a `recent()` read. Settings persist to a
 * hand-editable ui-state.json — the renderer's slider clamps on the way in,
 * but a corrupted or manually-edited file (e.g. a huge storedHistorySize)
 * would otherwise drive unbounded disk growth or a full-table read into main
 * memory. Non-numeric/garbage values fall back to the shipped defaults rather
 * than clamping garbage into a bound.
 *
 * Lives in shared/ so main can normalise UiState where it ENTERS — loadUiState
 * (disk) and PUT /api/ui-state (clients) — without the settings store pulling in
 * the SQLite packet store. Normalising only at the use sites left main holding,
 * serving and re-broadcasting the raw value, which the renderer then read.
 */
export function clampRetention(packetLog: Partial<UiState['packetLog']> | null | undefined): UiState['packetLog'] {
  // mergeDefaults keeps a stored `"packetLog": null` as null. Tolerate it here
  // rather than throwing: this runs in the snapshot route on every launch.
  return {
    liveBufferSize: clampBound(
      packetLog?.liveBufferSize,
      PACKET_LOG_BOUNDS.liveBufferSize.min,
      PACKET_LOG_BOUNDS.liveBufferSize.max,
      DEFAULT_PACKET_LOG_SETTINGS.liveBufferSize,
    ),
    storedHistorySize: clampBound(
      packetLog?.storedHistorySize,
      PACKET_LOG_BOUNDS.storedHistorySize.min,
      PACKET_LOG_BOUNDS.storedHistorySize.max,
      DEFAULT_PACKET_LOG_SETTINGS.storedHistorySize,
    ),
  };
}
