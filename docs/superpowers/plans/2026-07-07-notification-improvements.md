# Notification Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show the sender in channel notifications, deep-link a notification click to the exact channel + message, aggregate reconnect-backlog messages into per-conversation summaries, and add inline reply / mark-read / mute / clear-on-read — all cross-platform (macOS/Windows/Linux).

**Architecture:** Replace the single `src/main/notifications.ts` with a `src/main/notifications/` module split into pure, unit-testable units (`capabilities`, `format`, `policy`, `aggregator`) plus a `router` wired entirely through injected dependencies, an Electron-backed `present` seam, and an `actions` unit. Only `present.ts` and `index.ts` import `electron`; everything else is pure and node-testable with a fake presenter. Renderer changes add two `MenuAction` variants + a first-unread helper. A shared `sendMessage` helper is extracted so both the HTTP route and notification reply reuse the send path.

**Tech Stack:** TypeScript, Electron 42.4.1, Vitest (projects: `unit` node, `integration` node, `dom` jsdom), Biome, pnpm, electron-forge, `@andyshinn/meshcore-ts`, Zustand (renderer store), Hono (main API routes).

## Global Constraints

- **Package manager:** `pnpm`. Test commands: `pnpm test:unit`, `pnpm test:integration`, `pnpm test:dom`, `pnpm typecheck` (`tsc --noEmit`). Lint: `pnpm exec biome check src tests` (repo-wide `pnpm lint` fails on pre-existing build artifacts — always scope to `src tests`).
- **Worktree git:** committing needs the sandbox disabled; tests/typecheck/lint run fine sandboxed. (An executing agent handles this; the `git commit` steps below are written plainly.)
- **Test file locations (not colocated):** `tests/unit/**/*.test.ts` (node), `tests/integration/**/*.test.ts` (node, has `tests/integration/setup.ts`), `tests/component/**/*.test.tsx` (jsdom, has `tests/component/setup.ts`). Import source via relative paths, e.g. `../../../src/main/notifications/format`.
- **Platform capability matrix (verbatim — the single source of truth for `capabilities.ts`):**
  - macOS (`darwin`): subtitle ✅, groupId ✅, remove ✅, reply ✅, actions ✅
  - Windows (`win32`): subtitle ❌, groupId ✅, remove ✅, reply ✅, actions ✅
  - Linux (other): subtitle ❌, groupId ❌, remove ❌, reply ❌, actions ❌
- **Constants (exact values):** `STALE_THRESHOLD_MS = 5 * 60_000`; `SUMMARY_FLUSH_MS = 1_000`; `ROLLUP_CAP = 5`; `MAX_BODY = 240`; `DELIMITER = '—'`; `MENTION_SUFFIX = '• mention'`; `MAX_NOTIFIED_IDS = 500`.
- **Icons are out of scope** (macOS cannot show custom per-notification images). Do not add an `icon` field.
- **Channel bodies are already sender-stripped** by the library (`body = cleanBody`); the sender lives in `Message.fromPublicKeyHex` as `"name:<sender>"` or `"unknown"`. Do NOT re-strip the body. DMs put the sender pubkey in `fromPublicKeyHex` and keep the contact name as the title.
- **Commit style:** conventional commits (`feat:`, `refactor:`, `test:`, `chore:`), matching the repo history.

---

## File Structure

**New — main notification module (`src/main/notifications/`):**
- `config.ts` — the numeric/string constants above.
- `capabilities.ts` — `Capabilities` interface + `notificationCapabilities(platform)`.
- `format.ts` — pure content builders: `channelSenderName`, `truncateBody`, `buildContent`, `formatSummaryBody`.
- `policy.ts` — `Kind`, `classify`, `mentionsOwner`, `passesPolicy`.
- `aggregator.ts` — `createAggregator` (staleness + per-conversation summary state + debounce + rollup).
- `present.ts` — `NotificationSpec`, `NotificationPresenter`, `electronPresenter` (only Electron `Notification` consumer besides index).
- `actions.ts` — `NotificationActions`, `createNotificationActions` (reply / markRead / mute).
- `router.ts` — `RouterDeps`, `createNotificationRouter` (all deps injected; no electron/singleton imports).
- `index.ts` — `startNotifications()` production wiring (imports electron + singletons; subscribes the bus). Replaces the old file so `src/main/index.ts`'s `import { startNotifications } from './notifications'` keeps resolving.

**New — shared send helper:**
- `src/main/messaging/sendMessage.ts` — `createSender(deps)` + default `sendMessage`.

**Modified:**
- `src/main/notifications.ts` — DELETED (replaced by `src/main/notifications/index.ts`).
- `src/main/api/routes.ts` — POST `/api/messages/:key` uses `sendMessage`.
- `src/shared/types.ts` — `MenuAction` +2 variants; `AppSettings.notifications.summarizeBacklog`; default.
- `src/renderer/lib/utils.ts` — `firstUnreadMessageId`.
- `src/renderer/app/menuActions.ts` — `focusMessage` + `focusFirstUnread` cases.
- `src/renderer/panels/settings/app/Notifications.tsx` — `summarizeBacklog` toggle + eq field.
- `forge.config.ts` — `extendInfo.NSUserNotificationAlertStyle = 'alert'`.

**Test files:**
- `tests/unit/notifications/{capabilities,format,policy,aggregator,router}.test.ts`
- `tests/unit/messaging/send.test.ts`
- `tests/unit/notifications/actions.test.ts`
- `tests/unit/notifications/present.test.ts`
- `tests/unit/renderer/first-unread.test.ts`
- `tests/component/notifications-setting.test.tsx`
- `tests/component/menu-actions-jump.test.tsx`

---

## Task 1: Shared types — MenuAction variants + summarizeBacklog setting

**Files:**
- Modify: `src/shared/types.ts` (`MenuAction` union ~L844-868; `AppSettings.notifications` ~L349-360; `DEFAULT_APP_SETTINGS.notifications` ~L445-455)
- Test: `tests/unit/shared/notifications-defaults.test.ts` (create)

**Interfaces:**
- Produces: `MenuAction` gains `{ kind: 'focusMessage'; key: string; messageId: string }` and `{ kind: 'focusFirstUnread'; key: string }`. `AppSettings['notifications']` gains `summarizeBacklog: boolean`.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/shared/notifications-defaults.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { DEFAULT_APP_SETTINGS } from '../../../src/shared/types';

