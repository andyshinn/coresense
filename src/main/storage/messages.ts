import type { Message, MessageMeta, MessageState } from '../../shared/types';
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
    const row = db
      .prepare(`SELECT mid, kind, key, ts, from_pk, body, state, meta FROM messages WHERE mid = ?`)
      .get(id) as Row | undefined;
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
