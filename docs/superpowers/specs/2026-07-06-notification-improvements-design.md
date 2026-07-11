# Notification System Improvements — Design

**Date:** 2026-07-06
**Status:** Approved (design) — pending implementation plan
**Worktree/branch:** `feat/notification-improvements`

## 1. Goals

1. **Sender in the subject.** Channel notifications must show *who* sent the message, not just the channel.
2. **Deep-link on click.** Clicking a notification jumps to the specific channel/DM *and* the specific message.
3. **No reconnect storm.** When a backlog of messages drains off the radio after a disconnect, aggregate them into per-conversation summaries instead of one banner per message.
4. **Interaction extras.** Inline reply, action buttons (Mark read / Mute), clear-on-read, and native per-conversation grouping.

## 2. Non-goals / out of scope

- **Custom per-notification icons.** macOS cannot show a custom per-notification image (`icon` is ignored on macOS in the `UNNotification` path; `UNNotificationAttachment` is not exposed by Electron 42). The app icon shows automatically. Icons are dropped from this pass; per-contact avatars (Windows/Linux only) are possible future work.
- **Coalescing of *live* message bursts.** Aggregation is scoped to stale/backlog messages only; live traffic continues to fire individual notifications.
- **Per-channel "mentions only" notification level.** Existing per-conversation `muted` + global per-kind toggles are unchanged.
- **Quiet hours / DND.** Handled by the OS.

## 3. Current state (baseline)

- All native notifications are created in the main process in a single file: `src/main/notifications.ts`. Two construction sites (incoming message ~L107-122; "new contact discovered" ~L134-147). They set only `title`, `body`, `silent` — no `subtitle`, no grouping, no message-level click target.
- Channel notifications use `title = channel name`; the **sender is absent** (only present as a `"name: "` prefix inside `body` and in `meta.paths[].hops[origin].name`). DMs already use the contact name as `title`.
- Click today calls `emit.menuAction({kind:'focusKey', key})` → renderer `setActiveKey(key)` (focuses the conversation, does **not** scroll to the message).
- The renderer already has a jump-to-message primitive used by search: `setPendingJump(messageId)` → `MessageList` scrolls + flashes (`src/renderer/lib/store.ts:887`, `src/renderer/components/MessageList.tsx:264-275`).
- No batching/throttling. The only dedup is an in-memory `Set<string>` of message ids (empty on launch), so a reconnect backlog drains one native notification per message.
- Settings exist per *kind* in `AppSettings.notifications` (`src/shared/types.ts:349-360`) + per-conversation `muted` on `Channel`/`Contact`.

### Platform / API facts (verified)

- Electron **42.4.1**. Verified in typings: `id`, `groupId`, `groupTitle`, `subtitle`, static `Notification.remove(id)`, `Notification.removeGroup(groupId)`, `Notification.getHistory()`, `Notification.isSupported()`.
- App ships to **macOS** (DMG/ZIP), **Windows** (Squirrel/ZIP), **Linux** (Deb/RPM) via `forge.config.ts` makers.
- macOS build is **code-signed** (`osxSign` at `forge.config.ts:99-101`) and notarizable; Windows-signed via `scripts/windows-sign.cjs`.
- The library `@andyshinn/meshcore-ts` (0.3.1) drains the device inbox with the **same** code path as live messages and exposes **no** drain event/flag. But backlog messages keep the radio's **original (old) `ts`**, so `now − ts` is a reliable backlog discriminator. `transportState === 'connected'` is the only connect/reconnect signal.

### Platform field support

| Field / feature | macOS | Windows | Linux |
|---|---|---|---|
| `subtitle` | ✅ | ignored | ignored |
| `groupId` | ✅ (thread) | ✅ (group) | ✗ |
| `groupTitle` | ✗ | ✅ | ✗ |
| `remove` / `removeGroup` | ✅ | ✅ | ✗ |
| `hasReply` (inline reply) | ✅ | ✅ | ✗ |
| `actions` (buttons) | ✅¹ | ✅ | ✗ |
| `icon` | ignored | ✅ | ✅ |

