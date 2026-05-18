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
  // Pre-release: drop the legacy string-keyed table so FTS5's external-content
  // pattern can anchor to an INTEGER PRIMARY KEY rowid. The app-level message
  // id is now stored in `mid` (UNIQUE) — same identity, different storage.
  db.exec(`DROP TABLE IF EXISTS messages_fts`);
  db.exec(`DROP TABLE IF EXISTS conversations_fts`);
  db.exec(`DROP TABLE IF EXISTS messages`);
  db.exec(`
    CREATE TABLE messages (
      id      INTEGER PRIMARY KEY,         -- FTS5 anchor (rowid)
      mid     TEXT NOT NULL UNIQUE,        -- app-level message id
      kind    TEXT NOT NULL,               -- 'channel' | 'dm'
      key     TEXT NOT NULL,               -- 'ch:<name>' | 'c:<pkhex>'
      ts      INTEGER NOT NULL,
      from_pk TEXT,                        -- hex; NULL when sent by self
      body    TEXT NOT NULL,
      state   TEXT NOT NULL,               -- 'sending' | 'sent' | 'ack' | 'failed' | 'received'
      meta    TEXT                         -- JSON-encoded MessageMeta
    );
    CREATE INDEX messages_by_key_ts  ON messages (key, ts DESC);
    CREATE INDEX messages_by_state   ON messages (state);
    CREATE INDEX messages_by_from_pk ON messages (from_pk);

    -- Full-text index over message bodies. External-content keeps the body
    -- in the messages table (so snippet()/highlight() return original text)
    -- and mirrors it via triggers. Stemmer stack: case-fold +
    -- diacritic-strip + porter stems English so 'run' matches 'running'.
    CREATE VIRTUAL TABLE messages_fts USING fts5(
      body,
      content='messages',
      content_rowid='id',
      tokenize = 'porter unicode61 remove_diacritics 2'
    );

    CREATE TRIGGER messages_ai AFTER INSERT ON messages BEGIN
      INSERT INTO messages_fts(rowid, body) VALUES (new.id, new.body);
    END;
    CREATE TRIGGER messages_ad AFTER DELETE ON messages BEGIN
      INSERT INTO messages_fts(messages_fts, rowid, body) VALUES('delete', old.id, old.body);
    END;
    CREATE TRIGGER messages_au AFTER UPDATE ON messages BEGIN
      INSERT INTO messages_fts(messages_fts, rowid, body) VALUES('delete', old.id, old.body);
      INSERT INTO messages_fts(rowid, body) VALUES (new.id, new.body);
    END;

    -- Conversation-level index for channel/contact names and public keys.
    -- Small (≤ a few hundred rows); rebuilt from the holder snapshot on every
    -- channel/contact mutation rather than maintained incrementally.
    -- pk_prefix holds the first 16 hex chars; pk_suffix_rev holds the LAST
    -- 16 hex chars REVERSED so FTS5's prefix-only wildcard ('abc*') doubles
    -- as suffix matching when we reverse the user's hex query.
    CREATE VIRTUAL TABLE conversations_fts USING fts5(
      kind UNINDEXED,
      key  UNINDEXED,
      name,
      pk_prefix,
      pk_suffix_rev,
      tokenize = 'unicode61 remove_diacritics 2'
    );
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
