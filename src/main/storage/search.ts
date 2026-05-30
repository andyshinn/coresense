import { isMessageBlocked } from '../../shared/blocking/match';
import type {
  Channel,
  Contact,
  ConversationHit,
  MessageHit,
  SearchOptions,
  SearchResults,
} from '../../shared/types';
import { blockingStore } from '../blocking/store';
import { stateHolder } from '../state/holder';
import { openDb } from './db';

// Tokens shorter than this are dropped to avoid massively broad result sets
// from single-letter terms (FTS5 BM25 ranking suffers and the snippet noise
// outweighs the signal).
const MIN_TOKEN_LEN = 2;
const DEFAULT_LIMIT = 100;
const HARD_LIMIT = 500;
// Pagination cap. Beyond this the "scan + skip" cost outweighs the value of
// digging deeper — narrow the query instead.
const HARD_OFFSET = 5000;
const HEX_RE = /^[0-9a-f]{4,}$/i;

// FTS5 has its own MATCH grammar that throws on stray punctuation and bare
// keywords (AND OR NOT NEAR). The safest cheap escape is to quote each token
// as a phrase ("foo") — phrases disable operator parsing. The closing-quote
// escape inside the phrase is a doubled quote ("a""b" matches the literal
// a"b). Multi-token queries become "tok1" "tok2" — implicit AND.
function escapePhrase(s: string): string {
  return `"${s.replace(/"/g, '""')}"`;
}

function reverseStr(s: string): string {
  return s.split('').reverse().join('');
}

