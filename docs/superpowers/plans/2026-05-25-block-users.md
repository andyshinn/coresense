# Block Users Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add client-side message blocking with four rule types (pubkey, pubkey prefix, exact name, name regex), a right-click "Block sender…" dialog with optional retro-hide window, and a Settings → Blocked tab for managing rules.

**Architecture:** Rules persist in a new JSON slice (`userData/block-rules.json`). A pure `isMessageBlocked` predicate evaluates rules at three gates in the main process: notification dispatch, dock-badge unread counter, and message-fetch paths (the holder annotates `meta.blocked` on rows). Renderer filters rows where `meta.blocked === true` from MessageList / Search / Unreads. Blocked messages are fully invisible — only `rule.matchCount` in Settings signals activity. Reversible (delete/disable a rule → matching messages reappear on the next push).

**Tech Stack:** TypeScript, Electron main + Vite renderer, Hono HTTP + ws push, Zustand store, shadcn/ui (Dialog/Checkbox/Input/Select/Button). No test framework — verification is `pnpm typecheck` and `pnpm lint`. Manual smoke test in the running app at the end.

## Verification convention

The project has no automated tests. Every task that touches source ends with running both verifiers from the repo root:

```bash
pnpm typecheck && pnpm lint
```

Expected: both pass clean. Treat any type error, biome error, or biome formatting issue as a task failure.

When biome auto-fixes formatting on files outside the task's scope, accept those edits (see `feedback_biome_format_any_file.md` in user memory).

## File structure

**New files:**
- `src/shared/blocking/match.ts` — pure `isMessageBlocked` + `BlockMatchHints` + `extractSenderNameFromBody`. No Electron, no DOM imports.
- `src/main/blocking/store.ts` — in-memory rule list, regex cache, debounced counter flush. Wraps `settingsStore` for persistence.
- `src/renderer/components/BlockSenderDialog.tsx` — shared dialog used by both right-click and Settings "Add rule".
- `src/renderer/panels/settings/blocked/BlockedSection.tsx` — Blocked-tab content (rule table + Add button + filter input).
- `src/renderer/panels/settings/blocked/index.ts` — re-export barrel.

**Modified files:**
- `src/shared/types.ts` — add `BlockRule`, `BlockRuleType`, `MessageMeta.blocked`, `MessageMeta.blockedByRuleId`, `StateSnapshot.blockRules`, ws variant.
- `src/main/storage/settings.ts` — add `loadBlockRules` / `saveBlockRules` for `block-rules.json`.
- `src/main/state/holder.ts` — wire block-rules slice through the holder, annotate `meta.blocked` on insert + on read, bump counters on first match.
- `src/main/events/bus.ts` — `emit.blockRules` + BusEvents entry.
- `src/main/server.ts` — broadcast `blockRules` over ws on bus event.
- `src/main/api/routes.ts` — add `POST/PUT/DELETE /api/blocks/*` routes; include `blockRules` in `StateSnapshot`.
- `src/main/notifications.ts` — gate `maybeNotify` and `recomputeBadge` on `isMessageBlocked`.
- `src/main/storage/messages.ts` — `byKey` consumer remains unchanged; blocked annotation is applied at the holder level.
- `src/renderer/lib/api.ts` — add `addBlockRules` / `updateBlockRule` / `removeBlockRule`.
- `src/renderer/lib/store.ts` — add `blockRules` slice + `applyBlockRules` + `SettingsTab` union extension.
- `src/renderer/app/wsHandlers.ts` — dispatch `blockRules` event into the store.
- `src/renderer/components/MessageList.tsx` — filter `meta.blocked === true` rows out of the rendered list; wire the block menu via right-click.
- `src/renderer/components/MessageRow.tsx` — no change needed (`onContextMenu` already plumbed).
- `src/renderer/panels/Unreads.tsx` — exclude `meta.blocked` from preview counts and rows.
- `src/renderer/panels/search/MessageRow.tsx` and search results list — exclude blocked rows.
- `src/renderer/panels/settings/SettingsPanel.tsx` — register the `blocked` tab and its section.
- `src/renderer/panels/settings/PillTabs.tsx` — add the Blocked pill button if the tab list is enumerated there (check at task time).

---

### Task 1: Shared types

**Files:**
- Modify: `src/shared/types.ts`

- [ ] **Step 1: Add the BlockRule types and MessageMeta flags**

Open [src/shared/types.ts](src/shared/types.ts). After the `Message` interface (around line 187), add:

```ts
export type BlockRuleType = 'pubkey' | 'pubkeyPrefix' | 'name' | 'nameRegex';

export interface BlockRule {
  id: string;
  type: BlockRuleType;
  /** Storage form depends on type:
   *   pubkey / pubkeyPrefix — lowercase hex, no separators
   *   name                  — case-sensitive exact match
   *   nameRegex             — JS regex source string. Matcher applies the 'i' flag. */
  pattern: string;
  createdAt: number;
  /** Matches messages where msg.ts >= tsFrom. Encodes the retro-hide window. */
  tsFrom: number;
  enabled: boolean;
  note?: string;
  /** Bumped once per message on first match (new arrival or rule-creation backfill).
   *  Persisted on a debounce — see main/blocking/store.ts. */
  matchCount: number;
}
```

Extend `MessageMeta` (around line 166) with the blocked annotation. Add these fields beside the existing ones:

```ts
  /** Set by main when the message matches an active block rule. The
   *  renderer hides annotated rows from MessageList, Unreads, and Search. */
  blocked?: boolean;
  /** The id of the first rule (by createdAt asc) that matched this message
   *  at first-match time. Used to attribute matchCount; not used for hiding. */
  blockedByRuleId?: string;
```

Extend `StateSnapshot` (around line 701) so the renderer hydrates on connect:

```ts
  blockRules: BlockRule[];
```

Extend `WsMessage` (around line 873) with one new variant:

```ts
  | { type: 'blockRules'; payload: BlockRule[] }
```

- [ ] **Step 2: Verify**

```bash
pnpm typecheck && pnpm lint
```

Expected: PASS. (Other modules referencing `StateSnapshot` will fail later — fix as each task lands; this is fine for the type-only step.)

If typecheck flags a missing `blockRules` field somewhere that builds a `StateSnapshot`, mark the failure with `TODO(block-users)` so the next tasks can pick it up. Do not invent values.

---

### Task 2: Persistence layer

**Files:**
- Modify: `src/main/storage/settings.ts`

- [ ] **Step 1: Add the file + loader/saver**

Open [src/main/storage/settings.ts](src/main/storage/settings.ts).

Add `BlockRule` to the type imports at the top:

```ts
import {
  type AppSettings,
  type AutoAddConfig,
  type BlockRule,
  // …existing imports unchanged…
} from '../../shared/types';
```

Add the file key inside `FILES` (around line 34):

```ts
const FILES = {
  // …existing keys…
  deviceInfo: 'device-info.json',
  blockRules: 'block-rules.json',
} as const;
```

Append two methods inside `settingsStore` (just before the closing `}` around line 166):

```ts
  loadBlockRules: (): BlockRule[] => readJson(FILES.blockRules, [] as BlockRule[]),
  saveBlockRules: (v: BlockRule[]): void => writeJson(FILES.blockRules, v),
```

