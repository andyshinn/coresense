# Search: Contacts in Results — Design

- **Date:** 2026-06-03
- **Status:** Approved (ready for implementation plan)
- **Area:** full-text search (`src/main/storage`, `src/renderer/panels/search`)

## Summary

Surface contacts of all four kinds — **chat, repeater, room server, sensor** —
as first-class search results, visually distinguished by kind.

Contacts are *already indexed*: `rebuildConversationsIndex` writes every contact
(regardless of kind) into `conversations_fts`, and `searchMessages` already
returns them as `ConversationHit { kind: 'contact' }`. Navigation already routes
correctly — clicking a `c:<pubkey>` hit opens `RepeaterAdmin` (repeater/sensor)
or `DMView` (chat/room) via `MainPane`.

The gap is **presentation and metadata**, not indexing:

1. `ConversationHit` carries no contact *kind*, so every contact renders with a
   generic icon and is lumped into one undifferentiated "Conversations" section
   alongside channels.
2. The contact kind is not searchable (typing "repeater" finds nothing) and
   nothing in the index supports a future kind filter.

## Decisions (from brainstorming)

- **Layout:** split conversation hits into two sections — **Channels** and a
  flat **Contacts** section. Each contact row shows a per-kind icon and a small
  type badge. No sub-grouping by kind. Section order: Channels → Contacts →
  Messages. Each section renders only when it has hits.
- **Filtering:** none for now (badges only). But index the kind so a filter
  chip/dropdown is a trivial future add.
- **Match scope:** name + public key + **kind** (kind indexed). Typing a kind
  keyword (e.g. "repeater") surfaces all contacts of that kind, in addition to
  name/pubkey matches.
- **Navigation:** unchanged — already kind-aware in `MainPane`.
- **Migration:** none. `conversations_fts` is derived (rebuilt from the holder
  snapshot on every mutation), so it is dropped and recreated on open. No
  version detection, no `ALTER`. Message history (`messages` / `messages_fts`)
  is untouched.
- **Badge wording:** singular lowercase straight from `ContactKind`
  (`chat` / `repeater` / `room` / `sensor`). The icon comes from the existing
  `conversationIcons` map.

## Detailed Design

### 1. Schema — `src/main/storage/db.ts`

Add an **indexed** `contact_kind` column to `conversations_fts`:

```sql
DROP TABLE IF EXISTS conversations_fts;
CREATE VIRTUAL TABLE conversations_fts USING fts5(
  kind          UNINDEXED,   -- 'channel' | 'contact'
  key           UNINDEXED,   -- 'ch:<name>' | 'c:<pubkey>'
  name,
  pk_prefix,
  pk_suffix_rev,
  contact_kind,              -- indexed: 'chat'|'repeater'|'room'|'sensor', '' for channels
  tokenize = 'unicode61 remove_diacritics 2'
);
```

`contact_kind` is **indexed** (not `UNINDEXED`) so it participates in the
all-column `MATCH` — that is what makes kind keywords searchable. It is also
returned in `SELECT` to populate the hit and (later) drive a structured filter
via column-scoped match (`contact_kind:repeater`).

Because FTS5 virtual tables cannot be `ALTER`ed and existing installs already
have the 5-column table, the table is **dropped and recreated** on open rather
than created `IF NOT EXISTS`. This is safe: the table holds only derived data
and is repopulated by `rebuildConversationsIndex` (called from the `StateHolder`
constructor and on every channel/contact mutation).

### 2. Index population — `rebuildConversationsIndex` (`src/main/storage/search.ts`)

Extend the `INSERT` to include `contact_kind`:

- channels → `''`
- contacts → `c.kind`

```ts
const ins = db.prepare(
  `INSERT INTO conversations_fts (kind, key, name, pk_prefix, pk_suffix_rev, contact_kind)
   VALUES (?, ?, ?, ?, ?, ?)`,
);
// channel:  ins.run('channel', ch.key, ch.name, '', '', '');
// contact:  ins.run('contact', c.key, c.name, pk.slice(0,16), reverseStr(pk.slice(-16)), c.kind);
```

### 3. Query — `searchMessages` (`src/main/storage/search.ts`)

