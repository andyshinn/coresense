import type { DatabaseSync, SQLInputValue } from 'node:sqlite';
import { isMessageBlocked } from '../../shared/blocking/match';
import { isContactKey, pubkeyFromKey } from '../../shared/conversationKey';
import { clampFiniteInt } from '../../shared/math';
import type {
  BlockRule,
  Channel,
  Contact,
  ContactKind,
  ConversationHit,
  MessageHit,
  SearchCategory,
  SearchOptions,
  SearchResults,
} from '../../shared/types';
import { all, clampLimit, get, openDb, withTransaction } from './db';

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
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
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
  /** Empty string for channels; the ContactKind value for contacts. */
  contact_kind: string;
  score: number;
}

/** A SQL fragment and the values for its `?` placeholders, in order. Built and
 *  consumed together so the positional binding can't drift from the text. */
interface SqlFragment {
  sql: string;
  params: SQLInputValue[];
}

/** Everything searchMessages needs to flag hits that match an active block
 *  rule: `contacts` resolves from_pk → contact name, `blockRules` + `regexCache`
 *  drive isMessageBlocked. Injected by the caller (the API route builds it from
 *  the state holder) so this stays a pure query module — it never reaches into
 *  the app-state / blocking singletons itself. Pass empty values to skip
 *  annotation (e.g. tests): `{ contacts: [], blockRules: [], regexCache: new Map() }`. */
export interface SearchBlockContext {
  contacts: Contact[];
  blockRules: BlockRule[];
  regexCache: Map<string, RegExp>;
}

const CONVERSATION_SQL = `SELECT kind, key, name, pk_prefix, contact_kind, bm25(conversations_fts) AS score
       FROM conversations_fts
       WHERE conversations_fts MATCH ?
       ORDER BY bm25(conversations_fts) ASC
       LIMIT 50`;

// snippet(table, colIdx, start, end, ellipsis, tokens). FTS5 doesn't
// HTML-escape its output, so we route the marker pair through unique
// placeholders that the user can't smuggle in as message text, escape the
// body, then swap the placeholders for real <mark> tags. The renderer
// dangerouslySetInnerHTMLs the result.
const SNIPPET_START = '\u{1F539}START\u{1F539}';
const SNIPPET_END = '\u{1F539}END\u{1F539}';

/** Conversation hits, keyed by conversation key. Two passes: forward match on
 *  name + pk_prefix, then a separate pass on pk_suffix_rev for hex tokens.
 *  Results are merged by key with the better (more negative) score winning. */
function searchConversations(
  db: DatabaseSync,
  built: NonNullable<ReturnType<typeof buildMatchExpression>>,
): Map<string, ConversationRow> {
  const byKey = new Map<string, ConversationRow>();
  const merge = (match: string) => {
    for (const r of all<ConversationRow>(db.prepare(CONVERSATION_SQL), match)) {
      const prev = byKey.get(r.key);
      if (!prev || r.score < prev.score) byKey.set(r.key, r);
    }
  };
  merge(built.match);
  if (built.reversedHex.length > 0) {
    // Build a separate MATCH that only consults pk_suffix_rev so the prefix
    // wildcard hits the (already reversed) suffix bytes.
    merge(built.reversedHex.map((t) => `pk_suffix_rev: ${escapePhrase(t)}*`).join(' OR '));
  }
  return byKey;
}

/** The filter clause shared by the body and sender legs of the message union,
 *  as `AND …` (or empty). Each leg splices it in, params and all. */
function buildMessageFilter(opts: SearchOptions, msgKinds: SearchCategory[]): SqlFragment {
  const filters: string[] = [];
  const params: SQLInputValue[] = [];
  if (msgKinds.length === 1) {
    filters.push(`m.kind = ?`);
    params.push(msgKinds[0]);
  }
  if (opts.key) {
    filters.push(`m.key = ?`);
    params.push(opts.key);
  }
  if (opts.fromPk === 'self') {
    filters.push(`m.from_pk IS NULL`);
  } else if (opts.fromPk) {
    filters.push(`m.from_pk = ?`);
    params.push(opts.fromPk);
  }
  if (opts.tsFrom != null) {
    filters.push(`m.ts >= ?`);
    params.push(opts.tsFrom);
  }
  if (opts.tsTo != null) {
    filters.push(`m.ts <= ?`);
    params.push(opts.tsTo);
  }
  return { sql: filters.length ? `AND ${filters.join(' AND ')}` : '', params };
}