- [ ] **Step 2: Verify**

```bash
pnpm typecheck && pnpm lint
```

Expected: PASS.

---

### Task 3: Pure match logic

**Files:**
- Create: `src/shared/blocking/match.ts`

- [ ] **Step 1: Write the module**

Create [src/shared/blocking/match.ts](src/shared/blocking/match.ts):

```ts
import type { BlockRule, Message } from '../types';

/** Resolved sender info that the bare Message struct doesn't carry. The caller
 *  is responsible for resolving these from the live state holder (contacts,
 *  paths). All fields are optional — missing info just means the relevant
 *  rule type can't match. */
export interface BlockMatchHints {
  /** For channel messages: the sender's display name parsed from the
   *  "name: body" prefix. Undefined when the body has no name prefix. */
  senderNameFromBody?: string;
  /** Resolver for DM-style messages: pubkey -> display name. */
  contactNameByPk?: (pk: string) => string | undefined;
  /** Channel-message origin hop short id (lowercase hex). */
  originHopShortId?: string;
  /** Channel-message origin hop resolved full pubkey (lowercase hex), when
   *  an advert was matched. Undefined otherwise. */
  originHopPk?: string;
}

/** Channel message bodies look like `"Alice: hello"`. Returns the name half,
 *  or undefined when the body has no `name:` prefix. The split is on the
 *  first occurrence of ": " (colon + space). */
export function extractSenderNameFromBody(body: string): string | undefined {
  const i = body.indexOf(': ');
  if (i <= 0) return undefined;
  return body.slice(0, i);
}

/** True iff the message is from us (no sender pubkey). Self-sent messages
 *  must never match a block rule. */
function isSelfSent(msg: Message): boolean {
  return msg.fromPublicKeyHex == null;
}

/** Returns true if the message is a channel message. Channel keys begin with
 *  `ch:`; DM/contact keys begin with `c:`. */
function isChannelMessage(msg: Message): boolean {
  return msg.key.startsWith('ch:');
}

/** Per-rule predicate. Pure — no holder access, no I/O, no logging. */
function ruleMatches(
  msg: Message,
  hints: BlockMatchHints,
  rule: BlockRule,
  regex: RegExp | undefined,
): boolean {
  if (!rule.enabled) return false;
  if (msg.ts < rule.tsFrom) return false;

  switch (rule.type) {
    case 'pubkey': {
      if (isChannelMessage(msg)) {
        return hints.originHopPk != null && hints.originHopPk === rule.pattern;
      }
      return msg.fromPublicKeyHex != null && msg.fromPublicKeyHex === rule.pattern;
    }
    case 'pubkeyPrefix': {
      if (isChannelMessage(msg)) {
        return hints.originHopShortId != null && hints.originHopShortId.startsWith(rule.pattern);
      }
      return msg.fromPublicKeyHex != null && msg.fromPublicKeyHex.startsWith(rule.pattern);
    }
    case 'name': {
      const name = isChannelMessage(msg)
        ? hints.senderNameFromBody
        : msg.fromPublicKeyHex != null
          ? hints.contactNameByPk?.(msg.fromPublicKeyHex)
          : undefined;
      return name != null && name === rule.pattern;
    }
    case 'nameRegex': {
      if (regex == null) return false;
      const name = isChannelMessage(msg)
        ? hints.senderNameFromBody
        : msg.fromPublicKeyHex != null
          ? hints.contactNameByPk?.(msg.fromPublicKeyHex)
          : undefined;
      return regex.test(name ?? '');
    }
  }
}

export interface BlockMatchResult {
  blocked: boolean;
  ruleId?: string;
}

/** Walks `rules` in iteration order (callers pass them sorted by `createdAt
 *  asc`) and returns the first hit. Self-sent messages never match. */
export function isMessageBlocked(
  msg: Message,
  hints: BlockMatchHints,
  rules: BlockRule[],
  regexCache: Map<string, RegExp>,
): BlockMatchResult {
  if (isSelfSent(msg)) return { blocked: false };
  for (const rule of rules) {
    const regex = rule.type === 'nameRegex' ? regexCache.get(rule.id) : undefined;
    if (ruleMatches(msg, hints, rule, regex)) {
      return { blocked: true, ruleId: rule.id };
    }
  }
  return { blocked: false };
}

/** Compile a regex source into a case-insensitive RegExp. Returns null on
 *  invalid source so callers can mark the rule invalid without throwing. */
export function compileRuleRegex(source: string): RegExp | null {
  try {
    return new RegExp(source, 'i');
  } catch {
    return null;
  }
}
```

- [ ] **Step 2: Verify**

```bash
pnpm typecheck && pnpm lint
```

Expected: PASS.

---

### Task 4: Main-side blocking store

**Files:**
- Create: `src/main/blocking/store.ts`

This module owns the in-memory rule list, the compiled regex cache, and the debounced counter writer. It does NOT call the bus directly — the holder (Task 5) wraps it and decides when to emit.

- [ ] **Step 1: Write the module**

Create [src/main/blocking/store.ts](src/main/blocking/store.ts):

