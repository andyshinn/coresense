# Channel Info Panel — Derived Details, People Roster, ColoredUsername & QR Share

- **Date:** 2026-07-06
- **Status:** Approved design — ready for implementation planning
- **Area:** Renderer right rail (`src/renderer/shell/rightrail`), main-process message store + API, shared types

## 1. Context & Motivation

The right-rail "Channel info" panel currently shows four static facts — Name, Kind, Secret (truncated), Muted — rendered by [`ChannelInfoSection`](../../../src/renderer/shell/rightrail/sections/ChannelInfo.tsx) (16 lines). It is a read-only fact sheet.

We want to enrich it with **derived/calculated** details: when the channel was added, how active it is, who has been seen in it (with the app's consistent per-name colors), and a way to share the channel via its `meshcore://` URI / QR code (matching the official MeshCore app). Along the way we consolidate the duplicated colored-username rendering into one reusable component.

## 2. Goals

1. Turn the channel panel into **four collapsible sections**: Channel info, Activity, People, Share.
2. Add an honest, full-history **stats source** (message counts, first/last, distinct posters, per-sender roster, 7-day buckets) backed by SQLite.
3. Add a durable **"Added on"** date (`Channel.createdAt`).
4. Add a **People roster**: scrollable list of users seen in the channel, each with a colored name, message count, and last-seen time.
5. Consolidate colored-username rendering into a reusable **`<ColoredUsername>`** component.
6. Add a **Share** section with a `meshcore://channel/add` QR code + copy-link + copy-secret.

## 3. Non-goals / Out of scope (deferred — see §17)

- Top-posters / ranked leaderboard pills (explicitly dropped as not useful).
- Per-name "unverified/spoofable" badges in the roster (dropped; see §13 for why identity is still documented).
- "Your send delivery health" tally (valuable but deferred to a later pass).
- Mesh/RF-derived details (SNR/hops/reach/entry-repeater) — not in this scope.
- Recoloring names in sidebar/search/contact-manager rows (avoid "rainbow noise"; deferred follow-up).
- Importing channels from a pasted `meshcore://channel/add` URI (this spec only *generates* the share URI; the existing [`meshcoreUri.ts`](../../../src/renderer/lib/meshcoreUri.ts) decoder handles only the older contact-advert form).

## 4. Current state (grounding)

- **Channel model** ([types.ts:68-83](../../../src/shared/types.ts)): `key`, `name`, `kind` (`public｜hashtag｜private`), `secretHex?`, `muted?`, `pinned?` (unused — no pinning concept), `idx?` (radio slot), `order?`. No `createdAt`.
- **Rail sections**: [`RightRail`](../../../src/renderer/shell/rightrail/index.tsx) renders an ordered `RailSection[]` from [`sectionsFor()`](../../../src/renderer/shell/rightrail/sectionsFor.tsx), each wrapped in [`<Collapsible>`](../../../src/renderer/components/Collapsible.tsx). Open state persists per section id in `ui.openRailSections` via `setRailSection`. `Collapsible` mounts children **only when open** (`{open && <div>{children}</div>}`), so a section that fetches on mount fetches **only on expand**.
- **Messages** live in SQLite ([db.ts](../../../src/main/storage/db.ts)): `messages(id, mid, kind, key, ts, from_pk, body, state, meta)`, indexes `messages_by_key_ts (key, ts DESC)` and `messages_by_from_pk`. A message links to a channel by `key = 'ch:<name>' == Channel.key`. Retention ~1000 msgs/key (`trimPerKey`). Query layer: [`messagesStore`](../../../src/main/storage/messages.ts).
- **Sender identity** (`from_pk`): `NULL` = self; `'name:<DisplayName>'` = channel poster (name-based, **spoofable**, not a pubkey); `'unknown'`; else a hex pubkey (DM/known contact). Decoded by [`deriveSenderName`](../../../src/renderer/lib/utils.ts).
- **Username color** is already DRY at the compute layer: [`getNameColor()`](../../../src/renderer/lib/contactColor.ts) → `{ fg, bg, pillBg }` (`pillBg` currently unused/dead). Rendering is split across `SenderLabel` (text) and `ContactAvatar` (initials); `MentionPill` is intentionally neutral. Plain uncolored names appear in search/sidebar/contacts.
- **Unread** already computed renderer-side per key ([useUnreads.ts](../../../src/renderer/hooks/useUnreads.ts)); `markAllRead(key)` exists in the store.

## 5. Design overview

Replace the single `rail.channel.info` section with four registered sections for the `channel` view kind in `sectionsFor()`:

| Section id | Label | Default | Data source |
|---|---|---|---|
| `rail.channel.info` | Channel info | **open** | channel fields + newest message (renderer) |
| `rail.channel.activity` | Activity | collapsed | `useChannelStats` (SQLite, on expand) |
| `rail.channel.people` | People | collapsed | `useChannelStats` (SQLite, on expand) |
| `rail.channel.share` | Share this channel | collapsed | channel fields (renderer) |

`defaultOpen` for `rail.channel.info` keeps the existing `baseDefaultOpen` behavior (open unless a message/mention section is promoted above it). The other three default collapsed so SQLite is only queried when the user opens them.

## 6. Data model change — `Channel.createdAt`

- Add `createdAt?: number` (epoch ms) to `Channel` in [types.ts](../../../src/shared/types.ts). Optional → backward-compatible with existing `channels.json` (old entries simply lack it).
- **Stamp** it:
  - On user creation in [`AddChannelPopover`](../../../src/renderer/components/AddChannelPopover.tsx) when building the channel object.
  - In [`mergeChannels`](../../../src/main/protocol/mergeChannels.ts) for a radio-synced channel seen for the first time; **preserved-from-prev** on subsequent syncs (same treatment as `muted`/`order`).
- **Backfill / fallback:** pre-existing channels lack `createdAt`. The always-open Channel-info section does **not** fetch stats, so its "Added on" row shows the exact `createdAt` when present and **"unknown"** when not yet stamped (no cross-section stats dependency). The honest history anchor for pre-existing channels is the **Activity** section's "First seen" row (`stats.first`), which already loads stats on expand. New and re-synced channels get an exact `createdAt`.

## 7. Main process — stats query + API route

### 7.1 `messagesStore.statsByKey(key)` — [messages.ts](../../../src/main/storage/messages.ts)

Returns one struct (all values derived from the `messages` table on existing indexes; bounded by retention):

```ts
interface ChannelStats {
  count: number;              // total retained messages for this key
  first: number | null;       // MIN(ts)
  last: number | null;        // MAX(ts)
  count24h: number;           // ts >= now - 24h
  count7d: number;            // ts >= now - 7d
  distinctSenders: number;    // distinct identifiable non-self senders (excludes NULL self and 'unknown')
  roster: Array<{             // GROUP BY from_pk, ORDER BY last DESC
    fromPk: string | null;    // raw from_pk ('name:…' | hex | 'unknown' | null=self)
    count: number;
    lastTs: number;
  }>;
  perDay: number[];           // 7 local-day buckets, oldest → newest (last 7 days)
}
```

Implementation notes:
- `count/first/last`: `SELECT COUNT(*), MIN(ts), MAX(ts) FROM messages WHERE key=?`.
- `count24h/count7d`: `COUNT(*) … AND ts >= ?` (two bounded counts, or conditional sums in one pass).
- `roster`: `SELECT from_pk, COUNT(*) c, MAX(ts) last FROM messages WHERE key=? GROUP BY from_pk ORDER BY last DESC`.
- `distinctSenders`: derived from roster (count rows whose decoded identity is a real name/pubkey — exclude self `NULL` and `'unknown'`).
- `perDay`: fetch `ts` for the last 7 days (`WHERE key=? AND ts >= cutoff`) and bucket by **local day in JS** in the route handler (tz-correct; SQL integer-day bucketing is UTC-only).

### 7.2 Route — [routes.ts](../../../src/main/api/routes.ts) (near the messages route ~L630)

`GET /api/channels/:key/stats` → `ChannelStats`. Validate the key is a `ch:` key; 404/empty struct for unknown.

## 8. Renderer — hook + api client

- Add `getChannelStats(key)` to the API client ([api.ts](../../../src/renderer/lib/api.ts)).
- Add `useChannelStats(key)` hook: fetches on mount (i.e., on section expand), caches per key, and **refetches when new messages for `key` arrive** (subscribe to the length/last-ts of `messagesByKey[key]` in the store as a cheap invalidation signal). Exposes `{ stats, loading, error }`.

## 9. Component — `<ColoredUsername>`

New `src/renderer/components/ColoredUsername.tsx`, built on [`getNameColor()`](../../../src/renderer/lib/contactColor.ts).

- **Input:** `sender?: string` — the **raw `from_pk`**; the component runs `deriveSenderName` internally and classifies identity: **self** (`from_pk` nullish → `selfLabel`, neutral color), **name-based channel poster** (`'name:…'` → colored), **verified pubkey/contact** (hex → colored, resolvable via `contactByPk`), **unknown** (`'unknown'` → neutral "Unknown"). A `name?: string` escape-hatch prop covers callers that only have a plain display name.
- **Props:** `sender?`, `name?`, `variant?: 'text' | 'pill'` (`'pill'` uses the now-revived `pillBg`), `showAvatar?: boolean` (composes `ContactAvatar` on the left), `onClick?`, `size?: 'sm' | 'md'`, `selfLabel?` (default `'You'`), `className?`. Static styling via Tailwind + `cn()`; the dynamic per-name HSL color via inline `style` (existing convention).
- **Badge:** an identity/"unverified" badge capability may exist on the component but is **off by default** (matches current message-list behavior; no badges shown in this feature).
- **Migration:** `SenderLabel` becomes a thin alias to `<ColoredUsername variant="text" />`, then is removed; migrate the two [`MessageItem`](../../../src/renderer/components/MessageItem.tsx) call sites (L88, L118). `ContactAvatar` remains a sibling. **`MentionPill` is NOT migrated** — it stays intentionally neutral. Revive `pillBg` via the `pill` variant (used by roster rows if desired); if `pill` is not built, delete `pillBg` rather than leaving it dead.

## 10. Section components

New files under `src/renderer/shell/rightrail/sections/`:

- **`ChannelInfo.tsx`** (extend existing) — rows: Name · Kind · **Secret** (masked by default, click-to-reveal + copy-to-clipboard; never render full hex in the always-visible state) · **Muted** (inline toggle, app-owned; wire to the existing channel-update path, [routes.ts ~L489](../../../src/main/api/routes.ts) / holder `upsertChannel`) · **Slot** (`idx`, read-only; render "not synced" when `undefined`, never `0`) · **Added on** (`createdAt`; "unknown" when not yet stamped) · **Last active** (relative label from newest loaded message ts, `now − max(ts)`; newest is always in the loaded window).
- **`ChannelActivity.tsx`** (new) — uses `useChannelStats`. Rows: **"N unread · Mark all read"** (reuse `computeUnreadByKey` + `markAllRead(key)`; show "muted — not counted" when muted) · **Volume** `count24h` / `count7d` · **7-day sparkline** (tiny inline-SVG from `perDay`) · **First seen · span · ~avg/day** (from `first`/`last`/`count`).
- **`ChannelPeople.tsx`** (new) — uses `useChannelStats`. Header: **"N people seen"** (`distinctSenders`). Body: **scrollable roster** in a fixed-height `overflow-y-auto` container; each row = `<ColoredUsername sender={fromPk} />` · **message count** · last-seen (relative). Self renders as "You" (neutral); `'unknown'` collapses to a single "Unknown" row. **Ordered by most-recently-active** (`lastTs` desc). No caption.
- **`ChannelShare.tsx`** (new) — builds the `meshcore://channel/add` URI (§11) and renders: **QR** (`react-qr-code`, inline SVG) · **copy link** · **copy secret** · a short caution line that the code grants full read/write access. Only rendered when `channel.secretHex` is present; otherwise a "secret unavailable — cannot generate share code" note.

`sectionsFor()` registers all four for `case 'channel'`, preserving the existing `mentionedSections`/`messageSections` promotion above them.

## 11. `meshcore://` URI builder + QR

- **Format (confirmed against the official spec, docs.meshcore.io/qr_codes):**
  `meshcore://channel/add?name=<url-encoded name>&secret=<32-hex-char secret>`
  Example for #worldcup: `meshcore://channel/add?name=worldcup&secret=d5786cc7bcee5a48…`. The channel secret is 16 bytes = 32 lowercase hex chars. There is no `kind`/`type` param for channels. The QR code contains exactly this URI text.
- **Builder:** small pure function `buildChannelShareUri(channel)` (renderer lib, e.g. `src/renderer/lib/channelShare.ts`) → `meshcore://channel/add?name=${encodeURIComponent(name)}&secret=${secretHex}`. Unit-tested.
- **QR rendering:** `react-qr-code` ([rosskhanas/react-qr-code](https://github.com/rosskhanas/react-qr-code), npm `react-qr-code`) — pure SVG, satisfies the app CSP (`img-src 'self' data: blob:`; no external QR service). New dependency.

## 12. Decisions & defaults

- **Data source:** SQLite stats route (approved) — honest full-history numbers vs. the renderer's partial ~200-msg window.
- **Roster:** dropped top-posters pills; message count is inline per roster row; **ordered by most-recently-active**.
- **No roster caption** (identity caveat not surfaced in UI).
- **Own sends count as activity** — Last-active = newest message regardless of sender; volume counts all messages.
- **Colorize scope:** `<ColoredUsername>` used in the message list + People roster only. Sidebar/search/contact rows unchanged.
- **Sparkline** is the one "moderate" piece; acceptable to ship Activity with counts only and add the sparkline later if it fights the timeline.
- **Pinning:** no pinning controls (no such concept); the stray `pinned?` field is left untouched.

## 13. Caveats & considerations (documented, not surfaced as UI captions)

- **Spoofable identity:** channel senders are name-based, not cryptographic — counts and roster names are a soft signal, not an authoritative headcount. Implementation must not present them as verified. (We chose not to show a UI caption, but code/comments should reflect this.)
- **Observed-by-this-node:** all counts reflect messages this radio received while online/in range, bounded by ~1000-msg/key retention — not true channel traffic. Copy should avoid implying totals are absolute.
- **Offline gaps** dilute avg/day and can make an empty sparkline day look like a quiet channel.
- **Share grants access:** the QR/URI embeds the full PSK; anyone scanning gets full read/write. Gated by the collapsed Share section + a caution line.
- **"heard" ≠ read** (relevant if send-health lands later): for channels, "heard" means N repeaters echoed the packet, not that a human read it.

## 14. Testing

- **Unit (main):** `statsByKey` against a seeded in-memory/temp SQLite DB — counts, first/last, 24h/7d windows, roster grouping/order, distinct-sender exclusion of self/unknown, `perDay` bucketing.
- **Unit (renderer):** `buildChannelShareUri` (encoding, missing secret); `deriveSenderName`/identity classification in `<ColoredUsername>`; `useChannelStats` fetch + invalidation.
- **Component/DOM:** `<ColoredUsername>` renders self as "You" neutral, name-based colored, correct color from `getNameColor`; People roster ordering + inline counts; Collapsible lazy-mount (stats fetch fires only on expand).
- **Regression:** existing `SenderLabel` call sites still render after migration; `MentionPill` unchanged; existing `meshcoreUri.test.ts` unaffected.
- Scope lint/test runs to `src tests` per repo convention.

## 15. Dependencies

- Add **`react-qr-code`** (pure-SVG QR component). No other new runtime deps.

## 16. File-by-file change list

**Shared**
- `src/shared/types.ts` — add `Channel.createdAt?: number`; add `ChannelStats` interface.

**Main**
- `src/main/storage/messages.ts` — add `statsByKey(key)`.
- `src/main/api/routes.ts` — add `GET /api/channels/:key/stats`.
- `src/main/protocol/mergeChannels.ts` — stamp/preserve `createdAt` for radio-synced channels.

**Renderer — data**
- `src/renderer/lib/api.ts` — `getChannelStats(key)`.
- `src/renderer/hooks/useChannelStats.ts` — new hook.
- `src/renderer/lib/channelShare.ts` — `buildChannelShareUri(channel)`.
- `src/renderer/components/AddChannelPopover.tsx` — stamp `createdAt` on create.

**Renderer — components**
- `src/renderer/components/ColoredUsername.tsx` — new.
- `src/renderer/components/SenderLabel.tsx` — alias → remove after migration.
- `src/renderer/components/MessageItem.tsx` — migrate L88/L118 to `<ColoredUsername>`.
- `src/renderer/lib/contactColor.ts` — use/keep `pillBg` (pill variant) or delete it.

**Renderer — rail sections**
- `src/renderer/shell/rightrail/sectionsFor.tsx` — register the four channel sections.
- `src/renderer/shell/rightrail/sections/ChannelInfo.tsx` — extend (secret reveal/copy, muted toggle, slot, added-on, last-active).
- `src/renderer/shell/rightrail/sections/ChannelActivity.tsx` — new.
- `src/renderer/shell/rightrail/sections/ChannelPeople.tsx` — new.
- `src/renderer/shell/rightrail/sections/ChannelShare.tsx` — new.

**Deps**
- `package.json` / lockfile — add `react-qr-code`.

## 17. Follow-ups (deferred)

- "Your send delivery health" tally (owner sends grouped by state).
- Import channels from a pasted `meshcore://channel/add` URI (reciprocal of the share builder).
- Optionally recolor sidebar/search/contact-manager names via `<ColoredUsername>`.
- Mesh/RF-derived channel details (SNR/hops/reach/entry-repeater).
- Deterministic channel color/emoji sigil; channel fingerprint (randomart) from the secret.