/** Message hits: body matches UNION messages sent by a matched contact. The
 *  sender leg is omitted when no contact conversations matched, since SQLite
 *  rejects `IN ()`. Sender-only rows have no snippet and a neutral score (0),
 *  so body-match rows outrank them under relevance sort while recency sort
 *  interleaves them by ts. Shared, unchanged, by the page query and the COUNT
 *  that drives Load more. */
function buildMessageUnion(match: string, filter: SqlFragment, senderPks: string[]): SqlFragment {
  const bodyLeg = `
    SELECT m.id AS id, m.mid AS mid, m.key AS key, m.ts AS ts, m.from_pk AS from_pk, m.body AS body,
           snippet(messages_fts, 0, '${SNIPPET_START}', '${SNIPPET_END}', '…', 16) AS snippet,
           bm25(messages_fts) AS score
    FROM messages_fts
    JOIN messages m ON m.id = messages_fts.rowid
    WHERE messages_fts MATCH ? ${filter.sql}
  `;
  if (senderPks.length === 0) return { sql: bodyLeg, params: [match, ...filter.params] };

  const senderLeg = `
    SELECT m.id AS id, m.mid AS mid, m.key AS key, m.ts AS ts, m.from_pk AS from_pk, m.body AS body,
           NULL AS snippet, 0 AS score
    FROM messages m
    WHERE m.from_pk IN (${senderPks.map(() => '?').join(',')}) ${filter.sql}
      AND m.id NOT IN (SELECT rowid FROM messages_fts WHERE messages_fts MATCH ?)
  `;
  return {
    sql: `${bodyLeg} UNION ALL ${senderLeg}`,
    params: [match, ...filter.params, ...senderPks, ...filter.params, match],
  };
}

/** Body-match count per conversation key (the conversation badges). */
function matchCountsByKey(db: DatabaseSync, match: string): Map<string, number> {
  const rows = all<{ key: string; n: number }>(
    db.prepare(
      `SELECT m.key AS key, COUNT(*) AS n
       FROM messages_fts
       JOIN messages m ON m.id = messages_fts.rowid
       WHERE messages_fts MATCH ?
       GROUP BY m.key`,
    ),
    match,
  );
  return new Map(rows.map((r) => [r.key, r.n]));
}

function toMessageHit(r: MessageRow): MessageHit {
  return {
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
  };
}

/** Flag hits that match an active block rule so the renderer can drop them.
 *  Search hits don't carry path data (FTS5 row only knows from_pk + body), so
 *  for channel messages only name / nameRegex rules can ever match — pubkey /
 *  pubkeyPrefix rules silently no-op on channel hits because the origin-hop
 *  shortId/pubkey isn't recoverable from the index. */
function annotateBlocked(hits: MessageHit[], block: SearchBlockContext): void {
  const rules = block.blockRules;
  if (rules.length === 0) return;
  const contactNameByPk = (pk: string): string | undefined => block.contacts.find((c) => c.publicKeyHex === pk)?.name;
  for (const h of hits) {
    const synthetic = {
      id: h.id,
      key: h.key,
      body: h.body,
      ts: h.ts,
      state: 'received' as const,
      fromPublicKeyHex: h.fromPublicKeyHex ?? undefined,
      meta: undefined,
    };
    const { blocked } = isMessageBlocked(synthetic, { contactNameByPk }, rules, block.regexCache);
    if (blocked) h.blocked = true;
  }
}

