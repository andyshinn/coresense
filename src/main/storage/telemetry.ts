import { bytesToHex, hexToBytes } from '../../shared/telemetry/lpp';
import type { SavedRequest, TelemetryOutcome, TelemetryRoute, TelemetrySource } from '../../shared/telemetry/types';
import type { RepeaterAclRole } from '../../shared/types';
import { openDb } from './db';

interface Row {
  id: string;
  node_key: string;
  source: string;
  requested_at: number;
  replied_at: number | null;
  outcome: string;
  error: string | null;
  round_trip_ms: number | null;
  hops: number | null;
  route: string | null;
  acl_role: string | null;
  perms_granted: number | null;
  raw_hex: string | null;
}

/** Rows removed by a prune, grouped by the node they belonged to. */
export interface PrunedRequests {
  nodeKey: string;
  ids: string[];
}

function rowToRequest(r: Row): SavedRequest {
  return {
    id: r.id,
    nodeKey: r.node_key,
    source: r.source as TelemetrySource,
    requestedAt: r.requested_at,
    repliedAt: r.replied_at,
    outcome: r.outcome as TelemetryOutcome,
    ...(r.error != null ? { error: r.error } : {}),
    roundTripMs: r.round_trip_ms,
    hops: r.hops,
    route: r.route as TelemetryRoute | null,
    aclRole: r.acl_role as RepeaterAclRole | null,
    permsGranted: r.perms_granted,
    // hexToBytes returns null only for malformed hex, which this module never
    // writes; a hand-edited row then reads as "no reply" rather than throwing.
    raw: r.raw_hex != null ? hexToBytes(r.raw_hex) : null,
  };
}

// Newest first. requested_at is a click time at ms resolution, so two rows can
// tie; rowid breaks it in insertion order, which is the order they finished.
const NEWEST_FIRST = 'ORDER BY requested_at DESC, rowid DESC';

/** Drop all but the newest `keep` rows for one node; returns the removed ids. */
function pruneNode(nodeKey: string, keep: number): string[] {
  const rows = openDb()
    .prepare(
      `DELETE FROM telemetry_requests
        WHERE node_key = ?
          AND id NOT IN (SELECT id FROM telemetry_requests WHERE node_key = ? ${NEWEST_FIRST} LIMIT ?)
        RETURNING id`,
    )
    .all(nodeKey, nodeKey, Math.max(0, keep)) as Array<{ id: string }>;
  return rows.map((r) => r.id);
}

export const telemetryStore = {
  /** Persist one request, then prune its node to the newest `keep`, in one
   *  transaction — so a reader never sees the node over its limit, and a failed
   *  prune can't leave the insert behind. Returns the ids the prune removed
   *  (usually none) so the caller can tell clients to drop them. */
  insert(req: SavedRequest, keep: number): string[] {
    const db = openDb();
    db.exec('BEGIN');
    try {
      db.prepare(
        `INSERT INTO telemetry_requests
           (id, node_key, source, requested_at, replied_at, outcome, error, round_trip_ms,
            hops, route, acl_role, perms_granted, raw_hex)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        req.id,
        req.nodeKey,
        req.source,
        req.requestedAt,
        req.repliedAt,
        req.outcome,
        req.error ?? null,
        req.roundTripMs,
        req.hops,
        req.route,
        req.aclRole,
        req.permsGranted,
        req.raw ? bytesToHex(req.raw) : null,
      );
      const pruned = pruneNode(req.nodeKey, keep);
      db.exec('COMMIT');
      return pruned;
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  },

  /** One node's saved requests, newest first. */
  list(nodeKey: string): SavedRequest[] {
    const rows = openDb()
      .prepare(`SELECT * FROM telemetry_requests WHERE node_key = ? ${NEWEST_FIRST}`)
      .all(nodeKey) as unknown as Row[];
    return rows.map(rowToRequest);
  },

  get(id: string): SavedRequest | null {
    const row = openDb().prepare(`SELECT * FROM telemetry_requests WHERE id = ?`).get(id) as Row | undefined;
    return row ? rowToRequest(row) : null;
  },

  /** Remove one request. Returns the node it belonged to, or null when no
   *  such id exists. */
  delete(id: string): { nodeKey: string } | null {
    const row = openDb().prepare(`DELETE FROM telemetry_requests WHERE id = ? RETURNING node_key`).get(id) as
      | { node_key: string }
      | undefined;
    return row ? { nodeKey: row.node_key } : null;
  },

  /** Remove every request for one node. Returns how many went. */
  clear(nodeKey: string): number {
    return Number(openDb().prepare(`DELETE FROM telemetry_requests WHERE node_key = ?`).run(nodeKey).changes);
  },

  /** Prune every node to its newest `limit`. Called when the retention setting
   *  shrinks, so it takes effect at once rather than node by node as each is
   *  next requested. Returns what went, per node. */
  pruneAll(limit: number): PrunedRequests[] {
    const rows = openDb()
      .prepare(
        `DELETE FROM telemetry_requests
          WHERE id IN (
            SELECT id FROM (
              SELECT id, ROW_NUMBER() OVER (PARTITION BY node_key ${NEWEST_FIRST}) AS rn
                FROM telemetry_requests
            ) WHERE rn > ?
          )
          RETURNING id, node_key`,
      )
      .all(Math.max(0, limit)) as Array<{ id: string; node_key: string }>;
    const byNode = new Map<string, string[]>();
    for (const r of rows) {
      const ids = byNode.get(r.node_key);
      if (ids) ids.push(r.id);
      else byNode.set(r.node_key, [r.id]);
    }
    return [...byNode].map(([nodeKey, ids]) => ({ nodeKey, ids }));
  },
};