- Add `contact_kind` to both conversation `SELECT`s (the forward `name`/`pk_prefix`
  pass and the reversed-hex `pk_suffix_rev` pass).
- Add `contact_kind` to the **`ConversationRow` SQL row interface in `search.ts`**
  (distinct from the renderer component of the same name in §5).
- Map it onto the hit: `contactKind: r.kind === 'contact' ? (r.contact_kind || undefined) : undefined`.

No change to `buildMatchExpression` — the existing all-column `MATCH` already
covers the new indexed column, so kind-keyword matching works for free. The
last-token prefix wildcard means "rep" also matches "repeater".

### 4. Shared types — `src/shared/types.ts`

```ts
export interface ConversationHit {
  key: string;
  kind: 'channel' | 'contact';
  name: string;
  publicKeyHex?: string;
  /** Contact sub-kind; present only when kind === 'contact'. Drives the
   *  search row's icon + badge and (future) a kind filter. */
  contactKind?: ContactKind;
  score: number;
  messageMatches: number;
}
```

### 5. Renderer — `src/renderer/panels/search/`

**`ResultsList.tsx`**
- Partition `conversations` into `channels` (`kind === 'channel'`) and `contacts`
  (`kind === 'contact'`).
- Render up to three sections in order: **Channels (n)**, **Contacts (n)**,
  **Messages (n of m)**. Each conversation section renders only when non-empty.
- `hasResults` stays `conversations.length > 0 || messages.length > 0`.

**`ConversationRow.tsx`**
- Pick the icon from the shared `conversationIcons` map by `contactKind`
  (chat→MessageCircle, repeater→Radio, room→DoorOpen, sensor→Activity);
  channels keep `Hash`.
- Render a small type badge from `contactKind` (raw kind text) for contact rows.
  No badge for channels.

```
Channels (2)
  #  general
  #  public
Contacts (5)
  @  Alice         chat       a1b2…9f
  )) North Ridge   repeater   77aa…01
  [] Town Hall     room       88bb…02
  ~  Weather-1     sensor     99cc…03
Messages (12 of 40)
  …
```

## Edge Cases

- **Channels:** `contactKind` undefined → `Hash` icon, no badge, Channels section.
- **Non-chat contact with no DM history** (repeater/sensor/room): still appears
  when name/pubkey/kind matches; `messageMatches` is 0. The "N matches" tail
  already only renders when `> 0`, so nothing extra is shown.
- **Drop+recreate on open:** only `conversations_fts` is recreated; the heavy
  external-content `messages_fts` and the `messages` table are untouched.
- **Kind keyword breadth:** "repeater" returns every repeater contact, all at
  equal bm25 score on that column. Acceptable; users wanting to browse a whole
  kind have the LeftNav groups.

## Testing

**Storage (integration — extend `tests/integration/storage/`):**
- Searching a repeater's name returns a `ConversationHit` with
  `contactKind === 'repeater'`.
- Searching a kind keyword ("repeater") returns all repeater contacts.
- Searching a pubkey prefix and suffix still returns the contact.
- Channel hits return with `contactKind === undefined`.
- `rebuildConversationsIndex` populates `contact_kind` for all four kinds.

**Renderer:**
- `ResultsList` partitions hits into Channels / Contacts sections correctly and
  hides empty sections.
- `ConversationRow` renders the correct icon and badge per `contactKind`, and no
  badge for channels.

## Out of Scope / Future

- A kind **filter** UI (chip row or dropdown). The index now supports it via
  `contact_kind:<kind>` column-scoped match; only UI + a `SearchOptions` field
  would be needed.
- **Synonym** matching (e.g. "server" → room servers). Could add a dedicated
  indexed synonym column later (approach C) without disturbing this design.

## Approaches Considered

- **A — index `contact_kind` (chosen).** Satisfies "index the type": keyword
  matching now, structured filter later, one small derived-table change.
- **B — attach kind in JS** from `block.contacts` after the query. No schema
  change, but kind is not matchable and a future filter needs rework. Rejected.
- **C — unindexed display column + indexed synonym column.** Most flexible
  (matches "room server"), most moving parts. Deferred.
