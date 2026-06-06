# Contacts in Search Results — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make chat / repeater / room-server / sensor contacts first-class, visually-distinguished search results by indexing the contact kind and splitting the results into Channels and Contacts sections.

**Architecture:** Add an indexed `contact_kind` column to the derived `conversations_fts` table (dropped and recreated on open — no migration). `searchMessages` returns it on each `ConversationHit`. The renderer partitions hits into Channels and Contacts sections and renders a per-kind icon + badge.

**Tech Stack:** TypeScript, `node:sqlite` FTS5, Hono (main), React (renderer), Vitest (unit + integration), pnpm.

**Spec:** `docs/superpowers/specs/2026-06-03-search-contacts-design.md`

---

## File Structure

| File | Change | Responsibility |
|------|--------|----------------|
| `src/shared/types.ts` | Modify | Add `contactKind?: ContactKind` to `ConversationHit`. |
| `src/main/storage/db.ts` | Modify | Drop+recreate `conversations_fts` with an indexed `contact_kind` column. |
| `src/main/storage/search.ts` | Modify | Write `contact_kind` in `rebuildConversationsIndex`; select + return it in `searchMessages`. |
| `tests/integration/storage/search-contacts.test.ts` | Create | Backend behaviour: kind on hits, kind-keyword match, pubkey prefix/suffix, channel has no kind. |
| `src/renderer/panels/search/partition.ts` | Create | Pure helper splitting `ConversationHit[]` into channels + contacts. |
| `tests/unit/renderer/panels/search/partition.test.ts` | Create | Unit test for the partition helper. |
| `src/renderer/panels/search/ResultsList.tsx` | Modify | Render Channels + Contacts sections via the helper. |
| `src/renderer/panels/search/ConversationRow.tsx` | Modify | Per-kind icon (shared `CONTACT_ICON`) + kind badge. |

Conventions confirmed from the codebase:
- Integration tests run under the `integration` Vitest project with `tests/integration/setup.ts`, which gives **each test a fresh temp userData dir and a fresh DB** (`useTempUserData` → `closeDb()`), so `openDb()` re-runs the schema (including the drop+recreate) per test.
- `conversations_fts` starts empty in a fresh DB; a test must call `rebuildConversationsIndex({ channels, contacts })` to populate it.
- Unit tests run under the `unit` project (node env) and import renderer code via the `@` alias (`@` → `src/renderer`). There is **no** jsdom/testing-library, so JSX is not unit-tested — only pure helpers are.
- Package manager is **pnpm**. Lint is scoped to `src tests` (repo-wide `biome check` trips on build artifacts).

---

## Task 1: Backend — index and return the contact kind

**Files:**
- Modify: `src/shared/types.ts` (the `ConversationHit` interface, ~line 267)
- Modify: `src/main/storage/db.ts:64-71` (the `conversations_fts` definition)
- Modify: `src/main/storage/search.ts` (imports ~line 2-10; `ConversationRow` interface ~line 89-95; both conversation `SELECT`s ~line 127 and ~line 148; the `conversations` map ~line 312-321; `rebuildConversationsIndex` ~line 332-356)
- Test: `tests/integration/storage/search-contacts.test.ts` (create)

- [ ] **Step 1: Add `contactKind` to the shared `ConversationHit` type**

In `src/shared/types.ts`, change the `ConversationHit` interface to add the optional field (so the test and renderer compile). `ContactKind` is already declared in this file.

```ts
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
```

- [ ] **Step 2: Write the failing integration test**

Create `tests/integration/storage/search-contacts.test.ts` with this exact content:

