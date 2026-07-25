import type { ActivityBand, ChannelActivity, ChannelStats, Message, MessageMeta, MessageState } from '../../shared/types';
import { openDb } from './db';

interface Row {
  mid: string;
  kind: string;
  key: string;
  ts: number;
  from_pk: string | null;
  body: string;
  state: string;
  meta: string | null;
}

function rowToMessage(row: Row): Message {
  const meta = row.meta ? (JSON.parse(row.meta) as MessageMeta) : undefined;
  return {
    id: row.mid,
    key: row.key,
    fromPublicKeyHex: row.from_pk ?? undefined,
    body: row.body,
    ts: row.ts,
    state: row.state as MessageState,
    meta,
  };
}

function kindFromKey(key: string): 'channel' | 'dm' {
  if (key.startsWith('ch:')) return 'channel';
  if (key.startsWith('c:')) return 'dm';
  throw new Error(`unrecognized message key '${key}'`);
}

// search.ts wraps FTS5 snippet output with a private-use-area sentinel pair
// to round-trip <mark> tags through HTML escape. If a message body somehow
// contains the sentinel (effectively impossible — they're rare codepoints
// only emitted by us), strip it on the way in so a search snippet can't
// gain an unintended <mark>. Belt and braces; ~free.
const SENTINEL_RE = /\u{1F539}(?:START|END)\u{1F539}/gu;
function sanitizeBody(body: string): string {
  return body.replace(SENTINEL_RE, '');
}

const HOUR_MS = 3_600_000;

/** Local-midnight edges for `n` calendar days ending with the day containing `now`.
 *  Returns n+1 timestamps: edges[i] opens bucket i, edges[n] closes the last one.
 *  Stepped with setDate() rather than ms arithmetic so DST days stay one bucket. */
function localDayEdges(now: number, n: number): number[] {
  const edges: number[] = [];
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - (n - 1));
  for (let i = 0; i <= n; i++) {
    edges.push(d.getTime());
    d.setDate(d.getDate() + 1);
  }
  return edges;
}

/** Index of the bucket containing `ts`, or -1 if outside. `edges` is ascending. */
function edgeIndex(edges: number[], ts: number): number {
  if (ts < edges[0] || ts >= edges[edges.length - 1]) return -1;
  let lo = 0;
  let hi = edges.length - 1;
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if (ts < edges[mid]) hi = mid;
    else lo = mid;
  }
  return lo;
}

/** Below this many messages in the trailing 168h, naming a "peak" is noise. */
const BAND_MIN_SAMPLES = 8;

/** Best contiguous `width`-hour band on a 24-slot hour-of-day histogram, searched
 *  circularly so a band may wrap midnight. Strict comparison means ties break
 *  toward the earlier start hour, which keeps the result deterministic. */
function bestBand(hist: number[], width: number, pick: 'max' | 'min'): ActivityBand {
  let bestStart = 0;
  let bestSum = pick === 'max' ? -1 : Number.POSITIVE_INFINITY;
  for (let start = 0; start < 24; start++) {
    let s = 0;
    for (let k = 0; k < width; k++) s += hist[(start + k) % 24];
    if (pick === 'max' ? s > bestSum : s < bestSum) {
      bestSum = s;
      bestStart = start;
    }
  }
  return { startHour: bestStart, endHour: (bestStart + width) % 24 };
}

