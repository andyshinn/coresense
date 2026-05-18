// Smoke test: confirm `node:sqlite` ships SQLite with FTS5 compiled in, and
// that the bits we plan to depend on (external-content table, porter+unicode61
// tokenizer stack, bm25 weighting, highlight/snippet) all behave as expected.
//
// Run: node scripts/fts5-smoke.mjs
//
// Exits 0 on success, 1 on any assertion failure. No deps, no Electron — uses
// a temp DB file under os.tmpdir().

import { strict as assert } from 'node:assert';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const dir = mkdtempSync(join(tmpdir(), 'fts5-smoke-'));
const dbPath = join(dir, 'smoke.db');
const db = new DatabaseSync(dbPath);

let failed = 0;
const check = (label, fn) => {
  try {
    fn();
    console.log(`  ok  ${label}`);
  } catch (err) {
    failed += 1;
    console.log(`  FAIL ${label}`);
    console.log(`       ${err.message}`);
  }
};

try {
  console.log(`node ${process.version}`);
  console.log(`db ${dbPath}\n`);

  // 1. Compile options — is FTS5 actually in this build?
  console.log('compile options:');
  const opts = db
    .prepare('PRAGMA compile_options')
    .all()
    .map((r) => r.compile_options);
  const fts5 = opts.find((o) => o.startsWith('ENABLE_FTS5'));
  console.log(`  fts5: ${fts5 ?? 'NOT FOUND'}\n`);
  assert.ok(fts5, 'SQLite was built without ENABLE_FTS5');

  // 2. Base table — mirrors what we already have in messages.db.
  db.exec(`
    CREATE TABLE messages (
      id INTEGER PRIMARY KEY,
      key TEXT NOT NULL,
      ts INTEGER NOT NULL,
      body TEXT NOT NULL
    );
  `);

  // 3. External-content FTS5 table with the tokenizer stack we plan to use.
  //    'porter unicode61 remove_diacritics 2' = stem English + case-fold +
  //    strip diacritics. content='messages' keeps the index thin and lets
  //    highlight()/snippet() return original text.
  check('create FTS5 virtual table (porter+unicode61)', () => {
    db.exec(`
      CREATE VIRTUAL TABLE messages_fts USING fts5(
        body,
        content='messages',
        content_rowid='id',
        tokenize = 'porter unicode61 remove_diacritics 2'
      );
    `);
  });

  // 4. Triggers — keep FTS in sync without touching the insert path.
  check('install sync triggers', () => {
    db.exec(`
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
    `);
  });

  // 5. Seed — include a few stems, a diacritic, punctuation, and FTS5
  //    metacharacters to confirm the sanitizer plan.
  const rows = [
    { key: 'ch:general', ts: 1000, body: 'Running tests against the repeater node.' },
    { key: 'ch:general', ts: 2000, body: 'The repeaters are running hot today.' },
    { key: 'ch:lora', ts: 3000, body: 'Café meetup at 7pm — bring your radios.' },
    { key: 'c:abc', ts: 4000, body: 'AND OR NOT NEAR are FTS5 keywords; * is prefix.' },
    { key: 'c:abc', ts: 5000, body: 'Hello world.' },
    { key: 'ch:general', ts: 6000, body: 'Mesh networking is fun and educational.' },
  ];
  const ins = db.prepare('INSERT INTO messages(key, ts, body) VALUES (?, ?, ?)');
  for (const r of rows) ins.run(r.key, r.ts, r.body);

  // 6. Stemming — "run" should match both "Running" and "running".
  check('porter stemming matches run/running/runs', () => {
    const out = db.prepare(`SELECT rowid FROM messages_fts WHERE messages_fts MATCH 'run'`).all();
    assert.equal(out.length, 2, `expected 2 hits, got ${out.length}`);
  });

  // 7. Diacritic folding — "cafe" should find "Café".
  check('diacritic folding: cafe matches Café', () => {
    const out = db.prepare(`SELECT rowid FROM messages_fts WHERE messages_fts MATCH 'cafe'`).all();
    assert.equal(out.length, 1, `expected 1 hit, got ${out.length}`);
  });

  // 8. bm25() — returns negative scores; ASC = most relevant first.
  check('bm25 ranking (ORDER BY bm25 ASC)', () => {
    const out = db
      .prepare(`
        SELECT m.id, m.body, bm25(messages_fts) AS score
        FROM messages_fts JOIN messages m ON m.id = messages_fts.rowid
        WHERE messages_fts MATCH 'repeater'
        ORDER BY bm25(messages_fts) ASC
      `)
      .all();
    assert.ok(out.length >= 2, `expected 2+ hits, got ${out.length}`);
    assert.ok(out[0].score < 0, `bm25 should be negative, got ${out[0].score}`);
    assert.ok(out[0].score <= out[1].score, 'ASC should put most relevant first');
  });

  // 9. snippet() — needs external-content to return original text.
  check('snippet() returns highlighted text', () => {
    const out = db
      .prepare(`
        SELECT snippet(messages_fts, 0, '[', ']', '…', 8) AS snip
        FROM messages_fts WHERE messages_fts MATCH 'mesh'
      `)
      .get();
    assert.ok(out.snip.includes('['), `snippet missing markers: ${out.snip}`);
  });

  // 10. Prefix search — "repe*" should hit "repeater" and "repeaters".
  check('prefix search (repe*)', () => {
    const out = db.prepare(`SELECT rowid FROM messages_fts WHERE messages_fts MATCH 'repe*'`).all();
    assert.ok(out.length >= 2, `expected 2+ prefix hits, got ${out.length}`);
  });

  // 11. Sanitizer dry-run — raw user input with metacharacters must not throw
  //     once we phrase-wrap. Confirms the cheap escape strategy is enough.
  const escapeFts = (s) => `"${s.replace(/"/g, '""')}"`;
  check('phrase-wrap escapes hostile input', () => {
    const hostile = 'AND NOT "weird) input*';
    db.prepare(`SELECT rowid FROM messages_fts WHERE messages_fts MATCH ?`).all(escapeFts(hostile));
  });

  // 12. Recency vs relevance — same query, two ORDER BYs, one index.
  check('toggle recency vs relevance with ORDER BY', () => {
    const byRelevance = db
      .prepare(`
        SELECT m.id FROM messages_fts JOIN messages m ON m.id = messages_fts.rowid
        WHERE messages_fts MATCH 'run' ORDER BY bm25(messages_fts) ASC
      `)
      .all();
    const byRecency = db
      .prepare(`
        SELECT m.id FROM messages_fts JOIN messages m ON m.id = messages_fts.rowid
        WHERE messages_fts MATCH 'run' ORDER BY m.ts DESC
      `)
      .all();
    assert.equal(byRelevance.length, byRecency.length);
    assert.ok(byRecency[0].id !== byRelevance[0].id || byRecency.length === 1);
  });

  // 13. Optimize — verifies the housekeeping command we'll run on app close.
  check(`optimize compacts the index`, () => {
    db.prepare(`INSERT INTO messages_fts(messages_fts) VALUES('optimize')`).run();
  });
} finally {
  db.close();
  rmSync(dir, { recursive: true, force: true });
}

if (failed > 0) {
  console.log(`\n${failed} check(s) failed`);
  process.exit(1);
}
console.log('\nall checks passed');