```ts
import { randomUUID } from 'node:crypto';
import type { BlockRule } from '../../shared/types';
import { compileRuleRegex } from '../../shared/blocking/match';
import { child } from '../log';
import { settingsStore } from '../storage/settings';

const log = child('blocking');

/** ms between counter flushes to disk. Counters live in memory; this is just
 *  the persistence cadence. */
const COUNTER_FLUSH_DEBOUNCE_MS = 30_000;

class BlockingStore {
  private rules: BlockRule[] = [];
  private regexCache = new Map<string, RegExp>();
  /** Rule ids whose regex source failed to compile. The matcher treats them
   *  as disabled; the UI surfaces them as "invalid". */
  private invalidRegexIds = new Set<string>();
  private counterDirty = false;
  private flushTimer: NodeJS.Timeout | null = null;

  load(): void {
    this.rules = settingsStore.loadBlockRules();
    this.sortByCreatedAt();
    this.rebuildRegexCache();
  }

  private sortByCreatedAt(): void {
    this.rules.sort((a, b) => a.createdAt - b.createdAt);
  }

  private rebuildRegexCache(): void {
    this.regexCache.clear();
    this.invalidRegexIds.clear();
    for (const r of this.rules) {
      if (r.type !== 'nameRegex') continue;
      const compiled = compileRuleRegex(r.pattern);
      if (compiled) {
        this.regexCache.set(r.id, compiled);
      } else {
        this.invalidRegexIds.add(r.id);
        log.warn(`block rule ${r.id} has invalid regex source; treating as disabled`);
      }
    }
  }

  /** Snapshot the rule list. Returned array is a shallow copy so callers
   *  can pass it to the matcher without worrying about live mutation. */
  list(): BlockRule[] {
    return this.rules.slice();
  }

  regexFor(ruleId: string): RegExp | undefined {
    return this.regexCache.get(ruleId);
  }

  regexCacheRef(): Map<string, RegExp> {
    return this.regexCache;
  }

  isInvalidRegex(ruleId: string): boolean {
    return this.invalidRegexIds.has(ruleId);
  }

  /** Append the given rules with fresh ids + createdAt. Persists immediately.
   *  Returns the inserted rules so callers can echo them back over the wire. */
  addMany(partials: Array<Omit<BlockRule, 'id' | 'createdAt' | 'matchCount'>>): BlockRule[] {
    const now = Date.now();
    const inserted: BlockRule[] = partials.map((p) => ({
      ...p,
      id: randomUUID(),
      createdAt: now,
      matchCount: 0,
    }));
    this.rules = [...this.rules, ...inserted];
    this.sortByCreatedAt();
    this.rebuildRegexCache();
    settingsStore.saveBlockRules(this.rules);
    return inserted;
  }

  update(id: string, patch: Partial<Omit<BlockRule, 'id' | 'createdAt'>>): BlockRule | null {
    const idx = this.rules.findIndex((r) => r.id === id);
    if (idx === -1) return null;
    const merged: BlockRule = { ...this.rules[idx], ...patch };
    this.rules[idx] = merged;
    this.rebuildRegexCache();
    settingsStore.saveBlockRules(this.rules);
    return merged;
  }

  remove(id: string): boolean {
    const next = this.rules.filter((r) => r.id !== id);
    if (next.length === this.rules.length) return false;
    this.rules = next;
    this.rebuildRegexCache();
    settingsStore.saveBlockRules(this.rules);
    return true;
  }

  /** Increment matchCount for `ruleId`. Debounced flush — counter changes
   *  don't write to disk until the timer fires or `flushNow` is called. */
  bumpMatchCount(ruleId: string): BlockRule | null {
    const idx = this.rules.findIndex((r) => r.id === ruleId);
    if (idx === -1) return null;
    this.rules[idx] = { ...this.rules[idx], matchCount: this.rules[idx].matchCount + 1 };
    this.counterDirty = true;
    if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => this.flushNow(), COUNTER_FLUSH_DEBOUNCE_MS);
    }
    return this.rules[idx];
  }

  /** Persist the current rule list now (used by app-quit). */
  flushNow(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    if (!this.counterDirty) return;
    this.counterDirty = false;
    settingsStore.saveBlockRules(this.rules);
  }
}

let instance: BlockingStore | null = null;

export function blockingStore(): BlockingStore {
  if (!instance) {
    instance = new BlockingStore();
    instance.load();
  }
  return instance;
}
```

- [ ] **Step 2: Verify**

```bash
pnpm typecheck && pnpm lint
```

Expected: PASS.

---

### Task 5: Holder integration

**Files:**
- Modify: `src/main/state/holder.ts`

The holder wraps `blockingStore()` and exposes get/add/update/remove. It also annotates `meta.blocked` on read in `getMessagesForKey` and `getRecentMessages`, and bumps the counter exactly once at first match (on `upsertMessage`).

- [ ] **Step 1: Wire imports + delegation methods**

Open [src/main/state/holder.ts](src/main/state/holder.ts).

Add to the type imports:

```ts
import {
  // …existing imports…
  type BlockRule,
  type Message,
  type MessageMeta,
  // …
} from '../../shared/types';
```

Add (top of file, alongside existing imports):

```ts
import { blockingStore } from '../blocking/store';
import {
  type BlockMatchHints,
  extractSenderNameFromBody,
  isMessageBlocked,
} from '../../shared/blocking/match';
import { emit } from '../events/bus';
```

(`emit` may already be imported — keep it deduplicated.)

Inside the `StateHolder` class, add a private accessor and pass-through methods. Insert these near the end of the class (after `setDeviceCapabilities`, around line 205):

```ts
  // ----- Block rules -----

  getBlockRules(): BlockRule[] {
    return blockingStore().list();
  }
  addBlockRules(
    partials: Array<Omit<BlockRule, 'id' | 'createdAt' | 'matchCount'>>,
  ): BlockRule[] {
    const inserted = blockingStore().addMany(partials);
    emit.blockRules(this.getBlockRules());
    return inserted;
  }
  updateBlockRule(
    id: string,
    patch: Partial<Omit<BlockRule, 'id' | 'createdAt'>>,
  ): BlockRule | null {
    const updated = blockingStore().update(id, patch);
    if (updated) emit.blockRules(this.getBlockRules());
    return updated;
  }
  removeBlockRule(id: string): boolean {
    const ok = blockingStore().remove(id);
    if (ok) emit.blockRules(this.getBlockRules());
    return ok;
  }
  flushBlockCounters(): void {
    blockingStore().flushNow();
  }
```

- [ ] **Step 2: Add a shared `buildBlockHints` helper**

Insert this private method on the class (above the block-rules section from Step 1):

```ts
  /** Build the BlockMatchHints for a single message based on current
   *  contacts + origin hop. Used by both annotateBlocked (read path) and
   *  upsertMessage (write path). */
  private buildBlockHints(msg: Message): BlockMatchHints {
    const originHop = msg.meta?.paths?.[0]?.hops.find((h) => h.kind === 'origin');
    return {
      senderNameFromBody: msg.key.startsWith('ch:')
        ? extractSenderNameFromBody(msg.body)
        : undefined,
      contactNameByPk: (pk) => this.contacts.find((c) => c.publicKeyHex === pk)?.name,
      originHopShortId: originHop?.shortId?.toLowerCase(),
      originHopPk: originHop?.pk?.toLowerCase() ?? undefined,
    };
  }
```

- [ ] **Step 3: Annotate `meta.blocked` on read**

Replace the existing `getMessagesForKey` and `getRecentMessages` methods (around line 207–212) with annotated versions:

```ts
  getRecentMessages(limit = 500): Message[] {
    return this.annotateBlocked(messagesStore.recent(limit));
  }
  getMessagesForKey(key: string, opts?: { limit?: number; before?: number }): Message[] {
    return this.annotateBlocked(messagesStore.byKey(key, opts));
  }
  private annotateBlocked(rows: Message[]): Message[] {
    const rules = blockingStore().list();
    if (rules.length === 0) return rows;
    const regexCache = blockingStore().regexCacheRef();
    return rows.map((m) => {
      const { blocked, ruleId } = isMessageBlocked(
        m,
        this.buildBlockHints(m),
        rules,
        regexCache,
      );
      if (!blocked) return m;
      const meta: MessageMeta = { ...(m.meta ?? {}), blocked: true, blockedByRuleId: ruleId };
      return { ...m, meta };
    });
  }
```

- [ ] **Step 4: Bump counter at first arrival in `upsertMessage`**

Inside `upsertMessage` (around line 223), at the very top — *before* the `existing` lookup — add:

```ts
    // First-match: only count when this id is new. Backfill (re-evaluation on
    // rule creation) is handled by a separate pass; per-render reads never
    // bump the counter.
    const isNew = !messagesStore.findById(message.id);
    if (isNew) {
      const rules = blockingStore().list();
      if (rules.length > 0) {
        const { blocked, ruleId } = isMessageBlocked(
          message,
          this.buildBlockHints(message),
          rules,
          blockingStore().regexCacheRef(),
        );
        if (blocked && ruleId) blockingStore().bumpMatchCount(ruleId);
      }
    }
```