```ts
import { describe, expect, it } from 'vitest';
import { rebuildConversationsIndex, searchMessages } from '../../../src/main/storage/search';
import type { Channel, Contact } from '../../../src/shared/types';

const CTX = { contacts: [], blockRules: [], regexCache: new Map() };

// Build a 64-hex-char pubkey with a controlled prefix and suffix.
const pk = (prefix: string, suffix: string): string =>
  prefix + '0'.repeat(64 - prefix.length - suffix.length) + suffix;

const channel = (over: Partial<Channel> = {}): Channel => ({
  key: 'ch:General',
  name: 'General',
  kind: 'hashtag',
  ...over,
});

const contact = (over: Partial<Contact> = {}): Contact => ({
  key: 'c:default',
  publicKeyHex: pk('a1ce', 'face'),
  name: 'Alice',
  kind: 'chat',
  ...over,
});

const REPEATER = contact({
  key: 'c:repeater',
  publicKeyHex: pk('77aa01', 'ccdd99'),
  name: 'North Ridge',
  kind: 'repeater',
});

describe('search — contacts by kind', () => {
  it('returns the contact kind on a name hit', () => {
    rebuildConversationsIndex({ channels: [], contacts: [REPEATER] });
    const res = searchMessages({ query: 'North', sort: 'relevance' }, CTX);
    const hit = res.conversations.find((c) => c.name === 'North Ridge');
    expect(hit?.kind).toBe('contact');
    expect(hit?.contactKind).toBe('repeater');
  });

  it('carries the kind for all four contact kinds', () => {
    rebuildConversationsIndex({
      channels: [],
      contacts: [
        contact({ key: 'c:chat', name: 'ChatPerson', kind: 'chat', publicKeyHex: pk('c4a7', '0001') }),
        contact({ key: 'c:rep', name: 'RepeaterNode', kind: 'repeater', publicKeyHex: pk('4ce9', '0002') }),
        contact({ key: 'c:room', name: 'RoomServer', kind: 'room', publicKeyHex: pk('40b0', '0003') }),
        contact({ key: 'c:sen', name: 'SensorNode', kind: 'sensor', publicKeyHex: pk('5e50', '0004') }),
      ],
    });
    const kindOf = (name: string) =>
      searchMessages({ query: name, sort: 'relevance' }, CTX).conversations.find(
        (c) => c.name === name,
      )?.contactKind;
    expect(kindOf('ChatPerson')).toBe('chat');
    expect(kindOf('RepeaterNode')).toBe('repeater');
    expect(kindOf('RoomServer')).toBe('room');
    expect(kindOf('SensorNode')).toBe('sensor');
  });

  it('surfaces all contacts of a kind when the kind keyword is searched', () => {
    rebuildConversationsIndex({
      channels: [],
      contacts: [
        contact({ key: 'c:r1', name: 'North Ridge', kind: 'repeater', publicKeyHex: pk('77aa', '0011') }),
        contact({ key: 'c:r2', name: 'South Peak', kind: 'repeater', publicKeyHex: pk('88bb', '0022') }),
        contact({ key: 'c:chat', name: 'Alice', kind: 'chat', publicKeyHex: pk('a1ce', '0033') }),
      ],
    });
    const names = searchMessages({ query: 'repeater', sort: 'relevance' }, CTX).conversations.map(
      (c) => c.name,
    );
    expect(names).toContain('North Ridge');
    expect(names).toContain('South Peak');
    expect(names).not.toContain('Alice');
  });

  it('still matches a contact by pubkey prefix and suffix, with kind attached', () => {
    rebuildConversationsIndex({ channels: [], contacts: [REPEATER] });
    const byPrefix = searchMessages({ query: '77aa01', sort: 'relevance' }, CTX).conversations.find(
      (c) => c.name === 'North Ridge',
    );
    expect(byPrefix?.contactKind).toBe('repeater');
    const bySuffix = searchMessages({ query: 'ccdd99', sort: 'relevance' }, CTX).conversations.find(
      (c) => c.name === 'North Ridge',
    );
    expect(bySuffix?.contactKind).toBe('repeater');
  });

  it('returns channels with no contactKind', () => {
    rebuildConversationsIndex({ channels: [channel()], contacts: [] });
    const hit = searchMessages({ query: 'General', sort: 'relevance' }, CTX).conversations.find(
      (c) => c.name === 'General',
    );
    expect(hit?.kind).toBe('channel');
    expect(hit?.contactKind).toBeUndefined();
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

```bash
pnpm exec vitest run tests/integration/storage/search-contacts.test.ts
```
Expected: FAIL — the `contactKind` assertions report `undefined` (the column/select/map aren't wired yet). The pubkey/channel structural assertions may pass; the suite is RED overall.

- [ ] **Step 4: Add the indexed `contact_kind` column to the schema**

In `src/main/storage/db.ts`, replace the `conversations_fts` block (lines 58-71) with a drop+recreate that adds the column. Note the leading comment update and that it is **no longer** `IF NOT EXISTS`:

```sql
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
```

- [ ] **Step 5: Write `contact_kind` in `rebuildConversationsIndex`**

In `src/main/storage/search.ts`, update the INSERT and both `.run` calls in `rebuildConversationsIndex`:

```ts
  const ins = db.prepare(
    `INSERT INTO conversations_fts (kind, key, name, pk_prefix, pk_suffix_rev, contact_kind)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  db.exec('BEGIN');
  try {
    for (const ch of snapshot.channels) {
      ins.run('channel', ch.key, ch.name, '', '', '');
    }
    for (const c of snapshot.contacts) {
      const pk = c.publicKeyHex.toLowerCase();
      ins.run('contact', c.key, c.name, pk.slice(0, 16), reverseStr(pk.slice(-16)), c.kind);
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
```

- [ ] **Step 6: Select and return `contact_kind` in `searchMessages`**

In `src/main/storage/search.ts`:

(a) Add `ContactKind` to the type import (lines 2-10):

```ts
import type {
  BlockRule,
  Channel,
  Contact,
  ContactKind,
  ConversationHit,
  MessageHit,
  SearchOptions,
  SearchResults,
} from '../../shared/types';
```

(b) Add `contact_kind` to the `ConversationRow` SQL row interface (~line 89):

```ts
interface ConversationRow {
  kind: 'channel' | 'contact';
  key: string;
  name: string;
  pk_prefix: string;
  contact_kind: string;
  score: number;
}
```

(c) Add `contact_kind` to **both** conversation `SELECT`s — the forward pass (~line 127) and the reversed-hex pass (~line 148). Each becomes:

```sql
SELECT kind, key, name, pk_prefix, contact_kind, bm25(conversations_fts) AS score
```

(d) Map it onto the hit in the `conversations` builder (~line 312):

```ts
  const conversations: ConversationHit[] = [...convoByKey.values()]
    .sort((a, b) => a.score - b.score)
    .map((r) => ({
      key: r.key,
      kind: r.kind,
      name: r.name,
      publicKeyHex: r.kind === 'contact' && r.key.startsWith('c:') ? r.key.slice(2) : undefined,
      contactKind: r.kind === 'contact' ? ((r.contact_kind as ContactKind) || undefined) : undefined,
      score: r.score,
      messageMatches: matchCountByKey.get(r.key) ?? 0,
    }));
```

- [ ] **Step 7: Run the test to verify it passes**

```bash
pnpm exec vitest run tests/integration/storage/search-contacts.test.ts
```
Expected: PASS (5 tests).

- [ ] **Step 8: Typecheck**

```bash
pnpm typecheck
```
Expected: no errors.

- [ ] **Step 9: Commit**

```bash
git add src/shared/types.ts src/main/storage/db.ts src/main/storage/search.ts tests/integration/storage/search-contacts.test.ts
git commit -m "feat(search): index contact_kind and return it on conversation hits

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Renderer — pure partition helper

**Files:**
- Create: `src/renderer/panels/search/partition.ts`
- Test: `tests/unit/renderer/panels/search/partition.test.ts`

- [ ] **Step 1: Write the failing unit test**

Create `tests/unit/renderer/panels/search/partition.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { partitionConversations } from '@/panels/search/partition';
import type { ConversationHit } from '../../../../../src/shared/types';

const hit = (over: Partial<ConversationHit>): ConversationHit => ({
  key: 'x',
  kind: 'contact',
  name: 'n',
  score: 0,
  messageMatches: 0,
  ...over,
});

describe('partitionConversations', () => {
  it('splits channels and contacts, preserving order within each bucket', () => {
    const input = [
      hit({ key: 'ch:1', kind: 'channel', name: 'general' }),
      hit({ key: 'c:1', kind: 'contact', name: 'alice', contactKind: 'chat' }),
      hit({ key: 'ch:2', kind: 'channel', name: 'public' }),
      hit({ key: 'c:2', kind: 'contact', name: 'rptr', contactKind: 'repeater' }),
    ];
    const { channels, contacts } = partitionConversations(input);
    expect(channels.map((c) => c.key)).toEqual(['ch:1', 'ch:2']);
    expect(contacts.map((c) => c.key)).toEqual(['c:1', 'c:2']);
  });

  it('returns empty buckets for empty input', () => {
    const { channels, contacts } = partitionConversations([]);
    expect(channels).toEqual([]);
    expect(contacts).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm exec vitest run tests/unit/renderer/panels/search/partition.test.ts
```
Expected: FAIL — cannot resolve `@/panels/search/partition` (module doesn't exist yet).

- [ ] **Step 3: Create the partition helper**

Create `src/renderer/panels/search/partition.ts`:

```ts
import type { ConversationHit } from '../../../shared/types';

/** Split combined conversation hits into channel and contact buckets,
 *  preserving the server's (relevance-sorted) order within each bucket. */
export function partitionConversations(conversations: ConversationHit[]): {
  channels: ConversationHit[];
  contacts: ConversationHit[];
} {
  const channels: ConversationHit[] = [];
  const contacts: ConversationHit[] = [];
  for (const hit of conversations) {
    if (hit.kind === 'channel') channels.push(hit);
    else contacts.push(hit);
  }
  return { channels, contacts };
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
pnpm exec vitest run tests/unit/renderer/panels/search/partition.test.ts
```
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/panels/search/partition.ts tests/unit/renderer/panels/search/partition.test.ts
git commit -m "feat(search): add partitionConversations helper

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Renderer — Channels/Contacts sections + per-kind icon and badge

**Files:**
- Modify: `src/renderer/panels/search/ResultsList.tsx` (the conversations Section, lines 65-79)
- Modify: `src/renderer/panels/search/ConversationRow.tsx` (whole file)

This task has no automated test (no component-test infra); it is verified by typecheck, lint, and a manual run.

- [ ] **Step 1: Render Channels and Contacts sections in `ResultsList.tsx`**

Add the import near the other local imports (after the `ConversationRow` import, line 4):

```tsx
import { partitionConversations } from './partition';
```

Inside the component body, just after `const visibleMessages = messages.filter((m) => m.blocked !== true);` (line 54), add:

```tsx
  const { channels, contacts } = partitionConversations(conversations);
```

Replace the single conversations `Section` block (lines 67-79, the `{conversations.length > 0 && (...)}` block) with two sections:

```tsx
          {channels.length > 0 && (
            <Section title={`Channels (${channels.length})`}>
              <ul className="divide-y divide-cs-border">
                {channels.map((hit) => (
                  <ConversationRow key={hit.key} hit={hit} onClick={() => onConversationClick(hit)} />
                ))}
              </ul>
            </Section>
          )}
          {contacts.length > 0 && (
            <Section title={`Contacts (${contacts.length})`}>
              <ul className="divide-y divide-cs-border">
                {contacts.map((hit) => (
                  <ConversationRow key={hit.key} hit={hit} onClick={() => onConversationClick(hit)} />
                ))}
              </ul>
            </Section>
          )}
```

(Leave the `Messages` section and everything else unchanged.)

- [ ] **Step 2: Use the shared per-kind icon and add a kind badge in `ConversationRow.tsx`**

Replace the entire contents of `src/renderer/panels/search/ConversationRow.tsx` with:

```tsx
import { Hash } from 'lucide-react';
import type { ConversationHit } from '../../../shared/types';
import { CONTACT_ICON } from '../../lib/conversationIcons';

function shortPk(pk: string): string {
  if (pk.length <= 12) return pk;
  return `${pk.slice(0, 6)}…${pk.slice(-4)}`;
}

export function ConversationRow({ hit, onClick }: { hit: ConversationHit; onClick: () => void }) {
  // Channels use the hash glyph; contacts use the shared per-kind icon
  // (chat → MessageCircle, repeater → Radio, room → DoorOpen, sensor → Activity).
  const Icon = hit.kind === 'channel' ? Hash : CONTACT_ICON[hit.contactKind ?? 'chat'];
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-cs-text transition-colors hover:bg-cs-bg-2"
      >
        <Icon size={14} className="text-cs-text-muted" aria-hidden="true" />
        <span className="truncate">{hit.name}</span>
        {hit.contactKind && (
          <span className="rounded border border-cs-border px-1 text-[10px] text-cs-text-dim">
            {hit.contactKind}
          </span>
        )}
        {hit.publicKeyHex && (
          <span className="font-mono text-[10px] text-cs-text-dim">{shortPk(hit.publicKeyHex)}</span>
        )}
        {hit.messageMatches > 0 && (
          <span className="ml-auto font-mono text-[10px] text-cs-text-dim">
            {hit.messageMatches} match{hit.messageMatches === 1 ? '' : 'es'}
          </span>
        )}
      </button>
    </li>
  );
}
```

- [ ] **Step 3: Typecheck and lint**

```bash
pnpm typecheck
pnpm lint src tests
```
Expected: no errors. (Lint is scoped to `src tests` because repo-wide `biome check` trips on build artifacts.)

- [ ] **Step 4: Manual verification**

```bash
pnpm start
```
In the running app: open the search panel (Cmd/Ctrl+F), type a repeater contact's name. Confirm:
- A **Contacts** section appears, separate from **Channels**.
- The repeater row shows the Radio icon and a `repeater` badge.
- Typing `repeater` lists all repeater contacts.
- Clicking a repeater row opens the Repeater admin panel; clicking a chat/room row opens the DM view.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/panels/search/ResultsList.tsx src/renderer/panels/search/ConversationRow.tsx
git commit -m "feat(search): split results into Channels and Contacts with per-kind icon + badge

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Final verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite**

```bash
pnpm test
```
Expected: all unit + integration tests pass, including the new `search-contacts` and `partition` suites.

- [ ] **Step 2: Typecheck and lint the whole change**

```bash
pnpm typecheck
pnpm lint src tests
```
Expected: no errors.

- [ ] **Step 3: Confirm the working tree is clean for this feature**

```bash
git status
```
Expected: no uncommitted files from Tasks 1-3 (pre-existing unrelated changes from before this feature may remain and should be left alone).

---

## Spec Coverage Check

- Layout: split Channels + Contacts, flat contacts with icon + badge → Task 3.
- No filter UI → nothing built; kind indexed for a future filter → Task 1.
- Match scope name + key + kind (kind keyword searchable) → Task 1 (schema indexed column + kind-keyword test).
- `ConversationHit.contactKind` → Task 1, Step 1.
- Drop+recreate `conversations_fts`, messages untouched → Task 1, Step 4.
- Navigation unchanged → no work (verified manually in Task 3, Step 4).
- Tests: storage kind/keyword/pubkey/channel → Task 1; renderer partition → Task 2.
- Badge wording raw lowercase `ContactKind` → Task 3, Step 2.
