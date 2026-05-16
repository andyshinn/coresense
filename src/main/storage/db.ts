import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { app } from 'electron';
import { child } from '../log';

const log = child('db');

let db: DatabaseSync | null = null;

export function openDb(): DatabaseSync {
  if (db) return db;
  const path = join(app.getPath('userData'), 'messages.db');
  db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA synchronous = NORMAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,                -- 'channel' | 'dm'
      key TEXT NOT NULL,                 -- channel/contact key (ch:..., c:...)
      ts INTEGER NOT NULL,
      from_pk TEXT,                      -- hex; NULL when sent by self
      body TEXT NOT NULL,
      state TEXT NOT NULL,               -- 'sending' | 'sent' | 'ack' | 'failed' | 'received'
      meta TEXT                          -- JSON-encoded MessageMeta
    );
    CREATE INDEX IF NOT EXISTS messages_by_key_ts ON messages (key, ts DESC);
    CREATE INDEX IF NOT EXISTS messages_by_state ON messages (state);
  `);
  log.info(`opened ${path}`);
  return db;
}

export function closeDb(): void {
  if (db) {
    try {
      db.close();
    } catch (err) {
      log.warn(`close failed: ${(err as Error).message}`);
    }
    db = null;
  }
}