(Keep the existing `const existing = messagesStore.findById(message.id);` line — we now do the lookup twice on new arrivals. Acceptable: the sqlite indexed lookup is cheap, and this keeps the merge branch logic untouched.)

- [ ] **Step 5: Backfill counter on rule add**

The dialog's "Hide past messages — last 24h" puts `tsFrom` in the past, so when a rule is added, retro-matches need their counter contributions. Update `addBlockRules` from Step 1:

```ts
  addBlockRules(
    partials: Array<Omit<BlockRule, 'id' | 'createdAt' | 'matchCount'>>,
  ): BlockRule[] {
    const inserted = blockingStore().addMany(partials);
    // Backfill: scan messages from min(tsFrom) across inserted rules; bump
    // counters for any that match. One pass — we don't double-count if multiple
    // new rules match the same message because isMessageBlocked short-circuits
    // on the first hit (createdAt asc).
    const minTsFrom = Math.min(...inserted.map((r) => r.tsFrom));
    const recent = messagesStore.sinceTs(minTsFrom);
    const rules = blockingStore().list();
    const cache = blockingStore().regexCacheRef();
    const insertedIds = new Set(inserted.map((r) => r.id));
    for (const m of recent) {
      const { blocked, ruleId } = isMessageBlocked(m, this.buildBlockHints(m), rules, cache);
      // Only credit the new rules — pre-existing rules already counted these
      // messages when they arrived.
      if (blocked && ruleId && insertedIds.has(ruleId)) {
        blockingStore().bumpMatchCount(ruleId);
      }
    }
    emit.blockRules(this.getBlockRules());
    return inserted;
  }
```

This depends on a new `messagesStore.sinceTs(ts)` — Task 6 adds it.

- [ ] **Step 6: Verify**

```bash
pnpm typecheck && pnpm lint
```

Expected: typecheck FAIL pointing at `messagesStore.sinceTs` (added in Task 6). All other errors must be fixed before moving on.

---

### Task 6: Messages store — sinceTs helper

**Files:**
- Modify: `src/main/storage/messages.ts`

- [ ] **Step 1: Add `sinceTs`**

Open [src/main/storage/messages.ts](src/main/storage/messages.ts). Inside `export const messagesStore = {`, alongside `byKey` (around the end of the existing `byKey` method), add:

```ts
  /** All messages with ts >= cutoff, ordered by ts asc. Used by the block-rule
   *  backfill pass to credit retro-matches. Capped to avoid runaway scans on
   *  cutoff=0. */
  sinceTs(cutoffMs: number, limit = 50_000): Message[] {
    const db = openDb();
    const rows = db
      .prepare(
        `SELECT mid, kind, key, ts, from_pk, body, state, meta FROM messages
         WHERE ts >= ? ORDER BY ts ASC LIMIT ?`,
      )
      .all(cutoffMs, limit) as unknown as Row[];
    return rows.map(rowToMessage);
  },
```

- [ ] **Step 2: Verify**

```bash
pnpm typecheck && pnpm lint
```

Expected: PASS for Task 5 + Task 6 combined.

---

### Task 7: Bus + ws broadcast

**Files:**
- Modify: `src/main/events/bus.ts`
- Modify: `src/main/server.ts`

- [ ] **Step 1: Bus**

Open [src/main/events/bus.ts](src/main/events/bus.ts).

Add to the type imports at the top:

```ts
import type {
  // …existing…
  BlockRule,
  // …
} from '../../shared/types';
```

Add inside the `emit` object (alongside the other emitters):

```ts
  blockRules: (rules: BlockRule[]) => bus.emit('blockRules', rules),
```

Add inside the `BusEvents` type:

```ts
  blockRules: (rules: BlockRule[]) => void;
```

- [ ] **Step 2: Server broadcast**

Open [src/main/server.ts](src/main/server.ts). After the existing `bus.on('uiState', onUiState)` (or similar — match the surrounding pattern), add:

```ts
  const onBlockRules = (rules: BlockRule[]) =>
    broadcast({ type: 'blockRules', payload: rules });
  bus.on('blockRules', onBlockRules);
```

Import `BlockRule` at the top of the file (group with the other type imports).

Inside the per-connection initial-state block (where `initialState` is constructed), confirm that `blockRules` is part of the snapshot — that comes from `stateHolder.getBlockRules()` in Task 8.

- [ ] **Step 3: Verify**

```bash
pnpm typecheck && pnpm lint
```

Expected: PASS.

---

### Task 8: HTTP routes + state snapshot

**Files:**
- Modify: `src/main/api/routes.ts`

- [ ] **Step 1: Add `blockRules` to the state snapshot**

Open [src/main/api/routes.ts](src/main/api/routes.ts). Find the existing snapshot builder (around line 92, where `appSettings: holder.getAppSettings(),` appears). Add:

```ts
      blockRules: holder.getBlockRules(),
```

- [ ] **Step 2: Add the three endpoints**

After the existing `api.put('/api/settings/app', …)` block (around line 137), add the block-rule routes. Use the validation pattern from neighboring routes (Hono c.req.json + try/catch).

```ts
  // ----- Block rules -----
  // POST /api/blocks — bulk add (the dialog ticks N identifiers → N rules).
  api.post('/api/blocks', async (c) => {
    const body = (await c.req.json()) as {
      rules: Array<{
        type: 'pubkey' | 'pubkeyPrefix' | 'name' | 'nameRegex';
        pattern: string;
        tsFrom: number;
        enabled: boolean;
        note?: string;
      }>;
    };
    if (!Array.isArray(body.rules) || body.rules.length === 0) {
      return c.json({ error: 'rules required' }, 400);
    }
    const holder = stateHolder();
    const inserted = holder.addBlockRules(body.rules);
    return c.json({ rules: inserted });
  });

  // PUT /api/blocks/:id — edit pattern / note / tsFrom / enabled.
  api.put('/api/blocks/:id', async (c) => {
    const id = c.req.param('id');
    const patch = (await c.req.json()) as Partial<{
      pattern: string;
      tsFrom: number;
      enabled: boolean;
      note: string;
    }>;
    const updated = stateHolder().updateBlockRule(id, patch);
    if (!updated) return c.json({ error: 'not found' }, 404);
    return c.json({ rule: updated });
  });

  // DELETE /api/blocks/:id — remove the rule entirely.
  api.delete('/api/blocks/:id', (c) => {
    const id = c.req.param('id');
    const ok = stateHolder().removeBlockRule(id);
    if (!ok) return c.json({ error: 'not found' }, 404);
    return c.json({ ok: true });
  });
```

- [ ] **Step 3: Verify**

```bash
pnpm typecheck && pnpm lint
```

Expected: PASS.

---

### Task 9: Notifications + dock badge gating

**Files:**
- Modify: `src/main/notifications.ts`

- [ ] **Step 1: Import the matcher**

Open [src/main/notifications.ts](src/main/notifications.ts). Add at the top:

```ts
import { blockingStore } from './blocking/store';
import { isMessageBlocked, extractSenderNameFromBody } from '../shared/blocking/match';
import type { BlockMatchHints } from '../shared/blocking/match';
```

- [ ] **Step 2: Helper that builds hints from the holder**

Add a top-level helper just above `maybeNotify`:

