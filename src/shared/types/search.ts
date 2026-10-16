// Full-text search requests and results.

import type { ContactKind } from './domain';

export type SearchSort = 'relevance' | 'recency';

export type SearchCategory = 'channel' | 'dm' | 'contact';

export interface SearchOptions {
  query: string;
  sort: SearchSort;
  /** Result categories to include. Omitted/empty → all three. 'channel' and
   *  'dm' gate message rows by m.kind; 'channel' also shows the Channels
   *  conversation section; 'contact' shows the Contacts conversation section. */
  categories?: SearchCategory[];
  /** Restrict to a single conversation key. */
  key?: string;
  /** Hex public key of sender. Self-sent messages have from_pk = NULL, so
   *  use the literal 'self' to filter for those. */
  fromPk?: string;
  tsFrom?: number;
  tsTo?: number;
  /** Default 100. Capped server-side to keep payloads bounded. */
  limit?: number;
  /** Pagination — fetched in lockstep with `limit`. Server clamps to a
   *  reasonable max to keep absurd offsets from scanning the world. */
  offset?: number;
}

export interface MessageHit {
  /** App-level message id (the `mid` column, matches Message.id). */
  id: string;
  key: string;
  ts: number;
  fromPublicKeyHex: string | null;
  body: string;
  /** Snippet with `<mark>…</mark>` around matched terms. Already
   *  HTML-escaped server-side except for the mark tags themselves. */
  snippet: string;
  score: number;
  /** Set by main when the hit matches an active block rule. The renderer
   *  filters annotated hits out of the rendered list. pubkey / pubkeyPrefix
   *  rules can't match channel-message hits in search because path data
   *  isn't persisted — only name / nameRegex apply for those. */
  blocked?: boolean;
}

export interface ConversationHit {
  key: string;
  kind: 'channel' | 'contact';
  name: string;
  /** For contacts: hex public key. For channels: undefined. */
  publicKeyHex?: string;
  /** Contact sub-kind; present only when kind === 'contact'. Drives the
   *  search row's icon + badge and (future) a kind filter. */
  contactKind?: ContactKind;
  score: number;
  /** Count of messages in this conversation matching the same query. */
  messageMatches: number;
}

export interface SearchResults {
  conversations: ConversationHit[];
  /** The current page of message hits. */
  messages: MessageHit[];
  /** `messages` is the FULL match count across all pages — drives Load more.
   *  `conversations` is the visible count (we don't paginate that section). */
  total: { conversations: number; messages: number };
}
