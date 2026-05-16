import type { Message, MessageMeta, MessageState } from '../../shared/types';
import { openDb } from './db';

interface Row {
  id: string;
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
    id: row.id,
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

export const messagesStore = {
  insert(message: Message): void {
    const db = openDb();
    const kind = kindFromKey(message.key);
    db.prepare(
      `INSERT OR REPLACE INTO messages (id, kind, key, ts, from_pk, body, state, meta)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      message.id,
      kind,
      message.key,
      message.ts,
      message.fromPublicKeyHex ?? null,
      message.body,
      message.state,
      message.meta ? JSON.stringify(message.meta) : null,
    );
  },

  byKey(key: string, opts: { limit?: number; before?: number } = {}): Message[] {
    const db = openDb();
    const limit = opts.limit ?? 200;
    const rows = opts.before
      ? (db
          .prepare(`SELECT * FROM messages WHERE key = ? AND ts < ? ORDER BY ts DESC LIMIT ?`)
          .all(key, opts.before, limit) as unknown as Row[])
      : (db
          .prepare(`SELECT * FROM messages WHERE key = ? ORDER BY ts DESC LIMIT ?`)
          .all(key, limit) as unknown as Row[]);
    return rows.map(rowToMessage).reverse();
  },

  recent(limit = 500): Message[] {
    const db = openDb();
    const rows = db
      .prepare(`SELECT * FROM messages ORDER BY ts DESC LIMIT ?`)
      .all(limit) as unknown as Row[];
    return rows.map(rowToMessage).reverse();
  },

  markState(id: string, state: MessageState): void {
    const db = openDb();
    db.prepare(`UPDATE messages SET state = ? WHERE id = ?`).run(state, id);
  },

  // Trim per-key history to keep the DB bounded. Default 1000 keeps the last
  // thousand messages per channel/DM.
  trimPerKey(key: string, keep = 1000): void {
    const db = openDb();
    db.prepare(
      `DELETE FROM messages WHERE key = ? AND id NOT IN (
         SELECT id FROM messages WHERE key = ? ORDER BY ts DESC LIMIT ?
       )`,
    ).run(key, key, keep);
  },
};
