import { DEFAULT_PACKET_LOG_SETTINGS, PACKET_LOG_BOUNDS, type RawPacket, type UiState } from '../../shared/types';
import { openDb } from './db';

// Re-derive byte arrays from hex on read so we don't store them twice.
function hexToBytes(hex: string): number[] {
  const out: number[] = [];
  for (let i = 0; i + 1 < hex.length; i += 2) out.push(parseInt(hex.slice(i, i + 2), 16));
  return out;
}

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
 */
export function clampRetention(packetLog: UiState['packetLog']): UiState['packetLog'] {
  return {
    liveBufferSize: clampBound(
      packetLog.liveBufferSize,
      PACKET_LOG_BOUNDS.liveBufferSize.min,
      PACKET_LOG_BOUNDS.liveBufferSize.max,
      DEFAULT_PACKET_LOG_SETTINGS.liveBufferSize,
    ),
    storedHistorySize: clampBound(
      packetLog.storedHistorySize,
      PACKET_LOG_BOUNDS.storedHistorySize.min,
      PACKET_LOG_BOUNDS.storedHistorySize.max,
      DEFAULT_PACKET_LOG_SETTINGS.storedHistorySize,
    ),
  };
}

// Prune eagerly after each insert. Until the table exceeds keep, the SELECT MAX(id) + DELETE is a cheap no-op on the id primary key.
function prune(keep: number): void {
  openDb().prepare(`DELETE FROM packets WHERE id <= (SELECT MAX(id) FROM packets) - ?`).run(keep);
}

export const packetStore = {
  /** Persist a packet, then prune to the newest `keep`. `keep <= 0` disables persistence. */
  record(p: RawPacket, keep: number): void {
    if (keep <= 0) return;
    const db = openDb();
    db.prepare(
      `INSERT INTO packets (ts, transport, kind, hex, payload_hex, snr, rssi, code, code_name)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      p.timestamp,
      p.transportType,
      p.kind,
      p.hex,
      p.payloadHex,
      p.snr ?? null,
      p.rssi ?? null,
      p.code ?? null,
      p.codeName ?? null,
    );
    prune(keep);
  },

  /** Newest `limit` rows, returned oldest→newest so the live list appends in order. */
  recent(limit: number): RawPacket[] {
    if (limit <= 0) return [];
    const rows = openDb()
      .prepare(
        `SELECT ts, transport, kind, hex, payload_hex, snr, rssi, code, code_name
         FROM packets ORDER BY id DESC LIMIT ?`,
      )
      .all(limit) as Array<{
      ts: number;
      transport: string;
      kind: string;
      hex: string;
      payload_hex: string;
      snr: number | null;
      rssi: number | null;
      code: number | null;
      code_name: string | null;
    }>;
    return rows.reverse().map((r) => ({
      timestamp: r.ts,
      transportType: r.transport as RawPacket['transportType'],
      kind: r.kind as RawPacket['kind'],
      hex: r.hex,
      bytes: hexToBytes(r.hex),
      payloadHex: r.payload_hex,
      payloadBytes: hexToBytes(r.payload_hex),
      ...(r.snr != null ? { snr: r.snr } : {}),
      ...(r.rssi != null ? { rssi: r.rssi } : {}),
      ...(r.code != null ? { code: r.code } : {}),
      ...(r.code_name != null ? { codeName: r.code_name } : {}),
    }));
  },

  clear(): void {
    openDb().prepare('DELETE FROM packets').run();
  },
};