export function searchMessages(opts: SearchOptions, block: SearchBlockContext): SearchResults {
  const db = openDb();
  const built = buildMatchExpression(opts.query);
  if (!built) {
    return { conversations: [], messages: [], total: { conversations: 0, messages: 0 } };
  }

  // Both arrive from an HTTP body. SQLite reads a negative LIMIT as "no limit",
  // so an unchecked `limit: -1` would return every matching row.
  const limit = clampLimit(opts.limit, DEFAULT_LIMIT, HARD_LIMIT);
  const offset = clampFiniteInt(opts.offset, 0, HARD_OFFSET, 0);
  const categories = opts.categories?.length ? opts.categories : (['channel', 'dm', 'contact'] as SearchCategory[]);
  const showChannels = categories.includes('channel');
  const showContacts = categories.includes('contact');
  // Message rows are gated by the message-kind subset of the selected
  // categories. 'contact' is a conversation-section category, not a message
  // kind, so it never appears here.
  const msgKinds = categories.filter((c) => c === 'channel' || c === 'dm');

  // ---- Conversation hits (run first; feeds the sender-union) -------------
  const convoByKey = searchConversations(db, built);

  // Pubkeys of matched *contact* conversations — these become the sender
  // expansion. A search for "Alice" pulls every message where she's the
  // from_pk in addition to bodies containing 'Alice'.
  //
  // Deliberately collected from the unfiltered matches, BEFORE the showContacts
  // category filter below: sender-expansion is part of the message ('dm') leg,
  // not the Contacts section. So searching "Alice" with the dm category on still
  // surfaces her DMs even when the Contacts section itself is hidden.
  const senderPks: string[] = [];
  for (const r of convoByKey.values()) {
    if (r.kind === 'contact' && isContactKey(r.key)) senderPks.push(pubkeyFromKey(r.key));
  }

  // ---- Message hits + true total (drives Load more) -----------------------
  // No message kinds selected (only 'contact') → skip both message queries.
  // The COUNT is cheap — FTS5's MATCH count is O(matches), and the sender leg
  // is bounded by from_pk index lookups.
  let messageHits: MessageHit[] = [];
  let totalMessages = 0;
  if (msgKinds.length > 0) {
    const union = buildMessageUnion(built.match, buildMessageFilter(opts, msgKinds), senderPks);
    // Order over the union: body matches (negative bm25) sort ahead of sender
    // matches (score=0) under relevance. Recency uses ts then score as tiebreak.
    const orderBy = opts.sort === 'relevance' ? 'score ASC, ts DESC' : 'ts DESC, score ASC';
    const rows = all<MessageRow>(
      db.prepare(`SELECT * FROM (${union.sql}) ORDER BY ${orderBy} LIMIT ? OFFSET ?`),
      ...union.params,
      limit,
      offset,
    );
    messageHits = rows.map(toMessageHit);
    annotateBlocked(messageHits, block);
    totalMessages = get<{ n: number }>(db.prepare(`SELECT COUNT(*) AS n FROM (${union.sql})`), ...union.params)?.n ?? 0;
  }

  // ---- Conversation section ------------------------------------------------
  const matchCountByKey = matchCountsByKey(db, built.match);
  const conversations: ConversationHit[] = [...convoByKey.values()]
    .filter((r) => (r.kind === 'channel' ? showChannels : showContacts))
    .sort((a, b) => a.score - b.score)
    .map((r) => ({
      key: r.key,
      kind: r.kind,
      name: r.name,
      publicKeyHex: r.kind === 'contact' && isContactKey(r.key) ? pubkeyFromKey(r.key) : undefined,
      contactKind: r.kind === 'contact' ? (r.contact_kind as ContactKind) || undefined : undefined,
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
export function rebuildConversationsIndex(snapshot: { channels: Channel[]; contacts: Contact[] }): void {
  const db = openDb();
  const ins = db.prepare(
    `INSERT INTO conversations_fts (kind, key, name, pk_prefix, pk_suffix_rev, contact_kind)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  // The wipe must live inside the transaction: if a later insert throws, the
  // ROLLBACK has to restore the prior index rather than leave it empty (a bare
  // DELETE would auto-commit before BEGIN).
  withTransaction(db, () => {
    db.exec(`DELETE FROM conversations_fts`);
    for (const ch of snapshot.channels) {
      ins.run('channel', ch.key, ch.name, '', '', '');
    }
    for (const c of snapshot.contacts) {
      const pk = c.publicKeyHex.toLowerCase();
      ins.run('contact', c.key, c.name, pk.slice(0, 16), reverseStr(pk.slice(-16)), c.kind);
    }
  });
}

// Run periodically (we wire it to before-quit) to compact the FTS index.
export function optimizeFts(): void {
  const db = openDb();
  db.prepare(`INSERT INTO messages_fts(messages_fts) VALUES('optimize')`).run();
}
