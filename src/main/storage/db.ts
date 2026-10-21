import { join } from 'node:path';
import { DatabaseSync, type SQLInputValue, type StatementSync } from 'node:sqlite';
import { errorMessage } from '../../shared/errors';
import { child } from '../log';
import { userDataDir } from '../runtime/userData';

const log = child('db');

let db: DatabaseSync | null = null;

export function openDb(): DatabaseSync {
  if (db) return db;
  const path = join(userDataDir(), 'messages.db');
  const conn = new DatabaseSync(path);
  try {
    initSchema(conn);
  } catch (err) {
    // Don't cache a half-migrated connection: the next openDb() retries.
    conn.close();
    throw err;
  }
  db = conn;
  log.info(`opened ${path}`);
  return conn;
}

function initSchema(conn: DatabaseSync): void {
  conn.exec('PRAGMA journal_mode = WAL');
  conn.exec('PRAGMA synchronous = NORMAL');
  conn.exec('PRAGMA foreign_keys = ON');

  // Idempotent: existing tables/indexes/triggers survive across launches so
  // persisted messages are retained.
  conn.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      id      INTEGER PRIMARY KEY,         -- FTS5 anchor (rowid)
      mid     TEXT NOT NULL UNIQUE,        -- app-level message id
      kind    TEXT NOT NULL,               -- 'channel' | 'dm'
      key     TEXT NOT NULL,               -- 'ch:<name>' | 'c:<pkhex>'
      ts      INTEGER NOT NULL,
      from_pk TEXT,                        -- hex; NULL when sent by self
      body    TEXT NOT NULL,
      state   TEXT NOT NULL,               -- MessageState: 'sending' | 'sent' | 'heard' | 'ack' | 'failed' | 'received'
      meta    TEXT                         -- JSON-encoded MessageMeta
    );
    CREATE INDEX IF NOT EXISTS messages_by_key_ts  ON messages (key, ts DESC);
    -- messages_by_state was never read by any query (state is only ever
    -- written, by mid), so it was pure write cost. Dropped on existing installs.
    DROP INDEX IF EXISTS messages_by_state;
    CREATE INDEX IF NOT EXISTS messages_by_from_pk ON messages (from_pk);

    -- Full-text index over message bodies. External-content keeps the body
    -- in the messages table (so snippet()/highlight() return original text)
    -- and mirrors it via triggers. Stemmer stack: case-fold +
    -- diacritic-strip + porter stems English so 'run' matches 'running'.
    CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
      body,
      content='messages',
      content_rowid='id',
      tokenize = 'porter unicode61 remove_diacritics 2'
    );

    CREATE TRIGGER IF NOT EXISTS messages_ai AFTER INSERT ON messages BEGIN
      INSERT INTO messages_fts(rowid, body) VALUES (new.id, new.body);
    END;
    CREATE TRIGGER IF NOT EXISTS messages_ad AFTER DELETE ON messages BEGIN
      INSERT INTO messages_fts(messages_fts, rowid, body) VALUES('delete', old.id, old.body);
    END;
    CREATE TRIGGER IF NOT EXISTS messages_au AFTER UPDATE ON messages BEGIN
      INSERT INTO messages_fts(messages_fts, rowid, body) VALUES('delete', old.id, old.body);
      INSERT INTO messages_fts(rowid, body) VALUES (new.id, new.body);
    END;

    -- Conversation-level index for channel/contact names and public keys.
    -- Small (≤ a few hundred rows); rebuilt from the holder snapshot on every
    -- channel/contact mutation rather than maintained incrementally.
    -- pk_prefix holds the first 16 hex chars; pk_suffix_rev holds the LAST
    -- 16 hex chars REVERSED so FTS5's prefix-only wildcard ('abc*') doubles
    -- as suffix matching when we reverse the user's hex query. contact_kind is
    -- indexed so typing a kind ('repeater') surfaces those contacts and a
    -- future filter can use it. Dropped + recreated (not IF NOT EXISTS) because
    -- the table is derived: FTS5 can't ALTER ADD COLUMN, and the data is
    -- repopulated by rebuildConversationsIndex on open.
    DROP TABLE IF EXISTS conversations_fts;
    CREATE VIRTUAL TABLE conversations_fts USING fts5(
      kind UNINDEXED,
      key  UNINDEXED,
      name,
      pk_prefix,
      pk_suffix_rev,
      contact_kind,
      tokenize = 'unicode61 remove_diacritics 2'
    );

    -- Discovered-contacts pool: every node we've heard an advert from, whether
    -- or not it is committed to the radio's on-device store. on_radio mirrors
    -- membership in the radio's GET_CONTACTS result; first_heard_ms is our
    -- clock (the firmware tracks no first-heard). Keyed by full hex pubkey.
    CREATE TABLE IF NOT EXISTS discovered_contacts (
      pubkey          TEXT PRIMARY KEY,
      name            TEXT NOT NULL,
      type            INTEGER NOT NULL,
      flags           INTEGER NOT NULL,
      out_path_len    INTEGER NOT NULL,
      out_path_hex    TEXT NOT NULL,
      last_advert_unix INTEGER NOT NULL,
      gps_lat         REAL NOT NULL,
      gps_lon         REAL NOT NULL,
      lastmod         INTEGER NOT NULL,
      first_heard_ms  INTEGER NOT NULL,
      last_heard_ms   INTEGER NOT NULL DEFAULT 0,
      on_radio        INTEGER NOT NULL DEFAULT 0,
      favourite       INTEGER NOT NULL DEFAULT 0,
      -- The INBOUND advert path, sampled from the radio's own 16-entry cache
      -- with CMD_GET_ADVERT_PATH (#45 item 7). Deliberately separate from
      -- out_path_len, which is the LEARNED OUTBOUND route: an asymmetric mesh
      -- makes the two legitimately differ, so neither may overwrite the other.
      -- -1 is the "never measured" sentinel because 0 is a REAL value (the
      -- advert arrived direct) and cannot double as one. observed_at_unix is the
      -- RADIO's RTC seconds, not our clock.
      observed_hops     INTEGER NOT NULL DEFAULT -1,
      observed_path_hex TEXT    NOT NULL DEFAULT '',
      observed_at_unix  INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS discovered_by_last_advert ON discovered_contacts (last_advert_unix DESC);
    CREATE INDEX IF NOT EXISTS discovered_by_on_radio    ON discovered_contacts (on_radio);

    -- Ids of messages the user deleted. Consulted on the inbound write path so
    -- a re-heard packet can't resurrect a deleted row: the library mints
    -- channel-message ids deterministically (chmsg-<key>-<ts>-<bodyhash>) and
    -- messagesStore.insert upserts on mid, so without this a second flood
    -- receipt silently re-creates the row. Kept forever — ~40 bytes each, and
    -- the library rebuilds its in-memory map each session so a process-scoped
    -- guard would let the message return on the next launch.
    -- Removed once andyshinn/meshcore-ts#2 lands a suppression API.
    CREATE TABLE IF NOT EXISTS deleted_messages (
      mid TEXT PRIMARY KEY,
      ts  INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS packets (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      ts          INTEGER NOT NULL,
      transport   TEXT    NOT NULL,
      kind        TEXT    NOT NULL,
      hex         TEXT    NOT NULL,
      payload_hex TEXT    NOT NULL,
      snr         REAL,
      rssi        REAL,
      code        INTEGER,
      code_name   TEXT
    );
    CREATE INDEX IF NOT EXISTS packets_by_ts ON packets (ts);

    -- Saved telemetry requests (storage/telemetry.ts), every attempt that
    -- reached the radio: replies, timeouts and errors alike. raw_hex is the
    -- CayenneLPP payload exactly as received (mesh padding included) and is the
    -- source of truth — readings are decoded on read, so a better decoder
    -- re-reads old rows. NULL when no reply came. node_key is the bare
    -- lowercase 64-hex public key; the owner's own key for a companion read.
    -- Kept when the contact is deleted, as messages are.
    CREATE TABLE IF NOT EXISTS telemetry_requests (
      id            TEXT PRIMARY KEY,
      node_key      TEXT    NOT NULL,
      source        TEXT    NOT NULL,          -- 'repeater' | 'contact' | 'companion'
      requested_at  INTEGER NOT NULL,          -- epoch ms, when the user clicked
      replied_at    INTEGER,
      outcome       TEXT    NOT NULL,          -- 'ok' | 'timeout' | 'error'
      error         TEXT,
      round_trip_ms INTEGER,
      hops          INTEGER,
      route         TEXT,                      -- 'direct' | 'flood' | 'local'
      acl_role      TEXT,                      -- RepeaterAclRole at request time
      perms_granted INTEGER,                   -- inferred TELEM_PERM_* mask
      raw_hex       TEXT
    );
    CREATE INDEX IF NOT EXISTS telemetry_by_node_time ON telemetry_requests (node_key, requested_at DESC);
  `);

  // The observed_* columns above were added after the app shipped (#45 item 7),
  // and `CREATE TABLE IF NOT EXISTS` does nothing for a database that already
  // has the table — so without these every existing install would open fine and
  // then read `undefined` for the new columns on every SELECT *. There is no
  // migration framework here by design (see the DDL above): the house pattern is
  // a guarded ADD COLUMN, which throws "duplicate column name" once the column
  // is present, making that one failure the success signal on every later boot
  // (see addColumnIfMissing).
  //
  // Do NOT delete these once the columns are in the DDL. That was done to the
  // last_heard_ms migration on the grounds that "dev wipes the DB", which stops
  // being true the moment the app ships through a release.
  for (const ddl of [
    'ALTER TABLE discovered_contacts ADD COLUMN observed_hops INTEGER NOT NULL DEFAULT -1',
    "ALTER TABLE discovered_contacts ADD COLUMN observed_path_hex TEXT NOT NULL DEFAULT ''",
    'ALTER TABLE discovered_contacts ADD COLUMN observed_at_unix INTEGER NOT NULL DEFAULT 0',
  ]) {
    addColumnIfMissing(conn, ddl);
  }
}

/** Run one guarded `ALTER TABLE … ADD COLUMN`. Only "duplicate column name"
 *  means the column already exists; anything else (SQLITE_BUSY, a read-only or
 *  full disk, a typo in the DDL) is a real failure and is rethrown, rather than
 *  being read as "already migrated" and surfacing later as `undefined` columns
 *  on every SELECT *. Exported for tests. */
export function addColumnIfMissing(conn: DatabaseSync, ddl: string): void {
  try {
    conn.exec(ddl);
  } catch (err) {
    if (/duplicate column name/i.test(errorMessage(err))) return; // column already exists — nothing to do
    log.error(`migration failed (${ddl}): ${errorMessage(err)}`);
    throw err;
  }
}

/** Run `fn` between BEGIN and COMMIT, rolling back if it throws. Always rethrows
 *  `fn`'s own error: a ROLLBACK that fails too is logged rather than allowed to
 *  replace the error that explains what went wrong. */
export function withTransaction<T>(conn: DatabaseSync, fn: () => T): T {
  conn.exec('BEGIN');
  try {
    const result = fn();
    conn.exec('COMMIT');
    return result;
  } catch (err) {
    try {
      conn.exec('ROLLBACK');
    } catch (rollbackErr) {
      log.warn(`rollback failed: ${errorMessage(rollbackErr)}`);
    }
    throw err;
  }
}

/** `stmt.all(...)` typed as rows of `T`. This (with `get`) is the ONE unchecked
 *  boundary between SQLite and our row interfaces: nothing verifies that the
 *  SELECT list matches `T`, so each Row interface must be kept in step with its
 *  query by hand. Keep loosely-typed columns loose (`state: string`) and narrow
 *  them visibly where they are read. */
export function all<T>(stmt: StatementSync, ...params: SQLInputValue[]): T[] {
  return stmt.all(...params) as T[];
}

/** `stmt.get(...)` typed as a row of `T`; see `all` for the caveat. */
export function get<T>(stmt: StatementSync, ...params: SQLInputValue[]): T | undefined {
  return stmt.get(...params) as T | undefined;
}

/** An untrusted LIMIT as a positive integer no greater than `max`. SQLite reads
 *  a negative LIMIT as "no limit", so a negative, zero, fractional-below-one or
 *  non-numeric value must never reach the statement: it becomes `fallback`. */
export function clampLimit(value: unknown, fallback: number, max = Number.POSITIVE_INFINITY): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 1) return fallback;
  return Math.min(Math.floor(value), max);
}

export function closeDb(): void {
  if (db) {
    try {
      db.close();
    } catch (err) {
      log.warn(`close failed: ${errorMessage(err)}`);
    }
    db = null;
  }
}