export const messagesStore = {
  insert(message: Message): void {
    const db = openDb();
    const kind = kindFromKey(message.key);
    // Idempotent on app-level id (`mid`). The integer rowid is assigned by
    // SQLite and is internal — FTS5 uses it as the anchor. Updating an
    // existing row triggers the AU sync to messages_fts.
    db.prepare(
      `INSERT INTO messages (mid, kind, key, ts, from_pk, body, state, meta)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(mid) DO UPDATE SET
         kind=excluded.kind, key=excluded.key, ts=excluded.ts,
         from_pk=excluded.from_pk, body=excluded.body, state=excluded.state,
         meta=excluded.meta`,
    ).run(
      message.id,
      kind,
      message.key,
      message.ts,
      message.fromPublicKeyHex ?? null,
      sanitizeBody(message.body),
      message.state,
      message.meta ? JSON.stringify(message.meta) : null,
    );
  },

  byKey(key: string, opts: { limit?: number; before?: number } = {}): Message[] {
    const db = openDb();
    const limit = opts.limit ?? 200;
    const rows = opts.before
      ? (db
          .prepare(
            `SELECT mid, kind, key, ts, from_pk, body, state, meta FROM messages
             WHERE key = ? AND ts < ? ORDER BY ts DESC LIMIT ?`,
          )
          .all(key, opts.before, limit) as unknown as Row[])
      : (db
          .prepare(
            `SELECT mid, kind, key, ts, from_pk, body, state, meta FROM messages
             WHERE key = ? ORDER BY ts DESC LIMIT ?`,
          )
          .all(key, limit) as unknown as Row[]);
    return rows.map(rowToMessage).reverse();
  },

  statsByKey(key: string, now: number = Date.now()): ChannelStats {
    const db = openDb();
    const DAY = 86_400_000;
    const since24h = now - DAY;
    const since7d = now - 7 * DAY;

    const agg = db
      .prepare(`SELECT COUNT(*) AS count, MIN(ts) AS firstTs, MAX(ts) AS lastTs FROM messages WHERE key = ?`)
      .get(key) as unknown as { count: number; firstTs: number | null; lastTs: number | null };

    const win = db
      .prepare(
        `SELECT
           SUM(CASE WHEN ts >= ? THEN 1 ELSE 0 END) AS c24,
           SUM(CASE WHEN ts >= ? THEN 1 ELSE 0 END) AS c7
         FROM messages WHERE key = ?`,
      )
      .get(since24h, since7d, key) as unknown as { c24: number | null; c7: number | null };

    const senderRows = db
      .prepare(
        `SELECT from_pk AS fromPk, COUNT(*) AS count, MAX(ts) AS lastTs
         FROM messages WHERE key = ? GROUP BY from_pk ORDER BY lastTs DESC`,
      )
      .all(key) as unknown as Array<{ fromPk: string | null; count: number; lastTs: number }>;

    const roster = senderRows.map((r) => ({ fromPk: r.fromPk, count: r.count, lastTs: r.lastTs }));
    const distinctSenders = roster.filter((r) => r.fromPk !== null && r.fromPk !== 'unknown').length;

    // Bucket the last 7 calendar days (local tz), index 6 = today.
    const perDay = [0, 0, 0, 0, 0, 0, 0];
    const tsRows = db.prepare(`SELECT ts FROM messages WHERE key = ? AND ts >= ?`).all(key, since7d) as unknown as Array<{
      ts: number;
    }>;
    const startOfToday = new Date(now);
    startOfToday.setHours(0, 0, 0, 0);
    const startMs = startOfToday.getTime();
    for (const { ts } of tsRows) {
      const bucket = 6 + Math.floor((ts - startMs) / DAY);
      if (bucket >= 0 && bucket < 7) perDay[bucket] += 1;
    }

    return {
      count: agg.count,
      firstTs: agg.firstTs,
      lastTs: agg.lastTs,
      count24h: win.c24 ?? 0,
      count7d: win.c7 ?? 0,
      distinctSenders,
      roster,
      perDay,
    };
  },

  activityByKey(key: string, now: number = Date.now()): ChannelActivity {
    const db = openDb();

    // Hourly window: 24 buckets on the wall-clock hour grid, ending with the hour
    // `now` currently sits in — a partial bucket that fills as the hour progresses.
    // Grid alignment is load-bearing, not cosmetic: the renderer labels axis ticks
    // and tooltips from each bucket's start edge via getHours(), which is only
    // truthful when the edges are real clock hours.
    const hourStart = new Date(now);
    hourStart.setMinutes(0, 0, 0);
    const h24Start = hourStart.getTime() - 23 * HOUR_MS;
    const h24End = h24Start + 24 * HOUR_MS;
    const prev24Start = h24Start - 24 * HOUR_MS;

    const d7 = localDayEdges(now, 7);
    const d30 = localDayEdges(now, 30);

    // Previous equal periods. The 30d one is the oldest cutoff we need to read.
    const prev7Start = localDayEdges(d7[0] - 1, 7)[0];
    const prev30Start = localDayEdges(d30[0] - 1, 30)[0];
    const since = Math.min(prev24Start, prev7Start, prev30Start);

    const rows = db.prepare(`SELECT ts FROM messages WHERE key = ? AND ts >= ?`).all(key, since) as unknown as Array<{
      ts: number;
    }>;

    const b24 = new Array<number>(24).fill(0);
    const b7 = new Array<number>(7).fill(0);
    const b30 = new Array<number>(30).fill(0);
    let prev24 = 0;
    let prev7 = 0;
    let prev30 = 0;

    // Rhythm bands: an hour-of-day histogram over the trailing 168h (independent
    // of the day-grid windows above), searched below for the busiest/calmest runs.
    const bandSince = now - 168 * HOUR_MS;
    const hourHist = new Array<number>(24).fill(0);
    let bandSamples = 0;

    for (const { ts } of rows) {
      if (ts >= h24Start && ts < h24End) b24[Math.floor((ts - h24Start) / HOUR_MS)] += 1;
      else if (ts >= prev24Start && ts < h24Start) prev24 += 1;

      const i7 = edgeIndex(d7, ts);
      if (i7 >= 0) b7[i7] += 1;
      else if (ts >= prev7Start && ts < d7[0]) prev7 += 1;

      const i30 = edgeIndex(d30, ts);
      if (i30 >= 0) b30[i30] += 1;
      else if (ts >= prev30Start && ts < d30[0]) prev30 += 1;

      if (ts >= bandSince && ts <= now) {
        hourHist[new Date(ts).getHours()] += 1;
        bandSamples += 1;
      }
    }

    const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
    const lastRow = db.prepare(`SELECT MAX(ts) AS lastTs FROM messages WHERE key = ?`).get(key) as unknown as {
      lastTs: number | null;
    };

    return {
      windows: {
        '24h': { buckets: b24, total: sum(b24), prevTotal: prev24, startMs: h24Start },
        '7d': { buckets: b7, total: sum(b7), prevTotal: prev7, startMs: d7[0] },
        '30d': { buckets: b30, total: sum(b30), prevTotal: prev30, startMs: d30[0] },
      },
      peakBand: bandSamples >= BAND_MIN_SAMPLES ? bestBand(hourHist, 3, 'max') : null,
      quietBand: bandSamples >= BAND_MIN_SAMPLES ? bestBand(hourHist, 4, 'min') : null,
      lastTs: lastRow.lastTs ?? null,
    };
  },

  recent(limit = 500): Message[] {
    const db = openDb();
    const rows = db
      .prepare(
        `SELECT mid, kind, key, ts, from_pk, body, state, meta FROM messages
         ORDER BY ts DESC LIMIT ?`,
      )
      .all(limit) as unknown as Row[];
    return rows.map(rowToMessage).reverse();
  },

  /** All messages with ts >= cutoff, ordered by ts asc. Used by the block-rule
   *  backfill pass to credit retro-matches. Capped to avoid runaway scans on
   *  cutoff=0. */
  sinceTs(cutoffMs: number, limit = 50_000): Message[] {
    const db = openDb();
    const rows = db
      .prepare(
        `SELECT mid, kind, key, ts, from_pk, body, state, meta FROM messages
         WHERE ts >= ? ORDER BY ts ASC LIMIT ?`,
      )
      .all(cutoffMs, limit) as unknown as Row[];
    return rows.map(rowToMessage);
  },

  findById(id: string): Message | null {
    const db = openDb();
    const row = db.prepare(`SELECT mid, kind, key, ts, from_pk, body, state, meta FROM messages WHERE mid = ?`).get(id) as
      | Row
      | undefined;
    return row ? rowToMessage(row) : null;
  },

  markState(id: string, state: MessageState): void {
    const db = openDb();
    db.prepare(`UPDATE messages SET state = ? WHERE mid = ?`).run(state, id);
  },

  // Trim per-key history to keep the DB bounded. Default 1000 keeps the last
  // thousand messages per channel/DM. The DELETE trigger keeps messages_fts
  // in sync.
  trimPerKey(key: string, keep = 1000): void {
    const db = openDb();
    db.prepare(
      `DELETE FROM messages WHERE key = ? AND id NOT IN (
         SELECT id FROM messages WHERE key = ? ORDER BY ts DESC LIMIT ?
       )`,
    ).run(key, key, keep);
  },
};