```ts
function buildHintsForNotify(m: Message): BlockMatchHints {
  const holder = stateHolder();
  const originHop = m.meta?.paths?.[0]?.hops.find((h) => h.kind === 'origin');
  return {
    senderNameFromBody: m.key.startsWith('ch:')
      ? extractSenderNameFromBody(m.body)
      : undefined,
    contactNameByPk: (pk) => holder.getContacts().find((c) => c.publicKeyHex === pk)?.name,
    originHopShortId: originHop?.shortId?.toLowerCase(),
    originHopPk: originHop?.pk?.toLowerCase() ?? undefined,
  };
}
```

- [ ] **Step 3: Gate `maybeNotify`**

Inside `maybeNotify`, right after the early-return for `m.state !== 'received'` and before the muted/policy checks, add:

```ts
  const rules = blockingStore().list();
  if (rules.length > 0) {
    const { blocked } = isMessageBlocked(
      m,
      buildHintsForNotify(m),
      rules,
      blockingStore().regexCacheRef(),
    );
    if (blocked) return;
  }
```

- [ ] **Step 4: Gate `recomputeBadge`**

Inside `recomputeBadge`, in the inner per-message loop (the `for (const m of msgs)` block), add a block check before the existing `m.state !== 'received'` continue:

```ts
    const rules = blockingStore().list();
    const cache = blockingStore().regexCacheRef();
    for (const m of msgs) {
      if (m.state !== 'received') continue;
      if (m.ts <= lastRead) continue;
      if (rules.length > 0) {
        const { blocked } = isMessageBlocked(m, buildHintsForNotify(m), rules, cache);
        if (blocked) continue;
      }
      const kind = classify(m, owner?.name);
      if (policy[kind]) total += 1;
    }
```

(Hoist `rules` + `cache` out of the inner loop as shown above so we don't refetch per message.)

- [ ] **Step 5: Wire `blockRules` event for badge recompute**

In `startNotifications` (top of the file), add a listener so badge totals refresh when rules change:

```ts
  bus.on('blockRules', recomputeBadge);
```

- [ ] **Step 6: Verify**

```bash
pnpm typecheck && pnpm lint
```

Expected: PASS.

---

### Task 10: Flush counters on app quit

**Files:**
- Modify: `src/main/index.ts` (or wherever the app `before-quit` / `will-quit` hooks live)

- [ ] **Step 1: Locate the quit hook**

```bash
grep -n "before-quit\|will-quit\|flushSettings" src/main/index.ts src/main/window/quit.ts 2>/dev/null
```

Use the file that already calls `flushSettings()` (from `storage/settings.ts`). Add right next to it:

```ts
import { blockingStore } from './blocking/store';
// …
blockingStore().flushNow();
```

If no `flushSettings()` call exists yet (unlikely), wire one in the same place that listens for `app.on('before-quit', …)`.

- [ ] **Step 2: Verify**

```bash
pnpm typecheck && pnpm lint
```

Expected: PASS.

---

### Task 11: Renderer api wrapper

**Files:**
- Modify: `src/renderer/lib/api.ts`

- [ ] **Step 1: Add the three calls**

Open [src/renderer/lib/api.ts](src/renderer/lib/api.ts). Match the existing pattern (look at how `putAppSettings` and similar are written). Add:

```ts
import type { BlockRule } from '../../shared/types';

export async function addBlockRules(
  client: ApiClient,
  rules: Array<Omit<BlockRule, 'id' | 'createdAt' | 'matchCount'>>,
): Promise<BlockRule[]> {
  const res = await client.fetch('/api/blocks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rules }),
  });
  if (!res.ok) throw new Error(`addBlockRules: ${res.status}`);
  const j = (await res.json()) as { rules: BlockRule[] };
  return j.rules;
}

export async function updateBlockRule(
  client: ApiClient,
  id: string,
  patch: Partial<Omit<BlockRule, 'id' | 'createdAt'>>,
): Promise<BlockRule> {
  const res = await client.fetch(`/api/blocks/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(`updateBlockRule: ${res.status}`);
  const j = (await res.json()) as { rule: BlockRule };
  return j.rule;
}

