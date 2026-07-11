import type { RawPacket } from '../../shared/types';
import { openDb } from './db';

// Re-derive byte arrays from hex on read so we don't store them twice.
function hexToBytes(hex: string): number[] {
  const out: number[] = [];
  for (let i = 0; i + 1 < hex.length; i += 2) out.push(parseInt(hex.slice(i, i + 2), 16));
  return out;
}

// Prune eagerly after each insert. Until the table exceeds keep, the SELECT MAX(id) + DELETE is a cheap no-op on the id primary key.
function prune(keep: number): void {
  openDb()
    .prepare(`DELETE FROM packets WHERE id <= (SELECT MAX(id) FROM packets) - ?`)
    .run(keep);
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