describe('notification defaults', () => {
  it('enables backlog summarization by default', () => {
    expect(DEFAULT_APP_SETTINGS.notifications.summarizeBacklog).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test:unit -- tests/unit/shared/notifications-defaults.test.ts`
Expected: FAIL (`summarizeBacklog` is `undefined`, not `true`).

- [ ] **Step 3: Add the field, default, and MenuAction variants**

In `src/shared/types.ts`, add to the `notifications` object (after `dockBadge: boolean;`):

```ts
    dockBadge: boolean;
    /** Fold messages received while disconnected (stale ts) into a single
     *  per-conversation summary instead of one banner each. */
    summarizeBacklog: boolean;
```

In `DEFAULT_APP_SETTINGS.notifications` (after `dockBadge: true,`):

```ts
    dockBadge: true,
    summarizeBacklog: true,
```

In the `MenuAction` union, add after the `focusKey` line (`| { kind: 'focusKey'; key: string }`):

```ts
  | { kind: 'focusKey'; key: string }
  // Notification click → open a conversation and scroll to a specific message.
  | { kind: 'focusMessage'; key: string; messageId: string }
  // Summary-notification click → open a conversation at its first unread message.
  | { kind: 'focusFirstUnread'; key: string }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test:unit -- tests/unit/shared/notifications-defaults.test.ts`
Expected: PASS. Then `pnpm typecheck` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/shared/types.ts tests/unit/shared/notifications-defaults.test.ts
git commit -m "feat(types): add summarizeBacklog setting + focusMessage/focusFirstUnread menu actions"
```

---

## Task 2: notifications/config.ts + capabilities.ts

**Files:**
- Create: `src/main/notifications/config.ts`, `src/main/notifications/capabilities.ts`
- Test: `tests/unit/notifications/capabilities.test.ts`

**Interfaces:**
- Produces: `interface Capabilities { subtitle: boolean; groupId: boolean; remove: boolean; reply: boolean; actions: boolean }`; `notificationCapabilities(platform: NodeJS.Platform): Capabilities`. Config constants: `STALE_THRESHOLD_MS`, `SUMMARY_FLUSH_MS`, `ROLLUP_CAP`, `MAX_BODY`, `DELIMITER`, `MENTION_SUFFIX`, `MAX_NOTIFIED_IDS`.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/notifications/capabilities.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { notificationCapabilities } from '../../../src/main/notifications/capabilities';

describe('notificationCapabilities', () => {
  it('darwin supports everything', () => {
    expect(notificationCapabilities('darwin')).toEqual({
      subtitle: true, groupId: true, remove: true, reply: true, actions: true,
    });
  });
  it('win32 supports all except subtitle', () => {
    expect(notificationCapabilities('win32')).toEqual({
      subtitle: false, groupId: true, remove: true, reply: true, actions: true,
    });
  });
  it('linux supports none of the platform-specific fields', () => {
    expect(notificationCapabilities('linux')).toEqual({
      subtitle: false, groupId: false, remove: false, reply: false, actions: false,
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test:unit -- tests/unit/notifications/capabilities.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement config + capabilities**

Create `src/main/notifications/config.ts`:

```ts
// Notification tuning constants. See docs/superpowers/specs/2026-07-06-notification-improvements-design.md.
export const STALE_THRESHOLD_MS = 5 * 60_000; // older than this ⇒ "backlog"
export const SUMMARY_FLUSH_MS = 1_000; // debounce before posting/refreshing a summary
export const ROLLUP_CAP = 5; // > this many summarized conversations ⇒ one global summary
export const MAX_BODY = 240; // notification body truncation length
export const DELIMITER = '—'; // channel/sender separator when subtitle is unavailable
export const MENTION_SUFFIX = '• mention';
export const MAX_NOTIFIED_IDS = 500; // dedup ring size
```

Create `src/main/notifications/capabilities.ts`:

```ts
// Per-platform Electron Notification capability flags. Sourced from the
// Electron 42 docs platform tags: subtitle (macOS only), groupId/remove
// (macOS+Windows), reply/actions (macOS+Windows), nothing on Linux.
export interface Capabilities {
  subtitle: boolean;
  groupId: boolean;
  remove: boolean;
  reply: boolean;
  actions: boolean;
}

export function notificationCapabilities(platform: NodeJS.Platform): Capabilities {
  if (platform === 'darwin') {
    return { subtitle: true, groupId: true, remove: true, reply: true, actions: true };
  }
  if (platform === 'win32') {
    return { subtitle: false, groupId: true, remove: true, reply: true, actions: true };
  }
  return { subtitle: false, groupId: false, remove: false, reply: false, actions: false };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test:unit -- tests/unit/notifications/capabilities.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/notifications/config.ts src/main/notifications/capabilities.ts tests/unit/notifications/capabilities.test.ts
git commit -m "feat(notifications): add config constants + platform capability matrix"
```

---

## Task 3: notifications/format.ts

**Files:**
- Create: `src/main/notifications/format.ts`
- Test: `tests/unit/notifications/format.test.ts`

**Interfaces:**
- Consumes: `Capabilities` (Task 2).
- Produces:
  - `channelSenderName(fromPublicKeyHex: string | undefined): string`
  - `truncateBody(body: string): string`
  - `interface Content { title: string; subtitle?: string; body: string }`
  - `interface ContentInput { isChannel: boolean; displayName: string; senderName: string; mention: boolean; body: string; caps: Capabilities }`
  - `buildContent(input: ContentInput): Content`
  - `formatSummaryBody(count: number, senders: string[]): string`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/notifications/format.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { notificationCapabilities } from '../../../src/main/notifications/capabilities';
import { buildContent, channelSenderName, formatSummaryBody, truncateBody } from '../../../src/main/notifications/format';

const mac = notificationCapabilities('darwin');
const win = notificationCapabilities('win32');

describe('channelSenderName', () => {
  it('strips the name: prefix', () => expect(channelSenderName('name:Alice')).toBe('Alice'));
  it('is empty for unknown/self', () => {
    expect(channelSenderName('unknown')).toBe('');
    expect(channelSenderName(undefined)).toBe('');
  });
  it('shortens a raw pubkey', () => expect(channelSenderName('abcdef0123456789')).toBe('abcdef01…'));
});

describe('truncateBody', () => {
  it('leaves short bodies alone', () => expect(truncateBody('hi')).toBe('hi'));
  it('truncates long bodies to 240 with an ellipsis', () => {
    const out = truncateBody('x'.repeat(300));
    expect(out.length).toBe(238);
    expect(out.endsWith('…')).toBe(true);
  });
});

describe('buildContent — channel', () => {
  it('macOS: channel title + sender subtitle', () => {
    expect(buildContent({ isChannel: true, displayName: '#general', senderName: 'Alice', mention: false, body: 'hi', caps: mac }))
      .toEqual({ title: '#general', subtitle: 'Alice', body: 'hi' });
  });
  it('macOS mention: appends the mention marker to the title, sender stays in subtitle', () => {
    expect(buildContent({ isChannel: true, displayName: '#general', senderName: 'Alice', mention: true, body: 'hi', caps: mac }))
      .toEqual({ title: '#general • mention', subtitle: 'Alice', body: 'hi' });
  });
  it('Windows: folds sender into the title with a delimiter, no subtitle', () => {
    expect(buildContent({ isChannel: true, displayName: '#general', senderName: 'Alice', mention: false, body: 'hi', caps: win }))
      .toEqual({ title: '#general — Alice', body: 'hi' });
  });
  it('Windows mention: delimiter + mention marker', () => {
    expect(buildContent({ isChannel: true, displayName: '#general', senderName: 'Alice', mention: true, body: 'hi', caps: win }))
      .toEqual({ title: '#general — Alice • mention', body: 'hi' });
  });
  it('no sender: bare channel title', () => {
    expect(buildContent({ isChannel: true, displayName: '#general', senderName: '', mention: false, body: 'hi', caps: win }))
      .toEqual({ title: '#general', body: 'hi' });
  });
});

describe('buildContent — DM', () => {
  it('uses the contact name as title with no subtitle on any platform', () => {
    expect(buildContent({ isChannel: false, displayName: 'Alice', senderName: '', mention: false, body: 'hi', caps: mac }))
      .toEqual({ title: 'Alice', body: 'hi' });
  });
});

describe('formatSummaryBody', () => {
  it('no senders', () => expect(formatSummaryBody(12, [])).toBe('12 new messages'));
  it('singular', () => expect(formatSummaryBody(1, [])).toBe('1 new message'));
  it('lists up to two senders then +N', () => {
    expect(formatSummaryBody(8, ['Alice', 'Bob', 'Carol', 'Dan'])).toBe('8 messages from Alice, Bob +2');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test:unit -- tests/unit/notifications/format.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement format.ts**

Create `src/main/notifications/format.ts`:

```ts
import type { Capabilities } from './capabilities';
import { DELIMITER, MAX_BODY, MENTION_SUFFIX } from './config';

// Mirror of the renderer's deriveSenderName (src/renderer/lib/utils.ts): channel
// messages carry no pubkey, so the origin node's display name is encoded as
// fromPublicKeyHex = "name:<name>". Kept as a local copy to avoid a
// renderer→main import; the logic is trivial and stable.
export function channelSenderName(fromPublicKeyHex: string | undefined): string {
  if (!fromPublicKeyHex || fromPublicKeyHex === 'unknown') return '';
  if (fromPublicKeyHex.startsWith('name:')) return fromPublicKeyHex.slice(5);
  return `${fromPublicKeyHex.slice(0, 8)}…`;
}

export function truncateBody(body: string): string {
  return body.length > MAX_BODY ? `${body.slice(0, MAX_BODY - 3)}…` : body;
}

export interface Content {
  title: string;
  subtitle?: string;
  body: string;
}

export interface ContentInput {
  isChannel: boolean;
  displayName: string;
  senderName: string; // '' when none (unknown / self) or for DMs
  mention: boolean;
  body: string;
  caps: Capabilities;
}

export function buildContent(input: ContentInput): Content {
  const body = truncateBody(input.body);
  if (!input.isChannel) {
    // DM: the contact name IS the sender, and it's already the title.
    return { title: input.displayName, body };
  }
  const mentionPart = input.mention ? ` ${MENTION_SUFFIX}` : '';
  if (input.caps.subtitle && input.senderName) {
    return { title: `${input.displayName}${mentionPart}`, subtitle: input.senderName, body };
  }
  const senderPart = input.senderName ? ` ${DELIMITER} ${input.senderName}` : '';
  return { title: `${input.displayName}${senderPart}${mentionPart}`, body };
}

export function formatSummaryBody(count: number, senders: string[]): string {
  if (senders.length === 0) {
    return `${count} new ${count === 1 ? 'message' : 'messages'}`;
  }
  const shown = senders.slice(0, 2);
  const extra = senders.length - shown.length;
  const names = extra > 0 ? `${shown.join(', ')} +${extra}` : shown.join(', ');
  return `${count} ${count === 1 ? 'message' : 'messages'} from ${names}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test:unit -- tests/unit/notifications/format.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/notifications/format.ts tests/unit/notifications/format.test.ts
git commit -m "feat(notifications): platform-aware notification content formatting"
```

---

## Task 4: notifications/policy.ts

**Files:**
- Create: `src/main/notifications/policy.ts`
- Test: `tests/unit/notifications/policy.test.ts`

**Interfaces:**
- Consumes: `Message`, `ContactKind`, `AppSettings` from `src/shared/types`.
- Produces:
  - `type Kind = 'directMessage' | 'channelMention' | 'channelMessage' | 'repeaterAlert' | 'sensorAlert'`
  - `mentionsOwner(body: string, ownerName: string): boolean`
  - `classify(m: Message, ownerName: string | undefined, contactKind: ContactKind | undefined): Kind`
  - `interface PolicyArgs { msg: Message; notifications: AppSettings['notifications']; ownerName: string | undefined; contactKind: ContactKind | undefined; muted: boolean; blocked: boolean; focused: boolean }`
  - `passesPolicy(a: PolicyArgs): { show: boolean; kind: Kind }`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/notifications/policy.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { AppSettings, Message } from '../../../src/shared/types';
import { DEFAULT_APP_SETTINGS } from '../../../src/shared/types';
import { classify, mentionsOwner, passesPolicy } from '../../../src/main/notifications/policy';

const notif: AppSettings['notifications'] = DEFAULT_APP_SETTINGS.notifications;
const msg = (over: Partial<Message>): Message => ({ id: 'm1', key: 'ch:general', body: 'hi', ts: 1, state: 'received', ...over });

describe('mentionsOwner', () => {
  it('matches @name, @[name], and a bare word', () => {
    expect(mentionsOwner('hey @bob', 'bob')).toBe(true);
    expect(mentionsOwner('hey @[bob] there', 'bob')).toBe(true);
    expect(mentionsOwner('bob around?', 'bob')).toBe(true);
    expect(mentionsOwner('bobby', 'bob')).toBe(false);
  });
});

describe('classify', () => {
  it('channel mention vs message', () => {
    expect(classify(msg({ body: 'yo @bob' }), 'bob', undefined)).toBe('channelMention');
    expect(classify(msg({ body: 'yo' }), 'bob', undefined)).toBe('channelMessage');
  });
  it('DM kinds by contact kind', () => {
    expect(classify(msg({ key: 'c:aa' }), 'bob', 'chat')).toBe('directMessage');
    expect(classify(msg({ key: 'c:aa' }), 'bob', 'repeater')).toBe('repeaterAlert');
    expect(classify(msg({ key: 'c:aa' }), 'bob', 'sensor')).toBe('sensorAlert');
  });
});

describe('passesPolicy', () => {
  const base = { notifications: notif, ownerName: 'bob', contactKind: undefined, muted: false, blocked: false, focused: false };
  it('shows a DM by default', () => {
    expect(passesPolicy({ ...base, msg: msg({ key: 'c:aa' }), contactKind: 'chat' }).show).toBe(true);
  });
  it('drops non-received', () => {
    expect(passesPolicy({ ...base, msg: msg({ key: 'c:aa', state: 'sending' }), contactKind: 'chat' }).show).toBe(false);
  });
  it('drops blocked, muted, and disabled-kind', () => {
    expect(passesPolicy({ ...base, msg: msg({ key: 'c:aa' }), contactKind: 'chat', blocked: true }).show).toBe(false);
    expect(passesPolicy({ ...base, msg: msg({ key: 'c:aa' }), contactKind: 'chat', muted: true }).show).toBe(false);
    // channelMessage is false by default
    expect(passesPolicy({ ...base, msg: msg({ body: 'yo' }) }).show).toBe(false);
  });
  it('suppresses when focused on the conversation', () => {
    expect(passesPolicy({ ...base, msg: msg({ key: 'c:aa' }), contactKind: 'chat', focused: true }).show).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test:unit -- tests/unit/notifications/policy.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement policy.ts** (lifts `classify`/`mentionsOwner`/`escapeRegExp` from the old `notifications.ts`, adds `passesPolicy`)

Create `src/main/notifications/policy.ts`:

```ts
import type { AppSettings, ContactKind, Message } from '../../shared/types';

export type Kind = 'directMessage' | 'channelMention' | 'channelMessage' | 'repeaterAlert' | 'sensorAlert';

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Mention detection: @name, @[name], or the bare owner name on a word
// boundary. Case-insensitive.
export function mentionsOwner(body: string, ownerName: string): boolean {
  const lower = body.toLowerCase();
  const target = ownerName.toLowerCase();
  if (lower.includes(`@${target}`)) return true;
  if (lower.includes(`@[${target}]`)) return true;
  return new RegExp(`\\b${escapeRegExp(target)}\\b`, 'i').test(body);
}

export function classify(m: Message, ownerName: string | undefined, contactKind: ContactKind | undefined): Kind {
  if (m.key.startsWith('c:')) {
    if (contactKind === 'repeater') return 'repeaterAlert';
    if (contactKind === 'sensor') return 'sensorAlert';
    return 'directMessage';
  }
  if (m.key.startsWith('ch:')) {
    if (ownerName && mentionsOwner(m.body, ownerName)) return 'channelMention';
    return 'channelMessage';
  }
  return 'directMessage';
}

export interface PolicyArgs {
  msg: Message;
  notifications: AppSettings['notifications'];
  ownerName: string | undefined;
  contactKind: ContactKind | undefined;
  muted: boolean;
  blocked: boolean;
  /** True when the app window is focused AND the user is viewing this key. */
  focused: boolean;
}

export function passesPolicy(a: PolicyArgs): { show: boolean; kind: Kind } {
  const kind = classify(a.msg, a.ownerName, a.contactKind);
  if (a.msg.state !== 'received') return { show: false, kind };
  if (a.blocked) return { show: false, kind };
  if (a.muted) return { show: false, kind };
  if (!a.notifications[kind]) return { show: false, kind };
  if (a.notifications.suppressWhenFocused && a.focused) return { show: false, kind };
  return { show: true, kind };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test:unit -- tests/unit/notifications/policy.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/notifications/policy.ts tests/unit/notifications/policy.test.ts
git commit -m "feat(notifications): pure classify + passesPolicy gate"
```

---

## Task 5: notifications/aggregator.ts

**Files:**
- Create: `src/main/notifications/aggregator.ts`
- Test: `tests/unit/notifications/aggregator.test.ts`

**Interfaces:**
- Consumes: `Message` from `src/shared/types`; `AggregatorConfig` values from `config.ts`.
- Produces:
  - `interface StaleDescriptor { key: string; count: number; senders: string[]; lastTs: number }`
  - `interface AggregatorConfig { staleThresholdMs: number; flushDelayMs: number; rollupCap: number }`
  - `interface AggregatorCallbacks { onIndividual(msg: Message): void; onSummaries(summaries: StaleDescriptor[]): void; onGlobalSummary(info: { total: number; conversationCount: number; lastKey: string }): void }`
  - `interface Aggregator { ingest(msg: Message, senderName: string): void; clear(key: string): void; reset(): void }`
  - `createAggregator(deps: { now(): number; config: AggregatorConfig; callbacks: AggregatorCallbacks }): Aggregator`

Behavior: `ingest` classifies fresh (`now - msg.ts <= staleThresholdMs`) → `onIndividual(msg)`; stale → accumulate `{count, senders, lastTs}` per `msg.key`, remember `lastKey`, and (re)start a single `flushDelayMs` debounce. On flush: if no stale keys, do nothing; if `keys ≤ rollupCap` → `onSummaries(descriptors)`; else → `onGlobalSummary`. State persists across flushes (so counts grow) until `clear(key)` or `reset()`.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/notifications/aggregator.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Message } from '../../../src/shared/types';
import { createAggregator, type StaleDescriptor } from '../../../src/main/notifications/aggregator';

const NOW = 1_000_000_000_000;
const config = { staleThresholdMs: 5 * 60_000, flushDelayMs: 1_000, rollupCap: 5 };
const msg = (over: Partial<Message>): Message => ({ id: 'm', key: 'ch:a', body: 'hi', ts: NOW, state: 'received', ...over });

function harness() {
  const individual: Message[] = [];
  const summaries: StaleDescriptor[][] = [];
  const globals: Array<{ total: number; conversationCount: number; lastKey: string }> = [];
  const agg = createAggregator({
    now: () => NOW,
    config,
    callbacks: {
      onIndividual: (m) => individual.push(m),
      onSummaries: (s) => summaries.push(s),
      onGlobalSummary: (g) => globals.push(g),
    },
  });
  return { agg, individual, summaries, globals };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('aggregator', () => {
  it('fires fresh messages individually and immediately', () => {
    const h = harness();
    h.agg.ingest(msg({ id: 'm1', ts: NOW - 1_000 }), 'Alice');
    expect(h.individual).toHaveLength(1);
    expect(h.summaries).toHaveLength(0);
  });

  it('debounces stale messages into one per-conversation summary', () => {
    const h = harness();
    const stale = NOW - 10 * 60_000;
    h.agg.ingest(msg({ id: 'm1', key: 'ch:a', ts: stale }), 'Alice');
    h.agg.ingest(msg({ id: 'm2', key: 'ch:a', ts: stale }), 'Bob');
    h.agg.ingest(msg({ id: 'm3', key: 'c:x', ts: stale }), '');
    expect(h.summaries).toHaveLength(0); // still debouncing
    vi.advanceTimersByTime(1_000);
    expect(h.individual).toHaveLength(0);
    expect(h.summaries).toHaveLength(1);
    const byKey = Object.fromEntries(h.summaries[0].map((d) => [d.key, d]));
    expect(byKey['ch:a']).toMatchObject({ count: 2, senders: ['Alice', 'Bob'] });
    expect(byKey['c:x']).toMatchObject({ count: 1, senders: [] });
  });

  it('rolls up into a global summary past the cap', () => {
    const h = harness();
    const stale = NOW - 10 * 60_000;
    for (let i = 0; i < 6; i++) h.agg.ingest(msg({ id: `m${i}`, key: `ch:${i}`, ts: stale }), 'S');
    vi.advanceTimersByTime(1_000);
    expect(h.summaries).toHaveLength(0);
    expect(h.globals).toEqual([{ total: 6, conversationCount: 6, lastKey: 'ch:5' }]);
  });

  it('clear(key) drops a conversation from later summaries', () => {
    const h = harness();
    const stale = NOW - 10 * 60_000;
    h.agg.ingest(msg({ id: 'm1', key: 'ch:a', ts: stale }), 'Alice');
    h.agg.clear('ch:a');
    vi.advanceTimersByTime(1_000);
    expect(h.summaries).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test:unit -- tests/unit/notifications/aggregator.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement aggregator.ts**

Create `src/main/notifications/aggregator.ts`:

```ts
import type { Message } from '../../shared/types';

export interface StaleDescriptor {
  key: string;
  count: number;
  senders: string[];
  lastTs: number;
}

export interface AggregatorConfig {
  staleThresholdMs: number;
  flushDelayMs: number;
  rollupCap: number;
}

export interface AggregatorCallbacks {
  onIndividual(msg: Message): void;
  onSummaries(summaries: StaleDescriptor[]): void;
  onGlobalSummary(info: { total: number; conversationCount: number; lastKey: string }): void;
}

export interface Aggregator {
  ingest(msg: Message, senderName: string): void;
  clear(key: string): void;
  reset(): void;
}

interface Entry {
  count: number;
  senders: Set<string>;
  lastTs: number;
}

export function createAggregator(deps: {
  now(): number;
  config: AggregatorConfig;
  callbacks: AggregatorCallbacks;
}): Aggregator {
  const { now, config, callbacks } = deps;
  const entries = new Map<string, Entry>();
  let lastKey = '';
  let timer: ReturnType<typeof setTimeout> | null = null;

  function scheduleFlush(): void {
    if (timer) clearTimeout(timer);
    timer = setTimeout(flush, config.flushDelayMs);
  }

  function flush(): void {
    timer = null;
    if (entries.size === 0) return;
    if (entries.size <= config.rollupCap) {
      const summaries: StaleDescriptor[] = [];
      for (const [key, e] of entries) {
        summaries.push({ key, count: e.count, senders: [...e.senders], lastTs: e.lastTs });
      }
      callbacks.onSummaries(summaries);
      return;
    }
    let total = 0;
    for (const e of entries.values()) total += e.count;
    callbacks.onGlobalSummary({ total, conversationCount: entries.size, lastKey });
  }

  return {
    ingest(msg, senderName) {
      if (now() - msg.ts <= config.staleThresholdMs) {
        callbacks.onIndividual(msg);
        return;
      }
      const entry = entries.get(msg.key) ?? { count: 0, senders: new Set<string>(), lastTs: 0 };
      entry.count += 1;
      if (senderName) entry.senders.add(senderName);
      entry.lastTs = Math.max(entry.lastTs, msg.ts);
      entries.set(msg.key, entry);
      lastKey = msg.key;
      scheduleFlush();
    },
    clear(key) {
      entries.delete(key);
    },
    reset() {
      entries.clear();
      lastKey = '';
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test:unit -- tests/unit/notifications/aggregator.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/notifications/aggregator.ts tests/unit/notifications/aggregator.test.ts
git commit -m "feat(notifications): staleness aggregator with debounced summaries + rollup"
```

---

## Task 6: renderer first-unread helper

**Files:**
- Modify: `src/renderer/lib/utils.ts`
- Test: `tests/unit/renderer/first-unread.test.ts`

**Interfaces:**
- Produces: `firstUnreadMessageId(messages: Message[], lastRead: number): string | null` — returns the id of the earliest message with `ts > lastRead` that has a sender (`fromPublicKeyHex !== undefined`, i.e. not owner-sent), else `null`.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/renderer/first-unread.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { Message } from '../../../src/shared/types';
import { firstUnreadMessageId } from '../../../src/renderer/lib/utils';

const m = (id: string, ts: number, over: Partial<Message> = {}): Message => ({
  id, key: 'ch:a', body: 'x', ts, state: 'received', fromPublicKeyHex: 'name:Alice', ...over,
});

describe('firstUnreadMessageId', () => {
  it('returns the earliest message newer than lastRead', () => {
    const msgs = [m('a', 10), m('b', 20), m('c', 30)];
    expect(firstUnreadMessageId(msgs, 15)).toBe('b');
  });
  it('skips owner-sent messages (no fromPublicKeyHex)', () => {
    const msgs = [m('self', 20, { fromPublicKeyHex: undefined }), m('b', 25)];
    expect(firstUnreadMessageId(msgs, 15)).toBe('b');
  });
  it('returns null when all read', () => {
    expect(firstUnreadMessageId([m('a', 10)], 50)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test:unit -- tests/unit/renderer/first-unread.test.ts`
Expected: FAIL (`firstUnreadMessageId` not exported).

- [ ] **Step 3: Add the helper**

Append to `src/renderer/lib/utils.ts`:

```ts
import type { Message } from '../../shared/types';

// The earliest unread message worth jumping to: ts beyond the last-read marker
// and sent by someone other than the owner (owner-sent rows have no
// fromPublicKeyHex). Used by the notification "focusFirstUnread" action.
export function firstUnreadMessageId(messages: Message[], lastRead: number): string | null {
  for (const m of messages) {
    if (m.ts > lastRead && m.fromPublicKeyHex !== undefined) return m.id;
  }
  return null;
}
```

(Add the `import type { Message }` at the top of the file with the other imports.)

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test:unit -- tests/unit/renderer/first-unread.test.ts`
Expected: PASS. Then `pnpm typecheck` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/lib/utils.ts tests/unit/renderer/first-unread.test.ts
git commit -m "feat(renderer): firstUnreadMessageId helper for notification jump"
```

---

## Task 7: Extract shared sendMessage helper + route swap

**Files:**
- Create: `src/main/messaging/sendMessage.ts`
- Modify: `src/main/api/routes.ts` (POST `/api/messages/:key`, ~L617-668)
- Test: `tests/unit/messaging/send.test.ts`

**Interfaces:**
- Produces:
  - `interface SendResult { ok: boolean; id: string; error?: string }`
  - `interface SenderDeps { getSession(): { sendChannelText(key: string, text: string): Promise<{ ok: boolean; error?: string; channelHash?: number }>; sendDmTextWithRetry(key: string, text: string, id: string): Promise<{ ok: boolean; error?: string }>; registerChannelSend(p: { messageId: string; channelHash: number }): void }; getHolder(): { insertMessage(m: { id: string; key: string; body: string; ts: number; state: 'sending' }): void; setMessageState(id: string, state: 'sent' | 'failed'): void; getMessagesForKey(key: string): unknown[] }; emitMessages(key: string, messages: unknown[]): void; emitMessageState(id: string, state: 'sent' | 'failed'): void; now(): number; genId(): string }`
  - `createSender(deps: SenderDeps): (key: string, body: string) => Promise<SendResult>`
  - `sendMessage(key: string, body: string): Promise<SendResult>` (default bound to real singletons)

- [ ] **Step 1: Write the failing test**

Create `tests/unit/messaging/send.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { createSender } from '../../../src/main/messaging/sendMessage';

function harness(over: { channelOk?: boolean; channelHash?: number } = {}) {
  const inserted: unknown[] = [];
  const states: Array<{ id: string; state: string }> = [];
  const registered: unknown[] = [];
  const session = {
    sendChannelText: vi.fn(async () => ({ ok: over.channelOk ?? true, channelHash: over.channelHash })),
    sendDmTextWithRetry: vi.fn(async () => ({ ok: true })),
    registerChannelSend: vi.fn((p: unknown) => registered.push(p)),
  };
  const holder = {
    insertMessage: (m: unknown) => inserted.push(m),
    setMessageState: (id: string, state: string) => states.push({ id, state }),
    getMessagesForKey: () => inserted,
  };
  const send = createSender({
    getSession: () => session,
    getHolder: () => holder,
    emitMessages: vi.fn(),
    emitMessageState: vi.fn(),
    now: () => 1000,
    genId: () => 'local-test',
  });
  return { send, session, inserted, states, registered };
}

describe('createSender', () => {
  it('channel: inserts optimistically, sends, marks sent, registers the send', async () => {
    const h = harness({ channelOk: true, channelHash: 42 });
    const res = await h.send('ch:General', 'hi');
    expect(res).toEqual({ ok: true, id: 'local-test' });
    expect(h.inserted[0]).toMatchObject({ id: 'local-test', key: 'ch:General', body: 'hi', state: 'sending' });
    expect(h.session.sendChannelText).toHaveBeenCalledWith('ch:General', 'hi');
    expect(h.states).toContainEqual({ id: 'local-test', state: 'sent' });
    expect(h.registered).toEqual([{ messageId: 'local-test', channelHash: 42 }]);
  });

  it('channel failure marks failed and returns the error', async () => {
    const h = harness({ channelOk: false });
    const res = await h.send('ch:General', 'hi');
    expect(res.ok).toBe(false);
    expect(h.states).toContainEqual({ id: 'local-test', state: 'failed' });
  });

  it('DM: inserts optimistically and dispatches the retry send', async () => {
    const h = harness();
    const res = await h.send('c:abcd', 'yo');
    expect(res).toEqual({ ok: true, id: 'local-test' });
    expect(h.session.sendDmTextWithRetry).toHaveBeenCalledWith('c:abcd', 'yo', 'local-test');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test:unit -- tests/unit/messaging/send.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement sendMessage.ts**

Create `src/main/messaging/sendMessage.ts`:

```ts
import { emit } from '../events/bus';
import { protocolSession } from '../protocol';
import { stateHolder } from '../state/holder';

export interface SendResult {
  ok: boolean;
  id: string;
  error?: string;
}

interface Session {
  sendChannelText(key: string, text: string): Promise<{ ok: boolean; error?: string; channelHash?: number }>;
  sendDmTextWithRetry(key: string, text: string, id: string): Promise<{ ok: boolean; error?: string }>;
  registerChannelSend(p: { messageId: string; channelHash: number }): void;
}

interface Holder {
  insertMessage(m: { id: string; key: string; body: string; ts: number; state: 'sending' }): void;
  setMessageState(id: string, state: 'sent' | 'failed'): void;
  getMessagesForKey(key: string): unknown[];
}

export interface SenderDeps {
  getSession(): Session;
  getHolder(): Holder;
  emitMessages(key: string, messages: unknown[]): void;
  emitMessageState(id: string, state: 'sent' | 'failed'): void;
  now(): number;
  genId(): string;
}

// Optimistically records the outgoing message, hands it to the protocol session
// for TX, and drives the state transitions. Extracted from POST /api/messages so
// the notification inline-reply handler reuses the exact same path.
export function createSender(deps: SenderDeps): (key: string, body: string) => Promise<SendResult> {
  return async (key, body) => {
    const holder = deps.getHolder();
    const session = deps.getSession();
    const id = deps.genId();
    holder.insertMessage({ id, key, body, ts: deps.now(), state: 'sending' });
    deps.emitMessages(key, holder.getMessagesForKey(key));

    if (key.startsWith('ch:')) {
      const result = await session.sendChannelText(key, body);
      const nextState = result.ok ? 'sent' : 'failed';
      holder.setMessageState(id, nextState);
      deps.emitMessageState(id, nextState);
      if (result.ok && result.channelHash != null) {
        session.registerChannelSend({ messageId: id, channelHash: result.channelHash });
      }
      return { ok: result.ok, id, error: result.error };
    }

    // DM: return after the first write; the retry loop runs in the background.
    session.sendDmTextWithRetry(key, body, id).catch(() => {
      holder.setMessageState(id, 'failed');
      deps.emitMessageState(id, 'failed');
    });
    return { ok: true, id };
  };
}

export const sendMessage = createSender({
  getSession: () => protocolSession(),
  getHolder: () => stateHolder(),
  emitMessages: (key, messages) => emit.messages(key, messages as never),
  emitMessageState: (id, state) => emit.messageState(id, state),
  now: () => Date.now(),
  genId: () => `local-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test:unit -- tests/unit/messaging/send.test.ts`
Expected: PASS.

- [ ] **Step 5: Swap the route to use sendMessage**

In `src/main/api/routes.ts`, replace the body of the POST `/api/messages/:key` handler (the block from `const holder = stateHolder();` through the DM `return c.json({ ok: true, id });`, ~L626-667) with:

```ts
    const result = await sendMessage(key, body.body);
    if (key.startsWith('ch:')) {
      return result.ok ? c.json({ ok: true, id: result.id }) : c.json({ error: result.error }, 503);
    }
    return c.json({ ok: true, id: result.id });
```

Add the import near the other main imports at the top of `routes.ts`:

```ts
import { sendMessage } from '../messaging/sendMessage';
```

Leave the validation above it (`if (!key.startsWith('ch:') && !key.startsWith('c:'))` and the `body` JSON check) untouched. If `protocolSession`, `emit`, or `log` become unused in this file after the swap, remove only the now-unused imports (verify with `pnpm exec biome check src tests`).

- [ ] **Step 6: Verify the route still typechecks and lints**

Run: `pnpm typecheck` → PASS. Run: `pnpm exec biome check src tests` → PASS.

- [ ] **Step 7: Commit**

```bash
git add src/main/messaging/sendMessage.ts src/main/api/routes.ts tests/unit/messaging/send.test.ts
git commit -m "refactor(messaging): extract shared sendMessage helper; route reuses it"
```

---

## Task 8: notifications/actions.ts

**Files:**
- Create: `src/main/notifications/actions.ts`
- Test: `tests/unit/notifications/actions.test.ts`

**Interfaces:**
- Consumes: `Channel`, `Contact`, `UiState` from `src/shared/types`.
- Produces:
  - `interface NotificationActions { reply(key: string, text: string): Promise<void>; markRead(key: string): void; mute(key: string): void }`
  - `interface ActionDeps { sendMessage(key: string, body: string): Promise<unknown>; getChannels(): Channel[]; getContacts(): Contact[]; upsertChannel(c: Channel): void; upsertContact(c: Contact): void; emitChannels(): void; emitContacts(): void; getUiState(): UiState; setUiState(u: UiState): void; emitUiState(u: UiState): void; now(): number }`
  - `createNotificationActions(deps: ActionDeps): NotificationActions`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/notifications/actions.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import type { Channel, Contact, UiState } from '../../../src/shared/types';
import { createNotificationActions, type ActionDeps } from '../../../src/main/notifications/actions';

const channel = (over: Partial<Channel> = {}): Channel => ({ key: 'ch:General', name: 'General', kind: 'public', ...over });
const contact = (over: Partial<Contact> = {}): Contact => ({ key: 'c:aa', publicKeyHex: 'aa', name: 'Alice', kind: 'chat', ...over });

function harness(over: Partial<ActionDeps> = {}) {
  const channels: Channel[] = [channel()];
  const contacts: Contact[] = [contact()];
  let ui: UiState = { lastReadByKey: {} } as UiState;
  const deps: ActionDeps = {
    sendMessage: vi.fn(async () => ({ ok: true })),
    getChannels: () => channels,
    getContacts: () => contacts,
    upsertChannel: (c) => { const i = channels.findIndex((x) => x.key === c.key); channels[i] = c; },
    upsertContact: (c) => { const i = contacts.findIndex((x) => x.key === c.key); contacts[i] = c; },
    emitChannels: vi.fn(),
    emitContacts: vi.fn(),
    getUiState: () => ui,
    setUiState: (u) => { ui = u; },
    emitUiState: vi.fn(),
    now: () => 5000,
    ...over,
  };
  return { actions: createNotificationActions(deps), deps, channels, contacts, getUi: () => ui };
}

describe('notification actions', () => {
  it('reply delegates to sendMessage', async () => {
    const h = harness();
    await h.actions.reply('ch:General', 'hello');
    expect(h.deps.sendMessage).toHaveBeenCalledWith('ch:General', 'hello');
  });

  it('markRead advances lastReadByKey and emits uiState', () => {
    const h = harness();
    h.actions.markRead('ch:General');
    expect(h.getUi().lastReadByKey['ch:General']).toBe(5000);
    expect(h.deps.emitUiState).toHaveBeenCalledWith(h.getUi());
  });

  it('mute sets the channel muted flag and emits channels', () => {
    const h = harness();
    h.actions.mute('ch:General');
    expect(h.channels[0].muted).toBe(true);
    expect(h.deps.emitChannels).toHaveBeenCalled();
  });

  it('mute sets the contact muted flag and emits contacts', () => {
    const h = harness();
    h.actions.mute('c:aa');
    expect(h.contacts[0].muted).toBe(true);
    expect(h.deps.emitContacts).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test:unit -- tests/unit/notifications/actions.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement actions.ts**

Create `src/main/notifications/actions.ts`:

```ts
import type { Channel, Contact, UiState } from '../../shared/types';

export interface NotificationActions {
  reply(key: string, text: string): Promise<void>;
  markRead(key: string): void;
  mute(key: string): void;
}

export interface ActionDeps {
  sendMessage(key: string, body: string): Promise<unknown>;
  getChannels(): Channel[];
  getContacts(): Contact[];
  upsertChannel(c: Channel): void;
  upsertContact(c: Contact): void;
  emitChannels(): void;
  emitContacts(): void;
  getUiState(): UiState;
  setUiState(u: UiState): void;
  emitUiState(u: UiState): void;
  now(): number;
}

export function createNotificationActions(deps: ActionDeps): NotificationActions {
  return {
    async reply(key, text) {
      await deps.sendMessage(key, text);
    },
    markRead(key) {
      const ui = deps.getUiState();
      const next: UiState = { ...ui, lastReadByKey: { ...ui.lastReadByKey, [key]: deps.now() } };
      deps.setUiState(next);
      deps.emitUiState(next);
    },
    mute(key) {
      if (key.startsWith('ch:')) {
        const ch = deps.getChannels().find((c) => c.key === key);
        if (!ch) return;
        deps.upsertChannel({ ...ch, muted: true });
        deps.emitChannels();
        return;
      }
      const contact = deps.getContacts().find((c) => c.key === key);
      if (!contact) return;
      deps.upsertContact({ ...contact, muted: true });
      deps.emitContacts();
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test:unit -- tests/unit/notifications/actions.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/notifications/actions.ts tests/unit/notifications/actions.test.ts
git commit -m "feat(notifications): reply/markRead/mute action handlers"
```

---

## Task 9: notifications/present.ts (Electron presenter)

**Files:**
- Create: `src/main/notifications/present.ts`
- Test: `tests/unit/notifications/present.test.ts`

**Interfaces:**
- Consumes: `Capabilities` (Task 2); Electron `Notification`.
- Produces:
  - `interface NotificationSpec { id?: string; groupId?: string; title: string; subtitle?: string; body: string; silent: boolean; reply?: boolean; replyPlaceholder?: string; actions?: string[]; onClick?(): void; onReply?(text: string): void; onAction?(index: number): void }`
  - `interface NotificationPresenter { isSupported(): boolean; show(spec: NotificationSpec): void; clearGroup(groupId: string): void }`
  - `electronPresenter(deps: { caps: Capabilities; focusWindow(): void }): NotificationPresenter`

- [ ] **Step 1: Write the failing test** (mocks `electron` to capture constructor options + events)

Create `tests/unit/notifications/present.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

const shown: Array<Record<string, unknown>> = [];
const removedGroups: string[] = [];
const handlers: Record<string, Array<(...a: unknown[]) => void>> = {};

class FakeNotification {
  static isSupported() { return true; }
  static removeGroup(g: string) { removedGroups.push(g); }
  opts: Record<string, unknown>;
  constructor(opts: Record<string, unknown>) { this.opts = opts; }
  on(event: string, cb: (...a: unknown[]) => void) { (handlers[event] ??= []).push(cb); return this; }
  show() { shown.push(this.opts); }
}

vi.mock('electron', () => ({ Notification: FakeNotification }));

import { notificationCapabilities } from '../../../src/main/notifications/capabilities';
import { electronPresenter } from '../../../src/main/notifications/present';

beforeEach(() => {
  shown.length = 0;
  removedGroups.length = 0;
  for (const k of Object.keys(handlers)) delete handlers[k];
});

describe('electronPresenter', () => {
  it('macOS: maps subtitle, groupId, hasReply, and actions', () => {
    const focusWindow = vi.fn();
    const p = electronPresenter({ caps: notificationCapabilities('darwin'), focusWindow });
    const onClick = vi.fn();
    p.show({ id: 'msg:1', groupId: 'ch:a', title: 'T', subtitle: 'Alice', body: 'hi', silent: false, reply: true, actions: ['Mark as read', 'Mute'], onClick });
    expect(shown[0]).toMatchObject({
      id: 'msg:1', groupId: 'ch:a', title: 'T', subtitle: 'Alice', body: 'hi', silent: false, hasReply: true,
      actions: [{ type: 'button', text: 'Mark as read' }, { type: 'button', text: 'Mute' }],
    });
    handlers.click[0]();
    expect(focusWindow).toHaveBeenCalled();
    expect(onClick).toHaveBeenCalled();
  });

  it('Linux: drops subtitle, groupId, hasReply, actions', () => {
    const p = electronPresenter({ caps: notificationCapabilities('linux'), focusWindow: vi.fn() });
    p.show({ groupId: 'ch:a', title: 'T', subtitle: 'Alice', body: 'hi', silent: true, reply: true, actions: ['Mute'] });
    expect(shown[0].subtitle).toBeUndefined();
    expect(shown[0].groupId).toBeUndefined();
    expect(shown[0].hasReply).toBeUndefined();
    expect(shown[0].actions).toBeUndefined();
  });

  it('clearGroup calls removeGroup where supported and no-ops otherwise', () => {
    electronPresenter({ caps: notificationCapabilities('darwin'), focusWindow: vi.fn() }).clearGroup('ch:a');
    expect(removedGroups).toEqual(['ch:a']);
    removedGroups.length = 0;
    electronPresenter({ caps: notificationCapabilities('linux'), focusWindow: vi.fn() }).clearGroup('ch:a');
    expect(removedGroups).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test:unit -- tests/unit/notifications/present.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement present.ts**

Create `src/main/notifications/present.ts`:

```ts
import { Notification } from 'electron';
import type { Capabilities } from './capabilities';

export interface NotificationSpec {
  id?: string;
  groupId?: string;
  title: string;
  subtitle?: string;
  body: string;
  silent: boolean;
  reply?: boolean;
  replyPlaceholder?: string;
  actions?: string[]; // button labels, in order
  onClick?(): void;
  onReply?(text: string): void;
  onAction?(index: number): void;
}

export interface NotificationPresenter {
  isSupported(): boolean;
  show(spec: NotificationSpec): void;
  clearGroup(groupId: string): void;
}

// The only Electron-Notification consumer besides index.ts. Maps a
// platform-neutral spec onto the constructor, gating each field on the
// capability matrix so unsupported fields are simply omitted.
export function electronPresenter(deps: { caps: Capabilities; focusWindow(): void }): NotificationPresenter {
  const { caps, focusWindow } = deps;
  return {
    isSupported: () => Notification.isSupported(),
    show(spec) {
      const opts: Electron.NotificationConstructorOptions = {
        title: spec.title,
        body: spec.body,
        silent: spec.silent,
      };
      if (spec.id) opts.id = spec.id;
      if (caps.groupId && spec.groupId) opts.groupId = spec.groupId;
      if (caps.subtitle && spec.subtitle) opts.subtitle = spec.subtitle;
      if (caps.reply && spec.reply) {
        opts.hasReply = true;
        if (spec.replyPlaceholder) opts.replyPlaceholder = spec.replyPlaceholder;
      }
      if (caps.actions && spec.actions && spec.actions.length > 0) {
        opts.actions = spec.actions.map((text) => ({ type: 'button', text }));
      }
      const n = new Notification(opts);
      n.on('click', () => {
        focusWindow();
        spec.onClick?.();
      });
      // Electron's reply/action events differ across versions: older builds pass
      // (event, reply)/(event, index); newer builds expose the value on the event
      // object. The optional 2nd param typechecks against either overload and the
      // body handles both runtime shapes.
      n.on('reply', (_event: unknown, reply?: string) => {
        const details = _event as { reply?: string } | undefined;
        spec.onReply?.(reply ?? details?.reply ?? '');
      });
      n.on('action', (_event: unknown, index?: number) => {
        const details = _event as { actionIndex?: number } | undefined;
        spec.onAction?.(index ?? (typeof _event === 'number' ? _event : details?.actionIndex) ?? 0);
      });
      n.show();
    },
    clearGroup(groupId) {
      if (caps.remove) Notification.removeGroup(groupId);
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test:unit -- tests/unit/notifications/present.test.ts`
Expected: PASS. Then `pnpm typecheck` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/notifications/present.ts tests/unit/notifications/present.test.ts
git commit -m "feat(notifications): Electron presenter seam with capability-gated field mapping"
```

---

## Task 10: notifications/router.ts (core wiring, fully injected)

**Files:**
- Create: `src/main/notifications/router.ts`
- Test: `tests/unit/notifications/router.test.ts`

**Interfaces:**
- Consumes: `Capabilities`, `NotificationPresenter`, `NotificationSpec`, `NotificationActions`, `Aggregator` callbacks, `buildContent`, `channelSenderName`, `formatSummaryBody`, `passesPolicy`, `classify`, from earlier tasks; `AppSettings`, `Owner`, `UiState`, `Channel`, `Contact`, `Message`, `MenuAction`, `ContactKind` from types.
- Produces:
  - `interface RouterDeps { presenter: NotificationPresenter; caps: Capabilities; now(): number; isFocused(): boolean; emitMenuAction(a: MenuAction): void; actions: NotificationActions; setBadge(n: number): void; config: { staleThresholdMs: number; flushDelayMs: number; rollupCap: number }; getAppSettings(): AppSettings; getOwner(): Owner | null; getUiState(): UiState; getChannels(): Channel[]; getContacts(): Contact[]; getMessagesForKey(key: string): Message[]; isBlocked(m: Message): boolean }`
  - `interface NotificationRouter { handleMessages(key: string, list: Message[]): void; handleUiState(ui: UiState): void; handleContactDiscovered(c: { key: string; name: string; kind: ContactKind }): void; recomputeBadge(): void }`
  - `createNotificationRouter(deps: RouterDeps): NotificationRouter`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/notifications/router.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSettings, Channel, Contact, Message, Owner, UiState } from '../../../src/shared/types';
import { DEFAULT_APP_SETTINGS } from '../../../src/shared/types';
import { notificationCapabilities } from '../../../src/main/notifications/capabilities';
import type { NotificationSpec } from '../../../src/main/notifications/present';
import { createNotificationRouter, type RouterDeps } from '../../../src/main/notifications/router';

const NOW = 1_000_000_000_000;

function harness(over: Partial<RouterDeps> = {}) {
  const shown: NotificationSpec[] = [];
  const cleared: string[] = [];
  const channels: Channel[] = [{ key: 'ch:General', name: 'General', kind: 'public' }];
  const contacts: Contact[] = [{ key: 'c:aa', publicKeyHex: 'aa', name: 'Alice', kind: 'chat' }];
  const owner: Owner = { name: 'me', publicKeyHex: 'ff', publicKeyShort: 'ff' };
  let ui: UiState = { activeKey: 'tool:packetlog', lastReadByKey: {} } as UiState;
  const settings: AppSettings = {
    ...DEFAULT_APP_SETTINGS,
    notifications: { ...DEFAULT_APP_SETTINGS.notifications, channelMessage: true },
  };
  const deps: RouterDeps = {
    presenter: { isSupported: () => true, show: (s) => shown.push(s), clearGroup: (g) => cleared.push(g) },
    caps: notificationCapabilities('darwin'),
    now: () => NOW,
    isFocused: () => false,
    emitMenuAction: vi.fn(),
    actions: { reply: vi.fn(async () => {}), markRead: vi.fn(), mute: vi.fn() },
    setBadge: vi.fn(),
    config: { staleThresholdMs: 5 * 60_000, flushDelayMs: 1_000, rollupCap: 5 },
    getAppSettings: () => settings,
    getOwner: () => owner,
    getUiState: () => ui,
    getChannels: () => channels,
    getContacts: () => contacts,
    getMessagesForKey: () => [],
    isBlocked: () => false,
    ...over,
  };
  const router = createNotificationRouter(deps);
  return { router, shown, cleared, deps, setUi: (u: UiState) => { ui = u; } };
}

const chMsg = (over: Partial<Message>): Message => ({ id: 'm1', key: 'ch:General', body: 'hi', ts: NOW, state: 'received', fromPublicKeyHex: 'name:Bob', ...over });

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('notification router', () => {
  it('fresh channel message → individual with sender subtitle (macOS) + deep-link click', () => {
    const h = harness();
    h.router.handleMessages('ch:General', [chMsg({})]);
    expect(h.shown).toHaveLength(1);
    expect(h.shown[0]).toMatchObject({ id: 'msg:m1', groupId: 'ch:General', title: 'General', subtitle: 'Bob', body: 'hi' });
    h.shown[0].onClick?.();
    expect(h.deps.emitMenuAction).toHaveBeenCalledWith({ kind: 'focusMessage', key: 'ch:General', messageId: 'm1' });
  });

  it('stale channel message → debounced summary, no individual', () => {
    const h = harness();
    h.router.handleMessages('ch:General', [chMsg({ id: 'm2', ts: NOW - 10 * 60_000 })]);
    expect(h.shown).toHaveLength(0);
    vi.advanceTimersByTime(1_000);
    expect(h.shown).toHaveLength(1);
    expect(h.shown[0]).toMatchObject({ id: 'summary:ch:General', groupId: 'ch:General', title: 'General', body: '1 message from Bob' });
    h.shown[0].onClick?.();
    expect(h.deps.emitMenuAction).toHaveBeenCalledWith({ kind: 'focusFirstUnread', key: 'ch:General' });
  });

  it('summarizeBacklog=false → stale message fires individually', () => {
    const settings = { ...DEFAULT_APP_SETTINGS, notifications: { ...DEFAULT_APP_SETTINGS.notifications, channelMessage: true, summarizeBacklog: false } };
    const h = harness({ getAppSettings: () => settings });
    h.router.handleMessages('ch:General', [chMsg({ id: 'm3', ts: NOW - 10 * 60_000 })]);
    expect(h.shown).toHaveLength(1);
    expect(h.shown[0].id).toBe('msg:m3');
  });

  it('dedups a re-emitted message id', () => {
    const h = harness();
    const m = chMsg({ id: 'dup' });
    h.router.handleMessages('ch:General', [m]);
    h.router.handleMessages('ch:General', [m]);
    expect(h.shown).toHaveLength(1);
  });

  it('clear-on-read clears the summary group when the conversation is opened', () => {
    const h = harness();
    h.router.handleMessages('ch:General', [chMsg({ id: 'm4', ts: NOW - 10 * 60_000 })]);
    vi.advanceTimersByTime(1_000);
    expect(h.shown).toHaveLength(1);
    const opened = { activeKey: 'ch:General', lastReadByKey: {} } as UiState;
    h.setUi(opened);
    h.router.handleUiState(opened);
    expect(h.cleared).toContain('ch:General');
  });

  it('wires reply and actions onto the spec', () => {
    const h = harness();
    h.router.handleMessages('ch:General', [chMsg({ id: 'm5' })]);
    const spec = h.shown[0];
    expect(spec.reply).toBe(true);
    expect(spec.actions).toEqual(['Mark as read', 'Mute']);
    spec.onReply?.('yo');
    expect(h.deps.actions.reply).toHaveBeenCalledWith('ch:General', 'yo');
    spec.onAction?.(0);
    expect(h.deps.actions.markRead).toHaveBeenCalledWith('ch:General');
    spec.onAction?.(1);
    expect(h.deps.actions.mute).toHaveBeenCalledWith('ch:General');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test:unit -- tests/unit/notifications/router.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement router.ts**

Create `src/main/notifications/router.ts`:

```ts
import type { AppSettings, Channel, Contact, ContactKind, MenuAction, Message, Owner, UiState } from '../../shared/types';
import { createAggregator, type StaleDescriptor } from './aggregator';
import type { Capabilities } from './capabilities';
import { MAX_NOTIFIED_IDS } from './config';
import { buildContent, channelSenderName, formatSummaryBody } from './format';
import { classify, passesPolicy } from './policy';
import type { NotificationActions } from './actions';
import type { NotificationPresenter, NotificationSpec } from './present';

const ACTION_LABELS = ['Mark as read', 'Mute'];

export interface RouterDeps {
  presenter: NotificationPresenter;
  caps: Capabilities;
  now(): number;
  isFocused(): boolean;
  emitMenuAction(a: MenuAction): void;
  actions: NotificationActions;
  setBadge(n: number): void;
  config: { staleThresholdMs: number; flushDelayMs: number; rollupCap: number };
  getAppSettings(): AppSettings;
  getOwner(): Owner | null;
  getUiState(): UiState;
  getChannels(): Channel[];
  getContacts(): Contact[];
  getMessagesForKey(key: string): Message[];
  isBlocked(m: Message): boolean;
}

export interface NotificationRouter {
  handleMessages(key: string, list: Message[]): void;
  handleUiState(ui: UiState): void;
  handleContactDiscovered(c: { key: string; name: string; kind: ContactKind }): void;
  recomputeBadge(): void;
}

export function createNotificationRouter(deps: RouterDeps): NotificationRouter {
  const notifiedIds = new Set<string>();
  const summaryKeys = new Set<string>();

  const aggregator = createAggregator({
    now: deps.now,
    config: deps.config,
    callbacks: {
      onIndividual: presentIndividual,
      onSummaries: presentSummaries,
      onGlobalSummary: presentGlobalSummary,
    },
  });

  function channelName(key: string): string {
    return deps.getChannels().find((c) => c.key === key)?.name ?? key.slice(3);
  }
  function contactName(key: string): string {
    return deps.getContacts().find((c) => c.key === key)?.name ?? key;
  }
  function contactKindOf(key: string): ContactKind | undefined {
    return deps.getContacts().find((c) => c.key === key)?.kind;
  }
  function isMuted(key: string): boolean {
    if (key.startsWith('ch:')) return deps.getChannels().some((c) => c.key === key && c.muted);
    return deps.getContacts().some((c) => c.key === key && c.muted);
  }

  function conversationSpecExtras(key: string): Pick<NotificationSpec, 'reply' | 'replyPlaceholder' | 'actions' | 'onReply' | 'onAction'> {
    return {
      reply: deps.caps.reply ? true : undefined,
      replyPlaceholder: deps.caps.reply ? 'Reply…' : undefined,
      actions: deps.caps.actions ? ACTION_LABELS : undefined,
      onReply: (text) => void deps.actions.reply(key, text),
      onAction: (index) => (index === 0 ? deps.actions.markRead(key) : deps.actions.mute(key)),
    };
  }

  function presentIndividual(m: Message): void {
    const isChannel = m.key.startsWith('ch:');
    const ownerName = deps.getOwner()?.name;
    const kind = classify(m, ownerName, contactKindOf(m.key));
    const content = buildContent({
      isChannel,
      displayName: isChannel ? channelName(m.key) : contactName(m.key),
      senderName: isChannel ? channelSenderName(m.fromPublicKeyHex) : '',
      mention: kind === 'channelMention',
      body: m.body,
      caps: deps.caps,
    });
    deps.presenter.show({
      id: `msg:${m.id}`,
      groupId: m.key,
      title: content.title,
      subtitle: content.subtitle,
      body: content.body,
      silent: !deps.getAppSettings().notifications.sound,
      onClick: () => deps.emitMenuAction({ kind: 'focusMessage', key: m.key, messageId: m.id }),
      ...conversationSpecExtras(m.key),
    });
  }

  function presentSummaries(summaries: StaleDescriptor[]): void {
    const sound = deps.getAppSettings().notifications.sound;
    for (const d of summaries) {
      summaryKeys.add(d.key);
      const isChannel = d.key.startsWith('ch:');
      deps.presenter.show({
        id: `summary:${d.key}`,
        groupId: d.key,
        title: isChannel ? channelName(d.key) : contactName(d.key),
        body: formatSummaryBody(d.count, d.senders),
        silent: !sound,
        onClick: () => deps.emitMenuAction({ kind: 'focusFirstUnread', key: d.key }),
        ...conversationSpecExtras(d.key),
      });
    }
  }

  function presentGlobalSummary(info: { total: number; conversationCount: number; lastKey: string }): void {
    summaryKeys.add(info.lastKey);
    deps.presenter.show({
      id: 'summary:__all__',
      title: 'CoreSense',
      body: `${info.total} messages across ${info.conversationCount} conversations`,
      silent: !deps.getAppSettings().notifications.sound,
      onClick: () => deps.emitMenuAction({ kind: 'focusFirstUnread', key: info.lastKey }),
    });
  }

  function processMessage(m: Message): void {
    if (notifiedIds.has(m.id)) return;
    notifiedIds.add(m.id);
    if (notifiedIds.size > MAX_NOTIFIED_IDS) {
      const drop = Math.floor(MAX_NOTIFIED_IDS / 2);
      let i = 0;
      for (const id of notifiedIds) {
        if (i++ >= drop) break;
        notifiedIds.delete(id);
      }
    }
    const notifications = deps.getAppSettings().notifications;
    const ui = deps.getUiState();
    const { show } = passesPolicy({
      msg: m,
      notifications,
      ownerName: deps.getOwner()?.name,
      contactKind: contactKindOf(m.key),
      muted: isMuted(m.key),
      blocked: deps.isBlocked(m),
      focused: deps.isFocused() && ui.activeKey === m.key,
    });
    if (!show) return;
    if (!deps.presenter.isSupported()) return;
    if (notifications.summarizeBacklog) {
      aggregator.ingest(m, m.key.startsWith('ch:') ? channelSenderName(m.fromPublicKeyHex) : '');
    } else {
      presentIndividual(m);
    }
  }

  return {
    handleMessages(_key, list) {
      const last = list[list.length - 1];
      if (last) processMessage(last);
      this.recomputeBadge();
    },
    handleUiState(ui) {
      if (summaryKeys.has(ui.activeKey)) {
        deps.presenter.clearGroup(ui.activeKey);
        aggregator.clear(ui.activeKey);
        summaryKeys.delete(ui.activeKey);
      }
    },
    handleContactDiscovered(c) {
      // shouldFireDiscovered is applied by index.ts before this is called.
      deps.presenter.show({
        id: `discovered:${c.key}`,
        groupId: 'discovered',
        title: 'New contact discovered',
        body: c.name,
        silent: !deps.getAppSettings().notifications.sound,
        onClick: () => deps.emitMenuAction({ kind: 'focusKey', key: c.key }),
      });
    },
    recomputeBadge() {
      const settings = deps.getAppSettings();
      if (!settings.notifications.dockBadge) {
        deps.setBadge(0);
        return;
      }
      const ui = deps.getUiState();
      const ownerName = deps.getOwner()?.name;
      const keys = new Set<string>();
      for (const ch of deps.getChannels()) keys.add(ch.key);
      for (const c of deps.getContacts()) keys.add(c.key);
      let total = 0;
      for (const key of keys) {
        if (isMuted(key)) continue;
        const lastRead = ui.lastReadByKey[key] ?? 0;
        for (const m of deps.getMessagesForKey(key)) {
          if (m.state !== 'received') continue;
          if (m.ts <= lastRead) continue;
          if (deps.isBlocked(m)) continue;
          const kind = classify(m, ownerName, contactKindOf(key));
          if (settings.notifications[kind]) total += 1;
        }
      }
      deps.setBadge(total);
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test:unit -- tests/unit/notifications/router.test.ts`
Expected: PASS. Then `pnpm typecheck` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/notifications/router.ts tests/unit/notifications/router.test.ts
git commit -m "feat(notifications): router wiring (format+policy+aggregate+present+actions)"
```

---

## Task 11: notifications/index.ts (production wiring) + delete old file

**Files:**
- Create: `src/main/notifications/index.ts`
- Delete: `src/main/notifications.ts`
- Test: none new (covered by Task 10 + a boot smoke in Task 17). Verified by `pnpm typecheck` and the existing app boot.

**Interfaces:**
- Consumes: everything above + `bus`, `emit`, `stateHolder`, `blockingStore`, `getMainWindow`, `isMainWindowFocused`, `shouldFireDiscovered`, `isMessageBlocked`, `sendMessage`, `app`.
- Produces: `startNotifications(): void` (same signature `src/main/index.ts:177` already calls).

- [ ] **Step 1: Implement index.ts**

Create `src/main/notifications/index.ts`:

```ts
import { app } from 'electron';
import { isMessageBlocked } from '../../shared/blocking/match';
import { shouldFireDiscovered } from '../../shared/notifications/discovered';
import type { ContactKind, Message } from '../../shared/types';
import { blockingStore } from '../blocking/store';
import { bus, emit } from '../events/bus';
import { child } from '../log';
import { sendMessage } from '../messaging/sendMessage';
import { stateHolder } from '../state/holder';
import { getMainWindow, isMainWindowFocused } from '../window/registry';
import { createNotificationActions } from './actions';
import { notificationCapabilities } from './capabilities';
import { ROLLUP_CAP, STALE_THRESHOLD_MS, SUMMARY_FLUSH_MS } from './config';
import { electronPresenter } from './present';
import { createNotificationRouter } from './router';

const log = child('notify');

function isBlockedNow(m: Message): boolean {
  const rules = blockingStore().list();
  if (rules.length === 0) return false;
  const holder = stateHolder();
  const originHop = m.meta?.paths?.[0]?.hops.find((h) => h.kind === 'origin');
  const { blocked } = isMessageBlocked(
    m,
    {
      contactNameByPk: (pk) => holder.getContacts().find((c) => c.publicKeyHex === pk)?.name,
      originHopPk: originHop?.pk?.toLowerCase(),
    },
    rules,
    blockingStore().regexCacheRef(),
  );
  return blocked;
}

export function startNotifications(): void {
  const platform = process.platform;
  const caps = notificationCapabilities(platform);
  const isMac = platform === 'darwin';

  const presenter = electronPresenter({
    caps,
    focusWindow: () => {
      const win = getMainWindow();
      if (!win) return;
      if (win.isMinimized()) win.restore();
      win.focus();
    },
  });

  const actions = createNotificationActions({
    sendMessage,
    getChannels: () => stateHolder().getChannels(),
    getContacts: () => stateHolder().getContacts(),
    upsertChannel: (c) => stateHolder().upsertChannel(c),
    upsertContact: (c) => stateHolder().upsertContact(c),
    emitChannels: () => emit.channels(stateHolder().getChannels()),
    emitContacts: () => emit.contacts(stateHolder().getContacts()),
    getUiState: () => stateHolder().getUiState(),
    setUiState: (u) => stateHolder().setUiState(u),
    emitUiState: (u) => emit.uiState(u),
    now: () => Date.now(),
  });

  const router = createNotificationRouter({
    presenter,
    caps,
    now: () => Date.now(),
    isFocused: isMainWindowFocused,
    emitMenuAction: (a) => emit.menuAction(a),
    actions,
    setBadge: (n) => {
      if (isMac) app.setBadgeCount(n);
    },
    config: { staleThresholdMs: STALE_THRESHOLD_MS, flushDelayMs: SUMMARY_FLUSH_MS, rollupCap: ROLLUP_CAP },
    getAppSettings: () => stateHolder().getAppSettings(),
    getOwner: () => stateHolder().getOwner(),
    getUiState: () => stateHolder().getUiState(),
    getChannels: () => stateHolder().getChannels(),
    getContacts: () => stateHolder().getContacts(),
    getMessagesForKey: (key) => stateHolder().getMessagesForKey(key),
    isBlocked: isBlockedNow,
  });

  bus.on('messages', (key: string, list: Message[]) => router.handleMessages(key, list));
  bus.on('contactDiscovered', (c: { key: string; name: string; kind: ContactKind }) => {
    if (!shouldFireDiscovered(stateHolder().getAppSettings().notifications, isMainWindowFocused())) return;
    router.handleContactDiscovered(c);
  });
  bus.on('uiState', (u) => {
    router.handleUiState(u);
    router.recomputeBadge();
  });
  bus.on('appSettings', () => router.recomputeBadge());
  bus.on('channels', () => router.recomputeBadge());
  bus.on('contacts', () => router.recomputeBadge());
  bus.on('blockRules', () => router.recomputeBadge());
  router.recomputeBadge();
  log.debug('notification router started');
}
```

- [ ] **Step 2: Delete the old single-file module**

```bash
git rm src/main/notifications.ts
```

- [ ] **Step 3: Verify the import in `src/main/index.ts` still resolves**

`src/main/index.ts:49` imports `import { startNotifications } from './notifications'`. Node/TS resolves `./notifications` to `./notifications/index.ts` now that the directory exists. Confirm no change is required there.

Run: `pnpm typecheck`
Expected: PASS (no unresolved import; the old file's `Message`/`ContactKind` imports are now inside the module).

- [ ] **Step 4: Full unit suite green**

Run: `pnpm test:unit`
Expected: PASS (all notification unit tests + pre-existing).

- [ ] **Step 5: Commit**

```bash
# the `git rm` above already staged the deletion; add the new module entrypoint
git add src/main/notifications/index.ts
git commit -m "feat(notifications): production wiring; replace single-file module with notifications/"
```

---

## Task 12: Renderer menu actions — focusMessage + focusFirstUnread

**Files:**
- Modify: `src/renderer/app/menuActions.ts`
- Test: `tests/component/menu-actions-jump.test.tsx`

**Interfaces:**
- Consumes: `firstUnreadMessageId` (Task 6); store `setPendingJump`, `messagesByKey`, `ui.lastReadByKey`; `MenuAction` variants (Task 1).

- [ ] **Step 1: Write the failing test**

Create `tests/component/menu-actions-jump.test.tsx`:

```tsx
import { describe, expect, it, vi } from 'vitest';
import { createMenuActionHandler } from '../../src/renderer/app/menuActions';
import { useStore } from '../../src/renderer/lib/store';
import type { Message } from '../../src/shared/types';

const deps = () => ({
  baseUrl: 'http://x', apiKey: 'k',
  cycleThemePref: vi.fn(), toggleLeftNav: vi.fn(), toggleRightRail: vi.fn(), togglePin: vi.fn(),
  setActiveKey: vi.fn(),
});

const m = (id: string, ts: number): Message => ({ id, key: 'ch:General', body: 'x', ts, state: 'received', fromPublicKeyHex: 'name:Bob' });

describe('menu action jump', () => {
  it('focusMessage sets active key and pending jump to the message id', () => {
    const d = deps();
    createMenuActionHandler(d)({ kind: 'focusMessage', key: 'ch:General', messageId: 'm7' });
    expect(d.setActiveKey).toHaveBeenCalledWith('ch:General');
    expect(useStore.getState().pendingJumpMid).toBe('m7');
  });

  it('focusFirstUnread jumps to the first unread message', () => {
    const d = deps();
    useStore.getState().applyMessages('ch:General', [m('a', 10), m('b', 20), m('c', 30)]);
    useStore.getState().markRead('ch:General', 15);
    createMenuActionHandler(d)({ kind: 'focusFirstUnread', key: 'ch:General' });
    expect(d.setActiveKey).toHaveBeenCalledWith('ch:General');
    expect(useStore.getState().pendingJumpMid).toBe('b');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test:dom -- tests/component/menu-actions-jump.test.tsx`
Expected: FAIL (no `focusMessage`/`focusFirstUnread` cases; `pendingJumpMid` stays null).

- [ ] **Step 3: Add the cases**

In `src/renderer/app/menuActions.ts`, add the import at the top:

```ts
import { firstUnreadMessageId } from '../lib/utils';
```

Add two cases inside the `switch (action.kind)` (e.g. right after the `focusKey` case):

```ts
      case 'focusMessage':
        setActiveKey(action.key);
        useStore.getState().setPendingJump(action.messageId);
        break;
      case 'focusFirstUnread': {
        setActiveKey(action.key);
        const st = useStore.getState();
        const msgs = st.messagesByKey[action.key] ?? [];
        const lastRead = st.ui.lastReadByKey[action.key] ?? 0;
        const mid = firstUnreadMessageId(msgs, lastRead);
        if (mid) st.setPendingJump(mid);
        break;
      }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test:dom -- tests/component/menu-actions-jump.test.tsx`
Expected: PASS. Then `pnpm typecheck` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/app/menuActions.ts tests/component/menu-actions-jump.test.tsx
git commit -m "feat(renderer): focusMessage/focusFirstUnread menu actions jump to message"
```

---

## Task 13: Settings — summarizeBacklog toggle

**Files:**
- Modify: `src/renderer/panels/settings/app/Notifications.tsx`
- Test: `tests/component/notifications-setting.test.tsx`

**Interfaces:**
- Consumes: `AppSettings['notifications'].summarizeBacklog` (Task 1); the existing `Row`/`Toggle`/`saveApp` pattern in the file.

- [ ] **Step 1: Write the failing test**

Create `tests/component/notifications-setting.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../src/renderer/lib/api', () => ({
  api: { putAppSettings: vi.fn(async () => ({ ok: true })) },
}));

import { NotificationsSection } from '../../src/renderer/panels/settings/app/Notifications';

describe('NotificationsSection', () => {
  it('renders the backlog-summary toggle row', () => {
    render(<NotificationsSection client={{ baseUrl: 'http://x', apiKey: 'k' }} />);
    expect(screen.getByText('Summarize while away')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test:dom -- tests/component/notifications-setting.test.tsx`
Expected: FAIL (label not found).

- [ ] **Step 3: Add the toggle row + eq field**

In `src/renderer/panels/settings/app/Notifications.tsx`, add to the `eqNotifications` return (before the closing `)`):

```ts
    x.suppressWhenFocused === y.suppressWhenFocused &&
    x.dockBadge === y.dockBadge &&
    x.summarizeBacklog === y.summarizeBacklog
```

(Replace the existing final two lines `x.suppressWhenFocused === ... && x.dockBadge === y.dockBadge` accordingly — append the `summarizeBacklog` comparison as the last term.)

Add a new `Row` after the "Dock badge (macOS)" row (before `</SettingsSection>`):

```tsx
      <Row
        label="Summarize while away"
        description="Fold messages received while disconnected into one summary per conversation."
        changed={n.summarizeBacklog !== s0.summarizeBacklog}
        control={<Toggle checked={n.summarizeBacklog} onChange={(v) => setN({ summarizeBacklog: v })} />}
      />
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test:dom -- tests/component/notifications-setting.test.tsx`
Expected: PASS. Then `pnpm typecheck` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/panels/settings/app/Notifications.tsx tests/component/notifications-setting.test.tsx
git commit -m "feat(settings): add 'Summarize while away' notification toggle"
```

---

## Task 14: macOS Info.plist — enable notification action buttons

**Files:**
- Modify: `forge.config.ts` (`extendInfo`, ~L82-89)

**Interfaces:** none (build config). Required so `actions` buttons render on macOS.

- [ ] **Step 1: Add the plist key**

In `forge.config.ts`, inside the `extendInfo` object, add `NSUserNotificationAlertStyle: 'alert'`:

```ts
    extendInfo: {
      NSBluetoothAlwaysUsageDescription: 'CoreSense uses Bluetooth to scan for and connect to MeshCore radios.',
      NSBluetoothPeripheralUsageDescription: 'CoreSense uses Bluetooth to scan for and connect to MeshCore radios.',
      CFBundleIconName: 'coresense',
      // Required for notification action buttons (Mark as read / Mute) to appear
      // on macOS. Must live here — ASAR integrity validation forbids editing the
      // packaged Info.plist post-build.
      NSUserNotificationAlertStyle: 'alert',
    },
```

- [ ] **Step 2: Verify config still typechecks**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add forge.config.ts
git commit -m "chore(build): set NSUserNotificationAlertStyle=alert for macOS notification actions"
```

---

## Task 15: Full suite + lint + typecheck gate

**Files:** none (verification task).

- [ ] **Step 1: Run the complete test suite**

Run: `pnpm test:unit && pnpm test:integration && pnpm test:dom`
Expected: all PASS. If an integration test that boots the app touches notifications, ensure it still passes (nothing else imports `src/main/notifications.ts` directly — the directory index preserves the public `startNotifications`).

- [ ] **Step 2: Typecheck + lint**

Run: `pnpm typecheck` → PASS. Run: `pnpm exec biome check src tests` → PASS (fix any formatting biome reports with `pnpm exec biome check --write src tests`, then re-run).

- [ ] **Step 3: Commit any lint fixups**

```bash
git add -A
git commit -m "chore: lint + format fixups for notification module"
```

(Skip if nothing changed.)

---

## Task 16: Manual end-to-end verification

**Files:** none (uses the `verify` / `run` skills to drive the real app).

- [ ] **Step 1: Launch the app**

Run: `pnpm start` (electron-forge). Connect to a radio (or the loopback/dev transport if available).

- [ ] **Step 2: Verify each behavior**

Confirm and note the observed result for each:
- **Sender in subject:** a channel message shows the channel as the title and the sender as the subtitle (macOS) or `#channel — Sender` (would need Win/Linux; note platform tested).
- **Deep-link:** click an individual notification → app focuses and scrolls to that exact message (flash highlight).
- **Backlog summary:** disconnect, let messages queue (or simulate stale `ts`), reconnect → a single "N new messages" summary per conversation instead of a storm; clicking it opens the conversation at the first unread.
- **Reply:** reply inline from a notification (macOS/Windows) → the message sends and appears in the conversation.
- **Actions:** "Mark as read" clears the unread/badge; "Mute" silences the conversation and persists.
- **Clear on read:** opening a conversation clears its outstanding notifications from Notification Center (macOS/Windows).
- **Setting:** toggling "Summarize while away" off makes backlog messages notify individually.

- [ ] **Step 3: Record results**

Write a short PASS/FAIL note per behavior in the PR description or a scratch note. If any fails, open a systematic-debugging loop before finishing the branch.

- [ ] **Step 4: Finish the branch**

Use `superpowers:finishing-a-development-branch` to decide merge/PR. Ensure the design spec (`docs/superpowers/specs/2026-07-06-notification-improvements-design.md`) and this plan are committed.

---

## Notes / known limitations (carried from the spec)

- **DM message ids are random per receipt** (`radio-<ts>-<rand>`), so a re-drained DM after reconnect can inflate a summary count and won't dedup via `notifiedIds`. Accepted.
- **Clock skew:** classification uses the sender-stamped `ts`; a badly-skewed node could misclassify live↔backlog. The 5-min threshold is tolerant. Accepted.
- **macOS `hasReply` + multiple buttons** is OS-constrained (reply inline; buttons in the expanded view).
- **Global rollup** posts one `summary:__all__`; earlier per-conversation summaries already shown are not retroactively removed. Accepted (rare, and they clear on read).