¹ macOS action buttons require the app signed **and** `NSUserNotificationAlertStyle: 'alert'` in Info.plist. macOS also constrains `hasReply` + multiple buttons (reply inline; buttons in expanded view).

## 4. Architecture

Keep all notification logic in the **main process** (native `Notification`, `protocolSession`, `stateHolder` are main-side). Refactor the single `src/main/notifications.ts` into a focused `src/main/notifications/` module:

| Module | Responsibility | Purity / testability |
|---|---|---|
| `platform.ts` | Capability flags from `process.platform`: `supportsSubtitle`, `supportsGroup`, `supportsRemove`, `supportsReply`, `supportsActions`. | pure |
| `format.ts` | `(Message, resolved channel/contact, owner, platform) → {title, subtitle?, body}`. Sender extraction, prefix-strip, delimiter fallback, mention marker, truncation. | pure — heavily unit-tested |
| `policy.ts` | Existing gate chain (block → dedup → mute → kind toggle → suppress-when-focused) → `{show, kind}`. Lifted from current `maybeNotify`. | pure-ish (reads holder) |
| `aggregator.ts` | Staleness classify + per-conversation summary state + debounce flush + global rollup + clear-on-read reset. Injectable `now()` + `flush` scheduler. | pure logic, fake-clock tested |
| `present.ts` | Build/`show()` the Electron `Notification` (id, groupId, platform-gated actions/reply), track live notification ids per key, expose `clear(key)`. Wire `click`/`reply`/`action` events. | thin, mocked in tests |
| `actions.ts` | `reply(key,text)`, `markRead(key)`, `mute(key)` handlers. | integration-tested |
| `index.ts` | `startNotifications()` wiring: bus subscriptions, badge recompute (existing `recomputeBadge`). | wiring |

### Data flow

```
bus 'messages'  → onMessages(last)
                → policy.evaluate(msg) ─ show? ─┐ no → drop
                                                └ yes → aggregator.classify(msg, now)
                                                        ├ live  → present.individual(msg)
                                                        └ stale → aggregator.addToSummary(key,msg)
                                                                  → debounced flush → present.summary(...)
bus 'uiState' / read change → aggregator.clearOnRead(key) → present.clear(key) + reset state → recomputeBadge
notification 'click'  → emit.menuAction(focusMessage | focusFirstUnread)
notification 'reply'  → actions.reply(key, text)
notification 'action' → actions.markRead(key) | actions.mute(key)
```

## 5. Feature design

### 5.1 Message formatting (Goal 1)

Platform-aware output from `format.ts`:

| | macOS | Windows / Linux |
|---|---|---|
| Channel | title=`#general`, subtitle=`Alice`, body=text | title=`#general — Alice`, body=text |
| Channel + mention | title=`#general • mention`, subtitle=`Alice` | title=`#general — Alice • mention` |
| DM | title=`Alice`, body=text (no subtitle) | title=`Alice`, body=text |

- **Sender extraction:** prefer `meta.paths[].hops[kind==='origin'].name`; fall back to the `"name: "` prefix parsed from `body`. When the sender is surfaced in title/subtitle, **strip the `"name: "` prefix from the body** to avoid duplication.
- **Delimiter:** `—` (em dash), a single module constant. `•` remains the mention marker only.
- **Truncation:** keep the existing 240-char body cap.
- DMs: `subtitle` omitted (would duplicate the title).

### 5.2 Staleness aggregation (Goal 3)

- **Classify** (`aggregator.ts`): a message that passes `policy` is **live** if `now − msg.ts ≤ STALE_THRESHOLD_MS`, else **stale**.
- **Live** → `present.individual` immediately (5.1 formatting, deep-link click).
- **Stale** → accumulate per-conversation state `{count, senders:Set<string>, lastTs}`, schedule a debounced flush (reset timer on each new stale message).
- **Flush** posts/refreshes one **summary** notification per conversation:
  - Channel: title=`#general`, body=`{count} new messages` → `{count} messages from Alice, Bob +N` when the sender list fits.
  - DM: title=`Alice`, body=`{count} new messages`.
  - `id = summary:<key>` (stable → refresh replaces in place), `groupId = <key>`.
  - Click → `{kind:'focusFirstUnread', key}`.