export async function removeBlockRule(client: ApiClient, id: string): Promise<void> {
  const res = await client.fetch(`/api/blocks/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
  if (!res.ok) throw new Error(`removeBlockRule: ${res.status}`);
}
```

Add these to the named `api` export object too if that file groups exports that way — confirm by reading the file before editing.

- [ ] **Step 2: Verify**

```bash
pnpm typecheck && pnpm lint
```

Expected: PASS.

---

### Task 12: Renderer store + ws dispatch

**Files:**
- Modify: `src/renderer/lib/store.ts`
- Modify: `src/renderer/app/wsHandlers.ts`

- [ ] **Step 1: Add `BlockRule` to imports and the slice**

In [src/renderer/lib/store.ts](src/renderer/lib/store.ts) imports:

```ts
import type {
  // …existing…
  BlockRule,
  // …
} from '../../shared/types';
```

Extend the `SettingsTab` union (around line 68):

```ts
export type SettingsTab = 'app' | 'radio' | 'blocked' | 'extra';
```

Add `blockRules` to the state shape (alongside `appSettings`, around line 159):

```ts
  blockRules: BlockRule[];
```

Default initial value (in the same store-construction block, around line 383):

```ts
  blockRules: [],
```

Hydrate from snapshot (around line 425 where other slices read from `snapshot`):

```ts
      blockRules: snapshot.blockRules,
```

Apply action (alongside `applyAppSettings`, around line 499):

```ts
  applyBlockRules: (rules: BlockRule[]) => set(() => ({ blockRules: rules })),
```

Declare the action in the types interface (around line 208 where `hydrate` and friends are declared):

```ts
  applyBlockRules: (rules: BlockRule[]) => void;
```

- [ ] **Step 2: Dispatch the ws event**

In [src/renderer/app/wsHandlers.ts](src/renderer/app/wsHandlers.ts), add a case alongside the existing message handlers (find `case 'appSettings':` around line 73 and follow its pattern):

```ts
    case 'blockRules':
      store.applyBlockRules(msg.payload);
      break;
```

- [ ] **Step 3: Verify**

```bash
pnpm typecheck && pnpm lint
```

Expected: PASS.

---

### Task 13: BlockSenderDialog component

**Files:**
- Create: `src/renderer/components/BlockSenderDialog.tsx`

- [ ] **Step 1: Write the component**

Create [src/renderer/components/BlockSenderDialog.tsx](src/renderer/components/BlockSenderDialog.tsx):

```tsx
import { useState } from 'react';
import type { BlockRule, BlockRuleType } from '../../shared/types';
import { api, type ApiClient } from '../lib/api';
import { addBlockRules } from '../lib/api';
import { notify } from '../lib/notify';
import { Button } from './ui/button';
import { Checkbox } from './ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';

const WINDOW_OPTIONS: Array<{ label: string; ms: number }> = [
  { label: '1 hour', ms: 60 * 60 * 1000 },
  { label: '24 hours', ms: 24 * 60 * 60 * 1000 },
  { label: '7 days', ms: 7 * 24 * 60 * 60 * 1000 },
  { label: '30 days', ms: 30 * 24 * 60 * 60 * 1000 },
  { label: 'All time', ms: 0 },
];

/** Pre-fill payload from a message that the user right-clicked. Pass empty
 *  strings/undefined for fields we don't have. */
export interface BlockSenderDialogPrefill {
  pubkey?: string;
  pubkeyPrefix?: string;
  name?: string;
}

interface Props {
  client: ApiClient | null;
  open: boolean;
  prefill: BlockSenderDialogPrefill;
  onClose: () => void;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function BlockSenderDialog({ client, open, prefill, onClose }: Props) {
  // Each identifier's checked state. Defaults: ticked iff we have a value.
  const [pubkeyChecked, setPubkeyChecked] = useState(prefill.pubkey != null);
  const [prefixChecked, setPrefixChecked] = useState(prefill.pubkeyPrefix != null);
  const [nameChecked, setNameChecked] = useState(prefill.name != null);
  const [regexChecked, setRegexChecked] = useState(false);
  const [regexSource, setRegexSource] = useState(prefill.name ? `^${escapeRegex(prefill.name)}$` : '');
  const [retroChecked, setRetroChecked] = useState(true);
  const [windowMs, setWindowMs] = useState(WINDOW_OPTIONS[1].ms);
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const regexValid = (() => {
    if (!regexChecked) return true;
    try {
      new RegExp(regexSource, 'i');
      return true;
    } catch {
      return false;
    }
  })();
  const anyChecked = pubkeyChecked || prefixChecked || nameChecked || regexChecked;
  const submitDisabled = !anyChecked || !regexValid || submitting || client == null;

  async function submit() {
    if (client == null) return;
    setSubmitting(true);
    const now = Date.now();
    const tsFrom = retroChecked ? (windowMs === 0 ? 0 : now - windowMs) : now;

    const rules: Array<Omit<BlockRule, 'id' | 'createdAt' | 'matchCount'>> = [];
    if (pubkeyChecked && prefill.pubkey) {
      rules.push({ type: 'pubkey', pattern: prefill.pubkey, tsFrom, enabled: true, note: note || undefined });
    }
    if (prefixChecked && prefill.pubkeyPrefix) {
      rules.push({
        type: 'pubkeyPrefix',
        pattern: prefill.pubkeyPrefix,
        tsFrom,
        enabled: true,
        note: note || undefined,
      });
    }
    if (nameChecked && prefill.name) {
      rules.push({ type: 'name', pattern: prefill.name, tsFrom, enabled: true, note: note || undefined });
    }
    if (regexChecked && regexSource.length > 0) {
      rules.push({
        type: 'nameRegex',
        pattern: regexSource,
        tsFrom,
        enabled: true,
        note: note || undefined,
      });
    }
    try {
      await addBlockRules(client, rules);
      notify.success(`Added ${rules.length} block rule${rules.length === 1 ? '' : 's'}`);
      onClose();
    } catch (err) {
      notify.error(`Block failed: ${(err as Error).message}`, err);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Block sender</DialogTitle>
        </DialogHeader>

        <div className="space-y-3 text-sm">
          <p className="text-cs-fg-2">Create block rule(s) for this sender.</p>

          <div className="space-y-2">
            <Label className="text-xs uppercase text-cs-fg-3">Identifiers from this message</Label>
            <div className="flex items-center gap-2">
              <Checkbox
                checked={pubkeyChecked}
                disabled={prefill.pubkey == null}
                onCheckedChange={(v) => setPubkeyChecked(v === true)}
              />
              <span className="flex-1">Public key</span>
              <code className="text-xs">{prefill.pubkey ?? '—'}</code>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox
                checked={prefixChecked}
                disabled={prefill.pubkeyPrefix == null}
                onCheckedChange={(v) => setPrefixChecked(v === true)}
              />
              <span className="flex-1">Key prefix</span>
              <code className="text-xs">{prefill.pubkeyPrefix ?? '—'}</code>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox
                checked={nameChecked}
                disabled={prefill.name == null}
                onCheckedChange={(v) => setNameChecked(v === true)}
              />
              <span className="flex-1">Name</span>
              <code className="text-xs">{prefill.name ?? '—'}</code>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox
                checked={regexChecked}
                onCheckedChange={(v) => setRegexChecked(v === true)}
              />
              <span className="w-24">Name regex</span>
              <Input
                value={regexSource}
                onChange={(e) => setRegexSource(e.target.value)}
                className="flex-1"
                placeholder="^Bob.*$"
              />
            </div>
            {regexChecked && !regexValid && (
              <p className="text-xs text-red-500">Invalid regex</p>
            )}
          </div>

          <div className="space-y-2 border-t pt-2">
            <div className="flex items-center gap-2">
              <Checkbox
                checked={retroChecked}
                onCheckedChange={(v) => setRetroChecked(v === true)}
              />
              <span className="flex-1">Also hide past messages from last</span>
              <Select
                value={String(windowMs)}
                onValueChange={(v) => setWindowMs(Number(v))}
                disabled={!retroChecked}
              >
                <SelectTrigger className="w-28">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {WINDOW_OPTIONS.map((o) => (
                    <SelectItem key={o.ms} value={String(o.ms)}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1">
            <Label htmlFor="block-note" className="text-xs uppercase text-cs-fg-3">Note (optional)</Label>
            <Input id="block-note" value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={submitting}>Cancel</Button>
          <Button onClick={submit} disabled={submitDisabled}>Block</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Verify**

```bash
pnpm typecheck && pnpm lint
```

Expected: PASS. (If `notify.success` import path differs — check via `grep -n "notify.success" src/renderer/components/*.tsx` and adjust.)

---

### Task 14: Wire right-click in MessageList

**Files:**
- Modify: `src/renderer/components/MessageList.tsx`

- [ ] **Step 1: Thread `client` into MessageList**

Open [src/renderer/components/MessageList.tsx](src/renderer/components/MessageList.tsx). Add `client: ApiClient | null` to its `Props` interface and destructure it in the component signature.

Update the two callers:
- [src/renderer/panels/DMView.tsx](src/renderer/panels/DMView.tsx) — already has `client` in scope (line 28). Pass `client={client}` into `<MessageList …>` (around line 98).
- [src/renderer/panels/ChannelView.tsx](src/renderer/panels/ChannelView.tsx) — same; pass `client={client}` into `<MessageList …>` (around line 131).

Add the import at the top of MessageList:
```ts
import type { ApiClient } from '../lib/api';
```

- [ ] **Step 2: Wire the dialog state**

At the top of the `MessageList` component body, add:
```tsx
const [blockPrefill, setBlockPrefill] = useState<BlockSenderDialogPrefill | null>(null);
```

Add imports at the top of the file:
```ts
import { BlockSenderDialog, type BlockSenderDialogPrefill } from './BlockSenderDialog';
import { ShieldOff } from 'lucide-react';
import { deriveSenderName } from '../lib/utils';
```

- [ ] **Step 3: Extend the context menu builder**

Find the `buildMenu` function (around line 342). It already has access to the `Message m` plus `contactByPk` (the same lookup MessageRow uses). Append after the existing items:

```tsx
const sender = m.fromPublicKeyHex ? contactByPk.get(m.fromPublicKeyHex) : undefined;
const senderName = sender?.name ?? deriveSenderName(m.fromPublicKeyHex);
const originHop = m.meta?.paths?.[0]?.hops.find((h) => h.kind === 'origin');
const prefix =
  originHop?.shortId?.toLowerCase() ??
  m.fromPublicKeyHex?.slice(0, 4) ??
  undefined;
const pubkey = m.fromPublicKeyHex ?? originHop?.pk ?? undefined;

items.push(menuSeparator);
items.push(
  menuItem('Block sender…', () => {
    setBlockPrefill({
      pubkey,
      pubkeyPrefix: prefix,
      name: senderName || undefined,
    });
  }, { icon: ShieldOff }),
);
```

If `buildMenu` is a top-level helper (outside the component) it can't call `setBlockPrefill` directly. In that case, accept an `onBlock(prefill)` callback in `BuildMenuOpts` and call it from the menu item; pass `(p) => setBlockPrefill(p)` from the component. Read the existing function signature first; mirror its style.

- [ ] **Step 4: Render the dialog**

At the bottom of the returned JSX (just before the closing fragment/wrapper), add:

```tsx
{blockPrefill && (
  <BlockSenderDialog
    client={client}
    open
    prefill={blockPrefill}
    onClose={() => setBlockPrefill(null)}
  />
)}
```

- [ ] **Step 5: Verify**

```bash
pnpm typecheck && pnpm lint
```

Expected: PASS.

---

### Task 15: Hide blocked messages in MessageList rendering

**Files:**
- Modify: `src/renderer/components/MessageList.tsx`

- [ ] **Step 1: Filter at the render boundary**

In [src/renderer/components/MessageList.tsx](src/renderer/components/MessageList.tsx), find where the `items` array (or the messages prop) is mapped into virtuoso items. Filter early:

```ts
const visibleMessages = messages.filter((m) => m.meta?.blocked !== true);
```

Use `visibleMessages` wherever `messages` was previously used to build the virtuoso item list. Leave any computations that depend on the *complete* message history (e.g., last-read marker) reading the original `messages` — only the rendered list filters.

- [ ] **Step 2: Verify**

```bash
pnpm typecheck && pnpm lint
```

Expected: PASS.

Smoke check: with no rules active, the conversation looks identical to before.

---

### Task 16: Hide blocked from Unreads

**Files:**
- Modify: `src/renderer/panels/Unreads.tsx`

- [ ] **Step 1: Filter unread message lists**

Open [src/renderer/panels/Unreads.tsx](src/renderer/panels/Unreads.tsx). Find where messages are filtered to unread (search for `lastReadByKey` or unread-derivation logic). Add the same `.filter((m) => m.meta?.blocked !== true)` step inline with the unread filter. If the unread count is computed off this list, the count drops automatically.

- [ ] **Step 2: Verify**

```bash
pnpm typecheck && pnpm lint
```

Expected: PASS.

---

### Task 17: Hide blocked from Search results

**Files:**
- Modify: `src/renderer/panels/search/ResultsList.tsx` (and/or sibling MessageRow if filtering is done there)
- Modify: `src/main/storage/search.ts`

Search results come from a different code path (FTS5 + a separate query). The blocking annotation flows through differently — main needs to annotate hits, and the renderer filters.

- [ ] **Step 1: Annotate search hits in main**

Open [src/main/storage/search.ts](src/main/storage/search.ts). Find the `searchMessages` function (the export that builds `SearchResults`). For each `MessageHit`, after the existing fields are populated, attach a `blocked` flag by running `isMessageBlocked` on a synthesized `Message` shape OR (simpler) extend `MessageHit` in [src/shared/types.ts](src/shared/types.ts) with `blocked?: boolean` and set it from the holder.

Concrete approach:
1. In `src/shared/types.ts`, add `blocked?: boolean;` to `MessageHit` (around line 215).
2. In `src/main/storage/search.ts`, the search query already has `from_pk` and `body` available. After building the `hits` array, post-process:
   ```ts
   import { blockingStore } from '../blocking/store';
   import { isMessageBlocked, extractSenderNameFromBody } from '../../shared/blocking/match';
   import { stateHolder } from '../state/holder';
   // …
   const rules = blockingStore().list();
   if (rules.length > 0) {
     const cache = blockingStore().regexCacheRef();
     const contacts = stateHolder().getContacts();
     const contactNameByPk = (pk: string) => contacts.find((c) => c.publicKeyHex === pk)?.name;
     for (const h of hits) {
       const synthetic = {
         id: h.id, key: h.key, body: h.body, ts: h.ts, state: 'received' as const,
         fromPublicKeyHex: h.fromPublicKeyHex ?? undefined, meta: undefined,
       };
       const { blocked } = isMessageBlocked(
         synthetic,
         {
           senderNameFromBody: h.key.startsWith('ch:') ? extractSenderNameFromBody(h.body) : undefined,
           contactNameByPk,
         },
         rules,
         cache,
       );
       if (blocked) h.blocked = true;
     }
   }
   ```
   Note that `originHopShortId` / `originHopPk` are not available in search (no path persisted). That's a documented limitation: `pubkey` / `pubkeyPrefix` rules won't filter channel-message hits in search. The `name`/`nameRegex` rules will.

- [ ] **Step 2: Filter in the renderer search results**

In [src/renderer/panels/search/ResultsList.tsx](src/renderer/panels/search/ResultsList.tsx), filter `messages` before rendering:

```ts
const visibleMessages = results.messages.filter((m) => m.blocked !== true);
```

Use `visibleMessages` for the list. Adjust the `Load more` total if it derives from `visibleMessages.length` (otherwise let the upstream total stand — main excludes them from the count too if you choose; simplest path is to leave the total alone and let an occasional "load more" come up empty).

- [ ] **Step 3: Verify**

```bash
pnpm typecheck && pnpm lint
```

Expected: PASS.

---

### Task 18: Settings → Blocked tab

**Files:**
- Create: `src/renderer/panels/settings/blocked/BlockedSection.tsx`
- Create: `src/renderer/panels/settings/blocked/index.ts`
- Modify: `src/renderer/panels/settings/SettingsPanel.tsx`
- Modify: `src/renderer/panels/settings/PillTabs.tsx` (if it enumerates tabs — verify at task time)

- [ ] **Step 1: Write `BlockedSection`**

Create [src/renderer/panels/settings/blocked/BlockedSection.tsx](src/renderer/panels/settings/blocked/BlockedSection.tsx):

```tsx
import { useState } from 'react';
import { Plus, Trash2, ToggleLeft, ToggleRight, Edit3 } from 'lucide-react';
import type { BlockRule } from '../../../../shared/types';
import { BlockSenderDialog } from '../../../components/BlockSenderDialog';
import type { ApiClient } from '../../../lib/api';
import { removeBlockRule, updateBlockRule } from '../../../lib/api';
import { notify } from '../../../lib/notify';
import { useStore } from '../../../lib/store';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import { fmtDateTime } from '../../../lib/time';

interface Props {
  client: ApiClient | null;
}

function ruleTypeLabel(t: BlockRule['type']): string {
  switch (t) {
    case 'pubkey': return 'pubkey';
    case 'pubkeyPrefix': return 'prefix';
    case 'name': return 'name';
    case 'nameRegex': return 'regex';
  }
}

function shortPattern(r: BlockRule): string {
  if (r.type === 'pubkey' && r.pattern.length > 12) return `${r.pattern.slice(0, 8)}…${r.pattern.slice(-4)}`;
  return r.pattern;
}

export function BlockedSection({ client }: Props) {
  const rules = useStore((s) => s.blockRules);
  const [filter, setFilter] = useState('');
  const [showAdd, setShowAdd] = useState(false);

  const filtered = filter.trim().length === 0
    ? rules
    : rules.filter((r) => r.pattern.includes(filter) || (r.note ?? '').includes(filter));

  const sorted = filtered.slice().sort((a, b) => b.createdAt - a.createdAt);

  async function toggleEnabled(r: BlockRule) {
    if (!client) return;
    try { await updateBlockRule(client, r.id, { enabled: !r.enabled }); }
    catch (err) { notify.error(`Toggle failed: ${(err as Error).message}`, err); }
  }
  async function remove(r: BlockRule) {
    if (!client) return;
    try { await removeBlockRule(client, r.id); notify.success('Unblocked'); }
    catch (err) { notify.error(`Remove failed: ${(err as Error).message}`, err); }
  }

  return (
    <section id="blocked-rules" className="space-y-3">
      <header className="flex items-center justify-between">
        <div>
          <h3 className="text-base font-medium">Blocked senders</h3>
          <p className="text-sm text-cs-fg-2">Hide messages matching these rules everywhere.</p>
        </div>
        <Button onClick={() => setShowAdd(true)} size="sm"><Plus className="mr-1 h-4 w-4" /> Add rule</Button>
      </header>

      <Input
        placeholder="Filter by pattern or note…"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        className="max-w-sm"
      />

      {sorted.length === 0 ? (
        <p className="text-sm text-cs-fg-3">
          No block rules yet. Right-click any message and choose <em>Block sender…</em>, or click <em>Add rule</em>.
        </p>
      ) : (
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b text-left text-xs uppercase text-cs-fg-3">
              <th className="py-1 pr-2">Type</th>
              <th className="py-1 pr-2">Pattern</th>
              <th className="py-1 pr-2">Since</th>
              <th className="py-1 pr-2">Matches</th>
              <th className="py-1 pr-2">Note</th>
              <th className="py-1 pr-2 w-32">Actions</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => (
              <tr key={r.id} className={r.enabled ? '' : 'opacity-50'}>
                <td className="py-1 pr-2">{ruleTypeLabel(r.type)}</td>
                <td className="py-1 pr-2 font-mono">{shortPattern(r)}</td>
                <td className="py-1 pr-2">{r.tsFrom === 0 ? 'all' : fmtDateTime(r.tsFrom)}</td>
                <td className="py-1 pr-2 tabular-nums">{r.matchCount}</td>
                <td className="py-1 pr-2">{r.note ?? ''}</td>
                <td className="py-1 pr-2">
                  <div className="flex gap-1">
                    <Button size="icon" variant="ghost" onClick={() => toggleEnabled(r)} title={r.enabled ? 'Disable' : 'Enable'}>
                      {r.enabled ? <ToggleRight className="h-4 w-4" /> : <ToggleLeft className="h-4 w-4" />}
                    </Button>
                    <Button size="icon" variant="ghost" onClick={() => remove(r)} title="Unblock">
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {showAdd && (
        <BlockSenderDialog
          client={client}
          open
          prefill={{}}
          onClose={() => setShowAdd(false)}
        />
      )}
    </section>
  );
}
```

- [ ] **Step 2: Index re-export**

Create [src/renderer/panels/settings/blocked/index.ts](src/renderer/panels/settings/blocked/index.ts):

```ts
export { BlockedSection } from './BlockedSection';
```

- [ ] **Step 3: Register the tab in SettingsPanel**

In [src/renderer/panels/settings/SettingsPanel.tsx](src/renderer/panels/settings/SettingsPanel.tsx):

1. Add to `TAB_SECTIONS` (around line 30):
   ```ts
     blocked: [
       { id: 'blocked-rules', title: 'Blocked Senders', tab: 'blocked' },
     ],
   ```
2. Render `<BlockedSection client={client} />` when `activeTab === 'blocked'`. Match the conditional-render pattern used for the other tabs (search the file for `activeTab === 'radio'` to find the right place).
3. Import:
   ```ts
   import { BlockedSection } from './blocked';
   ```

- [ ] **Step 4: PillTabs**

Open [src/renderer/panels/settings/PillTabs.tsx](src/renderer/panels/settings/PillTabs.tsx). If it enumerates the tabs (likely via a `tabs` constant or prop), add an entry for `blocked` with an appropriate icon (e.g., `ShieldOff` from lucide). Mirror the shape of the existing entries.

- [ ] **Step 5: Verify**

```bash
pnpm typecheck && pnpm lint
```

Expected: PASS.

---

### Task 19: Smoke test in the running app

No code changes. Run the app and walk through the feature end-to-end.

- [ ] **Step 1: Start the app**

```bash
pnpm start
```

- [ ] **Step 2: Verify empty state**

Open Settings → Blocked. Confirm the empty state ("No block rules yet…") and that "Add rule" opens the dialog.

- [ ] **Step 3: Add a rule manually**

From the dialog, tick "Name regex", enter `^test$`, leave retro-hide on (24h), submit. Confirm the rule appears in the table, that pattern shows correctly, and matches counter starts at 0 (or higher if any past message in the last 24h matched the regex).

- [ ] **Step 4: Right-click a message**

In any channel or DM, right-click a non-self message. Confirm the "Block sender…" item appears. Confirm the dialog opens with sensible pre-fills (DM: pubkey ticked; channel: name ticked, prefix ticked if a path is shown, pubkey only if the origin hop has a resolved pk). Cancel out without submitting.

- [ ] **Step 5: Block a sender and confirm hiding**

Block a real sender. Confirm:
- Their existing messages within the chosen retro window vanish from MessageList.
- New messages from that sender don't appear in the conversation.
- The Unreads panel doesn't surface them.
- A name-matching search doesn't return them.
- The match counter in Settings → Blocked increments as new matching messages arrive.
- No OS notification fires for matching incoming messages.

- [ ] **Step 6: Unblock and confirm restoration**

Delete the rule. Confirm matching messages reappear in MessageList immediately on the next message push.

- [ ] **Step 7: Final verification**

```bash
pnpm typecheck && pnpm lint
```

Expected: PASS.

---

## Done

When all tasks above are checked:
- Block rules persist across launches in `userData/block-rules.json`.
- Right-click → Block sender opens a dialog with ticked-by-default pre-fills.
- Each ticked identifier becomes one rule; retro-hide ON by default with a 24h window.
- Blocked messages are invisible across MessageList / Unreads / Search; notifications suppressed.
- Settings → Blocked tab lists, enables/disables, edits, and removes rules.
- Match counters bump once per first-match (not per render); counters persist on a 30s debounce.
- No automated tests added — verification is `pnpm typecheck && pnpm lint` per task plus the manual smoke test in Task 19.