// Strip FTS5 metacharacters so a hostile token can never appear unquoted.
// We always wrap in phrase-quotes afterward, so this is belt-and-braces.
function stripMeta(s: string): string {
  return s.replace(/["()*:]/g, ' ').trim();
}

function htmlEscape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Split user input into a list of indexable tokens, then build the FTS5
// MATCH expression. The last token gets a `*` prefix wildcard so live-typing
// surfaces partial matches before the user stops.
//
// Returns null when there is no usable input — callers short-circuit to an
// empty result set rather than asking FTS5 to match nothing.
function buildMatchExpression(raw: string): {
  match: string;
  /** Reversed forms of hex-looking tokens for suffix lookup against
   *  conversations_fts.pk_suffix_rev. */
  reversedHex: string[];
} | null {
  const tokens = stripMeta(raw)
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= MIN_TOKEN_LEN);
  if (tokens.length === 0) return null;
  const reversedHex: string[] = [];
  const phrases = tokens.map((tok, i) => {
    if (HEX_RE.test(tok)) reversedHex.push(reverseStr(tok.toLowerCase()));
    const isLast = i === tokens.length - 1;
    // Prefix wildcard goes OUTSIDE the phrase quotes per FTS5 syntax.
    return isLast ? `${escapePhrase(tok)}*` : escapePhrase(tok);
  });
  return { match: phrases.join(' '), reversedHex };
}

interface MessageRow {
  mid: string;
  key: string;
  ts: number;
  from_pk: string | null;
  body: string;
  snippet: string;
  score: number;
}

interface ConversationRow {
  kind: 'channel' | 'contact';
  key: string;
  name: string;
  pk_prefix: string;
  score: number;
}

export function searchMessages(opts: SearchOptions): SearchResults {
  const db = openDb();
  const built = buildMatchExpression(opts.query);
  if (!built) {
    return { conversations: [], messages: [], total: { conversations: 0, messages: 0 } };
  }

  const limit = Math.min(opts.limit ?? DEFAULT_LIMIT, HARD_LIMIT);
  const offset = Math.min(Math.max(opts.offset ?? 0, 0), HARD_OFFSET);
  const kinds = opts.kinds ?? ['channel', 'dm'];

  // ---- Conversation hits (run first; feeds the sender-union) -------------
  // Two passes: forward match on name + pk_prefix, then a separate pass on
  // pk_suffix_rev for hex tokens. Results are merged by key with the better
  // (more negative) score winning.
  const convoRows = db
    .prepare(
      `SELECT kind, key, name, pk_prefix, bm25(conversations_fts) AS score
       FROM conversations_fts
       WHERE conversations_fts MATCH ?
       ORDER BY bm25(conversations_fts) ASC
       LIMIT 50`,
    )
    .all(built.match) as unknown as ConversationRow[];

  const convoByKey = new Map<string, ConversationRow>();
  for (const r of convoRows) {
    const prev = convoByKey.get(r.key);
    if (!prev || r.score < prev.score) convoByKey.set(r.key, r);
  }
  if (built.reversedHex.length > 0) {
    // Build a separate MATCH that only consults pk_suffix_rev so the prefix
    // wildcard hits the (already reversed) suffix bytes.
    const revMatch = built.reversedHex
      .map((t) => `pk_suffix_rev: ${escapePhrase(t)}*`)
      .join(' OR ');
    const revRows = db
      .prepare(
        `SELECT kind, key, name, pk_prefix, bm25(conversations_fts) AS score
         FROM conversations_fts
         WHERE conversations_fts MATCH ?
         ORDER BY bm25(conversations_fts) ASC
         LIMIT 50`,
      )
      .all(revMatch) as unknown as ConversationRow[];
    for (const r of revRows) {
      const prev = convoByKey.get(r.key);
      if (!prev || r.score < prev.score) convoByKey.set(r.key, r);
    }
  }

  // Pubkeys of matched *contact* conversations — these become the sender
  // expansion. A search for "Alice" pulls every message where she's the
  // from_pk in addition to bodies containing 'Alice'.
  const senderPks: string[] = [];
  for (const r of convoByKey.values()) {
    if (r.kind === 'contact' && r.key.startsWith('c:')) senderPks.push(r.key.slice(2));
  }

  // ---- Filter clause (shared by body + sender legs of the union) ----------
  // Each leg appends its own ?-bound params in order; we keep a single
  // filterParams array and splice it in twice.
  const filters: string[] = [];
  const filterParams: (string | number)[] = [];
  if (kinds.length < 2) {
    filters.push(`m.kind = ?`);
    filterParams.push(kinds[0]);
  }
  if (opts.key) {
    filters.push(`m.key = ?`);
    filterParams.push(opts.key);
  }
  if (opts.fromPk === 'self') {
    filters.push(`m.from_pk IS NULL`);
  } else if (opts.fromPk) {
    filters.push(`m.from_pk = ?`);
    filterParams.push(opts.fromPk);
  }
  if (opts.tsFrom != null) {
    filters.push(`m.ts >= ?`);
    filterParams.push(opts.tsFrom);
  }
  if (opts.tsTo != null) {
    filters.push(`m.ts <= ?`);
    filterParams.push(opts.tsTo);
  }
  const filterSql = filters.length ? `AND ${filters.join(' AND ')}` : '';

  // ---- Message hits (body UNION sender-from-matched-contacts) -------------
  // The sender leg is omitted when no contact conversations matched, since
  // SQLite rejects `IN ()`. Sender-only rows have no snippet and a neutral
  // score (0), so body-match rows outrank them under relevance sort while
  // recency sort interleaves them by ts.
  //
  // snippet(table, colIdx, start, end, ellipsis, tokens). FTS5 doesn't
  // HTML-escape its output, so we route the marker pair through unique
  // placeholders that the user can't smuggle in as message text, escape the
  // body, then swap the placeholders for real <mark> tags. The renderer
  // dangerouslySetInnerHTMLs the result.
  const SNIPPET_START = '\u{1F539}START\u{1F539}';
  const SNIPPET_END = '\u{1F539}END\u{1F539}';

  const bodyLeg = `
    SELECT m.id AS id, m.mid AS mid, m.key AS key, m.ts AS ts, m.from_pk AS from_pk, m.body AS body,
           snippet(messages_fts, 0, '${SNIPPET_START}', '${SNIPPET_END}', '…', 16) AS snippet,
           bm25(messages_fts) AS score
    FROM messages_fts
    JOIN messages m ON m.id = messages_fts.rowid
    WHERE messages_fts MATCH ? ${filterSql}
  `;

  const senderPlaceholders = senderPks.map(() => '?').join(',');
  const senderLeg =
    senderPks.length > 0
      ? `
    SELECT m.id AS id, m.mid AS mid, m.key AS key, m.ts AS ts, m.from_pk AS from_pk, m.body AS body,
           NULL AS snippet, 0 AS score
    FROM messages m
    WHERE m.from_pk IN (${senderPlaceholders}) ${filterSql}
      AND m.id NOT IN (SELECT rowid FROM messages_fts WHERE messages_fts MATCH ?)
  `
      : '';

  // Order over the union: body matches (negative bm25) sort ahead of sender
  // matches (score=0) under relevance. Recency uses ts then score as tiebreak.
  const orderBy = opts.sort === 'relevance' ? 'score ASC, ts DESC' : 'ts DESC, score ASC';

  const unionSql = senderLeg
    ? `SELECT * FROM (${bodyLeg} UNION ALL ${senderLeg}) ORDER BY ${orderBy} LIMIT ? OFFSET ?`
    : `${bodyLeg} ORDER BY ${orderBy} LIMIT ? OFFSET ?`;

  const unionParams: (string | number)[] = [built.match, ...filterParams];
  if (senderLeg) {
    unionParams.push(...senderPks, ...filterParams, built.match);
  }
  unionParams.push(limit, offset);

  const messageRows = db.prepare(unionSql).all(...unionParams) as unknown as MessageRow[];

  const messageHits: MessageHit[] = messageRows.map((r) => ({
    id: r.mid,
    key: r.key,
    ts: r.ts,
    fromPublicKeyHex: r.from_pk,
    body: r.body,
    snippet: r.snippet
      ? htmlEscape(r.snippet).split(SNIPPET_START).join('<mark>').split(SNIPPET_END).join('</mark>')
      : // Sender-only hit: no FTS snippet. Render a short prefix of the body
        // (HTML-escaped) so the row isn't empty.
        htmlEscape(r.body.length > 120 ? `${r.body.slice(0, 120)}…` : r.body),
    score: r.score,
  }));

  // Annotate hits that match an active block rule so the renderer can drop
  // them. Search hits don't carry path data (FTS5 row only knows from_pk +
  // body), so for channel messages only name / nameRegex rules can ever match
  // — pubkey / pubkeyPrefix rules silently no-op on channel hits because the
  // origin-hop shortId/pubkey isn't recoverable from the index.
  const rules = blockingStore().list();
  if (rules.length > 0) {
    const regexCache = blockingStore().regexCacheRef();
    const contacts = stateHolder().getContacts();
    const contactNameByPk = (pk: string): string | undefined =>
      contacts.find((c) => c.publicKeyHex === pk)?.name;
    for (const h of messageHits) {
      const synthetic = {
        id: h.id,
        key: h.key,
        body: h.body,
        ts: h.ts,
        state: 'received' as const,
        fromPublicKeyHex: h.fromPublicKeyHex ?? undefined,
        meta: undefined,
      };
      const { blocked } = isMessageBlocked(synthetic, { contactNameByPk }, rules, regexCache);
      if (blocked) h.blocked = true;
    }
  }

  // ---- True total (drives Load more) --------------------------------------
  // Same union, COUNT(*). Cheap — FTS5's MATCH count is O(matches), and the
  // sender leg is bounded by from_pk index lookups.
  const countSql = senderLeg
    ? `SELECT COUNT(*) AS n FROM (${bodyLeg} UNION ALL ${senderLeg})`
    : `SELECT COUNT(*) AS n FROM (${bodyLeg})`;
  const countParams: (string | number)[] = [built.match, ...filterParams];
  if (senderLeg) countParams.push(...senderPks, ...filterParams, built.match);
  const { n: totalMessages = 0 } =
    (db.prepare(countSql).get(...countParams) as unknown as { n: number } | undefined) ?? {};

  // ---- Per-key body-match counts (conversation badges) --------------------
  const matchCountRows = db
    .prepare(
      `SELECT m.key AS key, COUNT(*) AS n
       FROM messages_fts
       JOIN messages m ON m.id = messages_fts.rowid
       WHERE messages_fts MATCH ?
       GROUP BY m.key`,
    )
    .all(built.match) as unknown as { key: string; n: number }[];
  const matchCountByKey = new Map<string, number>();
  for (const r of matchCountRows) matchCountByKey.set(r.key, r.n);

  const conversations: ConversationHit[] = [...convoByKey.values()]
    .sort((a, b) => a.score - b.score)
    .map((r) => ({
      key: r.key,
      kind: r.kind,
      name: r.name,
      publicKeyHex: r.kind === 'contact' && r.key.startsWith('c:') ? r.key.slice(2) : undefined,
      score: r.score,
      messageMatches: matchCountByKey.get(r.key) ?? 0,
    }));

  return {
    conversations,
    messages: messageHits,
    total: { conversations: conversations.length, messages: totalMessages },
  };
}

// Wipes and repopulates conversations_fts from the current channel/contact
// set. Cheap: even hundreds of conversations are a single transaction.
export function rebuildConversationsIndex(snapshot: {
  channels: Channel[];
  contacts: Contact[];
}): void {
  const db = openDb();
  db.exec(`DELETE FROM conversations_fts`);
  const ins = db.prepare(
    `INSERT INTO conversations_fts (kind, key, name, pk_prefix, pk_suffix_rev)
     VALUES (?, ?, ?, ?, ?)`,
  );
  db.exec('BEGIN');
  try {
    for (const ch of snapshot.channels) {
      ins.run('channel', ch.key, ch.name, '', '');
    }
    for (const c of snapshot.contacts) {
      const pk = c.publicKeyHex.toLowerCase();
      ins.run('contact', c.key, c.name, pk.slice(0, 16), reverseStr(pk.slice(-16)));
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

// Run periodically (we wire it to before-quit) to compact the FTS index.
export function optimizeFts(): void {
  const db = openDb();
  db.prepare(`INSERT INTO messages_fts(messages_fts) VALUES('optimize')`).run();
}