- **Global rollup:** when more than `ROLLUP_CONVERSATION_CAP` conversations have active summaries, remove the per-conversation summaries and post a single global summary: `id = summary:__all__`, body=`{total} messages across {M} conversations`. Its click focuses the most-recently-active backlogged conversation's first unread.
- **`groupId = conversation key`** is set on **all** message notifications (individual + summary) so the OS also stacks by conversation (macOS thread / Windows group; Linux ignores).

### 5.3 Click deep-linking (Goal 2)

Extend the `MenuAction` union (`src/shared/types.ts:844-868`) and the renderer switch (`src/renderer/app/menuActions.ts`). The WS bridge (`bus.ts` → `server.ts` → `wsHandlers.ts`) is generic over `MenuAction` — no change needed there.

- New variants:
  - `{ kind: 'focusMessage'; key: string; messageId: string }`
  - `{ kind: 'focusFirstUnread'; key: string }`
- Renderer handlers:
  - `focusMessage` → `setActiveKey(key)` then `setPendingJump(messageId)`.
  - `focusFirstUnread` → `setActiveKey(key)` then jump to the first message with `ts > lastReadByKey[key]` (compute in the handler; reuse `setPendingJump`).

### 5.4 Inline reply (extra)

- `hasReply: true` + `replyPlaceholder` on individual and summary notifications where `supportsReply` (macOS/Windows).
- `notification.on('reply', (e) => actions.reply(key, e.reply))`.
- `actions.reply(key, text)` sends via the existing send flow. **Refactor:** extract `src/main/api/routes.ts:617-668` into a shared `sendMessage(key, body)` helper (optimistic insert + `protocolSession().sendChannelText` / `sendDmTextWithRetry` + state transitions + `registerChannelSend`). Both the HTTP route and `actions.reply` call it.
- Channel reply → `sendChannelText(key, text)`; DM reply → `sendDmTextWithRetry(key, text, id)`.

### 5.5 Action buttons (extra)

- Where `supportsActions` (macOS/Windows): add buttons **Mark as read** and **Mute**.
- `notification.on('action', (e) => …)` dispatched by `actionIndex`.
- `actions.markRead(key)`: `holder.setUiState({...ui, lastReadByKey:{...,[key]:Date.now()}})` + `emit.uiState(holder.getUiState())`. This updates the renderer store (via the existing `uiState` WS path, which applies `lastReadByKey`) **and** triggers `recomputeBadge()`. Then `present.clear(key)`.
- `actions.mute(key)`: read the record from `holder.getChannels()`/`getContacts()`, spread `{muted:true}`, `holder.upsertChannel/upsertContact`, `emit.channels/contacts`. Persists (settings store) and reflects in UI; mute already suppresses future notifications via `isMutedKey`.
- macOS: `hasReply` shows inline; the two buttons appear in the expanded view. Accept this platform limitation.

### 5.6 Clear on read (extra)

- On a read/open of a conversation (observed via the `uiState` bus event — `lastReadByKey[key]` advanced, or `activeKey` change), call `present.clear(key)`:
  - `supportsRemove` (macOS/Windows): `Notification.removeGroup(key)` clears the summary + any individual banners still in Notification Center; also reset `aggregator` state for `key`.
  - Linux: no `removeGroup`; just reset `aggregator` state so future counts restart.
- Optional robustness (macOS, later): `Notification.getHistory()` on launch to re-attach handlers to notifications that survived an app restart. Not required for v1.

### 5.7 Platform matrix (summary)

| Feature | macOS | Windows | Linux |
|---|---|---|---|
| Sender surfacing | subtitle | title delimiter | title delimiter |
| Click deep-link | ✅ | ✅ | ✅ |
| groupId stacking | ✅ | ✅ | — |
| Summary aggregation | ✅ | ✅ | ✅ (no OS grouping) |
| Inline reply | ✅ | ✅ | — |
| Mark read / Mute buttons | ✅¹ | ✅ | — |
| Clear on read | ✅ | ✅ | reset state only |

¹ needs signing (done) + `NSUserNotificationAlertStyle: 'alert'`.

## 6. Settings changes

- Reuse all existing per-kind toggles + `sound` + `suppressWhenFocused` + per-conversation `muted`.
- **Add one setting:** `notifications.summarizeBacklog: boolean` (default **true**). When false, stale messages notify individually (today's behavior). Changes:
  - `AppSettings.notifications` type (`src/shared/types.ts:349-360`) + defaults (`~:445-455`).
  - New `Toggle` row in `src/renderer/panels/settings/app/Notifications.tsx`.

## 7. Build config changes

- Add `NSUserNotificationAlertStyle: 'alert'` to `extendInfo` in `forge.config.ts:82-89` (required for macOS action buttons; must go through `extendInfo` because ASAR integrity validation forbids post-build plist edits).

## 8. Constants / defaults

| Constant | Value | Rationale |
|---|---|---|
| `STALE_THRESHOLD_MS` | `5 * 60_000` (5 min) | Tolerant of mesh store-and-forward latency; older = clearly "was waiting." |
| `SUMMARY_FLUSH_MS` | `1_000` | Matches the ~250 ms drain cadence; one refresh per burst-pause. |
| `ROLLUP_CONVERSATION_CAP` | `5` | Beyond this, collapse to one global summary. |
| body truncation | `240` (existing) | Unchanged. |
| `MAX_NOTIFIED_IDS` | `500` (existing) | Unchanged. |

## 9. Testing strategy

- **`format.ts` (unit):** each platform × {channel, channel+mention, DM}; sender extraction from `paths` and from `"name: "` prefix; prefix stripping; delimiter; truncation.
- **`aggregator.ts` (unit, fake clock):** stale vs. live classification at the 5-min boundary; per-conversation counting + sender set; debounce flush timing; global rollup at the cap; clear-on-read reset.
- **`policy.ts` (unit):** gate order preserved (block, dedup, mute, kind toggle, suppress-when-focused).
- **Integration:** drive bus `messages` with fresh vs. stale `ts` → assert individual vs. summary; drive `uiState` read → assert `removeGroup(key)` + state reset; mock `electron.Notification`, `protocolSession`, `emit`.
- **actions:** `reply` calls the shared `sendMessage`; `markRead` emits `uiState`; `mute` upserts + emits. Assert with mocks.
- Follow existing main-process test setup; Linux/macOS/Windows branches tested via mocked `process.platform`.

## 10. Known limitations

- **DM message ids are random per receipt** (`radio-<ts>-<rand>`), so a re-drained DM after reconnect can inflate a summary count and cannot be perfectly deduped. Minor.
- **Sender clock skew:** a live message from a badly-skewed node could be classified stale (→ summary) or a slightly-old backlog message classified live (→ banner). The 5-min threshold is tolerant; acceptable.
- **macOS `hasReply` + multiple buttons** is constrained by the OS; buttons appear in the expanded view.

## 11. File-by-file change list

**New:** `src/main/notifications/{platform,format,policy,aggregator,present,actions,index}.ts` + colocated tests.

**Modified:**
- `src/main/notifications.ts` → replaced by the module (re-export `startNotifications` for `src/main/index.ts:177` compatibility, or update the import).
- `src/shared/types.ts` — `MenuAction` union (+2 variants); `AppSettings.notifications` (+`summarizeBacklog`) + defaults.
- `src/renderer/app/menuActions.ts` — `focusMessage`, `focusFirstUnread` cases (extend deps if needed).
- `src/renderer/panels/settings/app/Notifications.tsx` — `summarizeBacklog` toggle.
- `src/main/api/routes.ts` — extract shared `sendMessage(key, body)` helper (used by route + `actions.reply`).
- `forge.config.ts` — `extendInfo.NSUserNotificationAlertStyle = 'alert'`.

**Unchanged bridges (generic over `MenuAction`):** `src/main/events/bus.ts`, `src/main/server.ts`, `src/renderer/app/wsHandlers.ts`.
