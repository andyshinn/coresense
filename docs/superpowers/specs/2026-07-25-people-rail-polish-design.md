# People rail polish — design

**Date:** 2026-07-25
**Branch:** `worktree-people-rail-polish` (off `origin/main` @ `3094fec`)
**Design source:** Claude Design project `019dff75-f714-7198-960c-c5a2c63dfd1b`,
`design_handoff_people_rail/People - Full.html` + its `README.md`.

Rebuilds the **People** section of the channel right rail per the *People — Full*
handoff: identity demoted to a 7px dot, names uncoloured, count and age as
right-aligned mono columns, contact state carried by the dot's fill, and a header
that turns a passive read-out into a searchable directory.

Chosen handoff configuration (settled, not revisited here): identity carrier
**Dot**, contact state **Fill**, last-seen **Compact** (`now · 12m · 3h · 2d · 3w`),
row density **Default — 24px**.

---

## 1. What is wrong today

`src/renderer/shell/rightrail/sections/ChannelPeople.tsx` renders a `"N people seen"`
sub-line then flex rows of `ColoredUsername` + a `UserX` hover card + count +
`RelativeTime`. All four problems the handoff diagnoses are present:

1. The name is the largest, boldest element and it carries a hash — 30 rows become
   30 competing labels.
2. Those hues (10-slot HSL, `contactColor.ts`) emit lime/red/amber, which already
   mean **online**, **danger** and **accent** elsewhere.
3. There are no columns — age is left-aligned against variable-width strings and
   the word "ago" is printed once per row.
4. `UserX` fires on almost every row (most channel posters are not contacts) and
   sits *after* the name, so its x-position moves with name length.

---

## 2. Constraints discovered in this codebase

These are verified facts that shaped the design. They are recorded because several
contradict the handoff.

### 2.1 Channel posters have no pubkey — anywhere

Confirmed at three layers:

- **Wire/library** — `@andyshinn/meshcore-ts/dist/index.js:2238-2240`:
  `fromPublicKeyHex: parsed.senderName ? \`name:${parsed.senderName}\` : "unknown"`,
  with the comment *"No pubkey at the channel-message layer"*.
- **Path metadata is not a backdoor** — `buildPath()` hard-codes `pk: null` on the
  `origin` hop, every `hop`, and the `sink`.
- **Storage** — `messages` has exactly one sender column, `from_pk TEXT`.

So the handoff's `slot = hash(pubkey) % 12` is unimplementable as written, and its
stated guarantee (*"renaming a node must not change its colour"*) is one this app
cannot make for channel posters. **The reference HTML itself hashes the display
name**, so the mock already contradicts its own prose.

Resolution: §4 makes the hash input a **user setting**.

### 2.2 The handoff's row hover is invisible here

The mock rail sits on `--bg` (`#0C0A06`) and hovers to `--bg2`. The real rail is
`<aside className="… bg-cs-bg-2">` (`rightrail/index.tsx:87`). `bg-cs-bg-2` hover on
a `bg-cs-bg-2` rail is a zero-pixel delta.

The house idiom is *"one step up from whatever you are sitting on"* —
`MessageItem.tsx:83` hovers `group-hover:bg-cs-bg-2` on a `cs-bg` surface (and uses
`bg-cs-accent-soft/15` for **selected**, not hover). On a `cs-bg-2` rail that means
**`bg-cs-bg-3`**.

### 2.3 Commit Mono is not bundled

`--font-mono` is `ui-monospace, "JetBrains Mono", "SF Mono", Menlo, Consolas`
(`index.css:107`) and no webfont ships (Inter is a bare family reference too).
On macOS `ui-monospace` resolves to SFNSMono, advance **1266/2048 = 0.61816 em** —
the widest member of the stack, so it is the binding case. At `text-[11px]` that is
6.80px/char, so a 4-character `999+` needs 27.2px and will not fit the handoff's
26px count track. Resolved in §5.3 by capping the count at 3 characters.

Bundling fonts is explicitly out of scope.

### 2.4 The rail is a single scroll container

`rightrail/index.tsx:118` is one `<div className="h-full overflow-y-auto py-1">`
wrapping auto-height `Collapsible` sections. Virtualisation is **out of scope**, so
the People list is plain flow content and the rail scrolls as one column. This
removes the only structural question in the work.

### 2.5 Smaller verified facts

| Fact | Consequence |
|---|---|
| `DEFAULT_UI_STATE.rightWidth: 320` (`types.ts:831`) but the handoff's control-bar threshold is 330 | Every existing user would land in degraded narrow mode. §5.5 |
| A `TooltipProvider` is already ambient over the rail (`ui/sidebar.tsx:100`, inside `SidebarProvider`) with `delayDuration={0}` | Do **not** mount a second; set a delay per `<Tooltip>`. §5.6 |
| `Collapsible` already has a `trailing?: ReactNode` slot, used by nobody | The header count has a home. `RailSection` needs the field plumbed. §5.4 |
| `<Collapsible key={section.id}>` where id is the constant `'rail.channel.people'` | The section does **not** remount on channel switch; clearing `query` needs an explicit effect. §6 |
| `RelativeTime` mounts one `setInterval(…, 60_000)` **and** one zustand subscription per instance | 156 rows = 156 of each. Replaced by one shared tick. §6 |
| `dayKey()` returns a `YYYYMMDD` int | Fine for "is today", **unusable** for "yesterday" across month boundaries. §5.7 uses a midnight-difference helper instead. |
| `name` has no `UNIQUE` constraint in `discovered_contacts` (`db.ts:83-100`, `ON CONFLICT(pubkey)` only) | name→pubkey is one-to-many. §4.2 |
| `applyUiState` whitelists exactly 6 fields (`store.ts:742-772`) — that governs **cross-client sync** of `UiState` only | New `ui` fields persist locally but do not sync. Acceptable. §6 |
| `AppSettings.theme` is dead — nothing in `src/` or `tests/` reads it; the live theme is `ui.themePref` | Out of scope; noted in §10. Do not model the new setting on it. |
| `statsByKey` always returns a struct with `roster: []`, so a silent channel shows "0 people seen" rather than the placeholder | Fixed incidentally by §7.3's empty state. |

---

## 3. Scope

**In:** the data mapper and pure model, the row, the controls (search / sort /
filter / buckets / width mode / empty states), and the app-wide identity ramp swap
(transcript author names, avatars, `SetPathEditor`).

**Out:** list virtualisation; bundling Commit Mono or Inter; fixing the dead
`AppSettings.theme` field; rail-local contact-detail override.

---

## 4. Identity

### 4.1 The setting

| | |
|---|---|
| Type | `export type IdentityColorMode = 'byKey' \| 'byName';` in `src/shared/types.ts`, beside `ThemePrefValue` |
| Field | `identityColorMode: IdentityColorMode;` — **flat scalar** on `AppSettings`, not nested (`store.hydrate` assigns `snapshot.appSettings` raw, so a nested read throws on a partial snapshot) |
| Default | `identityColorMode: 'byKey'` in `DEFAULT_APP_SETTINGS` (`types.ts:470`) |
| UI | A 5th `<Row>` in the **existing** `app-appearance` section (`panels/settings/app/Appearance.tsx`). No new section id, no `TAB_SECTIONS` edit, no jump-rail registration. |
| Control | `<Select>` from `components/settings/Field.tsx` with a module-scope `IDENTITY_COLOR_OPTIONS` const (this repo has no segmented control) |
| Persist | `saveApp(client, {…})` → `PUT /api/settings/app` → atomic write to `<userData>/app-settings.json`. Zero new code — `saveApp` spreads the full current object. |
| Migration | None. `mergeDefaults` (`storage/settings.ts:174-190`) back-fills the key on next launch. |
| Read | `useStore((s) => s.appSettings.identityColorMode ?? 'byKey')` — keep the `??` defensively. |

Copy:

```
Label:       Identity colour
Description: How each person's colour is chosen. By key only colours people whose
             public key is known, so a colour always means the same node. By name
             gives everyone a colour derived from their display name.
Options:     By key (only verified identities)  |  By name (everyone gets a colour)
Warning:     (shown while draft === 'byKey')
             Channel posts carry a name, not a key. Posters stay grey until this
             node hears an advert from them.
```

`Row` already supports `warning?: string` rendered `text-cs-warn` (`Field.tsx:45`).

**Three edits are required in `Appearance.tsx`** — the `<Row>`, the
`identityColorMode` comparison in `eqAppearance`, and the field in the `saveApp`
patch. Omitting the `eq` line means the Save button never enables.

### 4.2 Resolution

New pure module `src/renderer/lib/identity.ts`:

```ts
resolveIdentity(fromPk, contacts, discoveredIndex) → {
  name: string | null,
  pubkey: string | null,
  contactKey: string | null,
  source: 'contact' | 'discovered' | 'none',
  ambiguous: boolean,
  blocked: boolean,
}
buildDiscoveredNameIndex(discovered: DiscoveredContact[]) → Map<string, DiscoveredContact[]>
identitySlot(id: string): number            // djb2(id) % 12
```

Rules:

- `fromPk === null` (self) or `'unknown'` → excluded from the roster entirely (§5.1).
- `'name:<n>'` → `contacts.find(c => c.name === n)` first (`source: 'contact'`,
  pubkey `c.publicKeyHex`, contactKey `c.key`); else the discovered index.
- Matching is **exact `===`** — no case folding, no trimming. This mirrors
  today's `contactKeyForSender` and the same resolution `@mention` pills use.
- A discovered-index hit of length > 1 → `ambiguous: true`, `source: 'none'`.
  Chosen over newest-advert-wins deliberately: the roster re-broadcasts in full on
  every advert, so newest-wins would let a stranger's advert visibly flip a
  person's hue mid-session.
- A raw hex `fromPk` (not currently produced for channel posts, but the branch
  exists today) → `pubkey: fromPk`, `source: 'contact'` if a contact matches.
- `blocked` comes from the resolved `DiscoveredContact.blocked`.

### 4.3 Hue semantics per mode

This table covers **every consumer app-wide**, not just the rail. Self and
`'unknown'` are excluded from the *roster* (§5.1) but still appear in the
transcript, which is why they have rows here.

| Consumer | `byKey` (default) | `byName` |
|---|---|---|
| Rail dot | `identitySlot(pubkey)` when `source !== 'none' && !ambiguous`; else **neutral** | `identitySlot(name)`, always coloured |
| Dot fill | filled ⇔ `source === 'contact'`; hollow otherwise. **Unaffected by mode.** | same |
| Rail row name | always `text-cs-text` — never tinted, in either mode | same |
| Transcript author name (`ColoredUsername`) | hue from a real hex `fromPublicKeyHex`; if `name:<n>`, from the *resolved* pubkey; else neutral | hue from the display name |
| Avatar (`ContactAvatar`) | fill + glyph from the resolved pubkey; unresolved → neutral fill + `cs-text-dim` glyph | fill + glyph from the display name |
| Self | **neutral in both modes** — the current deliberate behaviour (`ColoredUsername.tsx:29-31`). Do not wire in `owner.publicKeyHex`: `owner` is in-memory only and `null` until a radio connects. |
| `'unknown'` | neutral in both modes | neutral |
| `SetPathEditor` known repeater | hue from `publicKeyHex` (via `repeaterChoices[].contactKey`) | hue from name |
| `SetPathEditor` unknown hop | hue from `prefixHex` — it *is* key material | **neutral** (today it hashes a hex prefix under a "by name" premise; this is a fix) |
| Search results (`panels/search/MessageRow.tsx`) | uncoloured today; **out of scope in both modes** — pre-existing inconsistency, do not silently fix | same |

### 4.4 The three-tier dot

Because being a contact implies having a key, only three of the four
(hue × fill) combinations exist under `byKey`, and they map 1:1 onto row
actionability:

| Dot | Meaning | `MessageSquare` | `UserPlus` |
|---|---|---|---|
| ● filled, hued | saved contact | enabled | not rendered |
| ○ hollow, hued | advert heard, not saved | disabled — *"Add to contacts to message"* | enabled |
| ○ hollow, grey | name only, never heard | disabled | disabled — *"No advert heard from this node yet"* |

This is why retiring `UserX` costs no information: the grey hollow dot **is** the
replacement, in a fixed 7px column at a predictable x-position rather than floating
after a variable-width name — which is exactly the handoff's stated objection to
the badge.

Under `byName` tiers 2 and 3 look identical and the disabled actions plus their
tooltips carry the distinction alone.

**Blocked identities** resolve their hue normally (identity is identity) but keep
both actions disabled with a *"Blocked"* tooltip.

### 4.5 Consequences of `byKey` as the default

Stated plainly so nobody is surprised:

- On upgrade, **most channel rows go grey**, and because the ramp swap is
  app-wide, most transcript author names go neutral too. DMs and anyone who has
  adverted keep their colour.
- The 10→12 slot change reassigns every existing person's hue regardless of mode.
  Unavoidable, happens once. Do **not** attempt to preserve slot assignments —
  that would need a stored per-identity slot map, which is real state for a
  cosmetic. Nothing in the app labels a person by colour and no colour is
  persisted, so this is safe.
- Flipping the setting reassigns hues again for everyone resolvable, because the
  hash input changes from name-string to pubkey.
- Bug fixed incidentally: today a DM peer's hue changes when you **save them as a
  contact**, because the hashed string flips from the hex key to the name
  (`MessageList.tsx:86-88`). `byKey` fixes this; `byName` keeps the wart.

---

## 5. The section

### 5.1 Row data

No server change. The renderer maps `ChannelSenderStat {fromPk, count, lastTs}` to:

```ts
interface RosterRow {
  id: string;              // fromPk — unique, it is a GROUP BY key
  name: string;
  pubkey: string | null;
  contactKey: string | null;
  source: 'contact' | 'discovered' | 'none';
  ambiguous: boolean;
  blocked: boolean;
  inContacts: boolean;     // source === 'contact'
  msgCount: number;        // already channel-scoped: WHERE key = ?
  lastSeenAt: number;      // ms epoch, MAX(ts)
}
```

`fromPk === null` (self) and `fromPk === 'unknown'` are **excluded**. Neither has a
name to search or sort, a key, or an action; today's `distinctSenders` already
excludes both, so the header count agrees with the number the section reports now.

### 5.2 Header

**Deviation from the handoff, deliberate.** The reference draws a bespoke header —
`text-[13px] font-semibold text-cs-text`, padding `10px 12px 9px`, gap `7px`. This
section does not own its header: every rail section renders through the shared
`Collapsible`, whose header is `px-2 py-1` with a `ChevronRight` and a
`text-xs text-cs-text-muted` label. Applying the handoff's geometry here would make
People's header a different height and weight from Channel info, Activity and Share
directly above it.

**Keep `Collapsible`'s header exactly as-is.** The only change is the count, into
its existing `trailing` slot: `font-mono text-[10px] text-cs-text-dim tabular-nums`.
Reads `156` normally and `«n» / 156` whenever `query !== ''` or `filter !== 'all'`,
where `156` is the roster length after the self / `'unknown'` exclusion (§5.1) —
the same number `distinctSenders` reports today.

The old `"156 people seen"` sub-line is **removed**.

### 5.3 Row

CSS grid, `gap:8px`, `padding:0 10px`, `height:24px`. Tracks
`7px 1fr [30px] 26px 30px` — the volume track is omitted (not merely hidden) when
`rightWidth < 310` or `sort === 'name'`.

| # | Slot | Track | Spec |
|---|---|---|---|
| 1 | Identity dot | `7px` | 7px circle, `justify-self:center`. Filled: `background: rgb(var(--cs-id-N))`. Hollow: transparent + `box-shadow: inset 0 0 0 1.5px rgb(var(--cs-id-N))`. Neutral uses `--cs-id-neutral`. |
| 2 | Name | `1fr` | `text-[12.5px] font-medium text-cs-text`, `truncate`. **Never coloured.** |
| 3 | Volume bar | `30px` | `h-[3px] rounded-[2px]`; track `bg-cs-accent/14`, fill `bg-cs-accent/78`, width `max(6%, msgCount / maxInView * 100%)`. |
| 4 | Count | `26px` | `font-mono text-[11px] tabular-nums text-cs-text-muted`, right-aligned. |
| 5 | Age | `30px` | `font-mono text-[10.5px] tabular-nums text-cs-text-dim`, right-aligned, `nowrap`. |
| 6 | Actions | overlay | `absolute right-[6px]`, two 20×20 `Button size="icon" variant="ghost"`, `rounded-[5px]`, icon 12px, over `linear-gradient(90deg, transparent, rgb(var(--cs-bg-3)) 34%)`. |

**Count formatting — 3 characters maximum** (§2.3):

```
n < 1000       → String(n)                       "999"
n >= 1000      → `${Math.floor(n / 1000)}k`      "1k" … "99k"
n >= 100000    → "99k"                           (clamped)
```

At `text-[11px]` SF Mono, 3 chars = 20.4px in the 26px track. This replaces the
handoff's `999+` rule; the type scale and grid geometry are preserved instead.
The age ladder tops out at 3 characters (`12m`), 19.5px in a 30px track.

**`maxInView`** is `max(msgCount)` over the **whole filtered+searched list**, not
the on-screen viewport — bars stay stable while scrolling and re-normalise when
the set changes. When the list is empty or `maxInView <= 0`, the bar renders as a
bare track (no fill) rather than dividing by zero.

Hover: row background `bg-cs-bg-3` (§2.2). Actions reveal on `group-hover` **or**
`group-focus-within`; the reference's `display:none` → `:hover` alone makes them
keyboard-unreachable.

`UserPlus` is rendered only when the person is not already a contact, per the
handoff. Both actions are always *rendered* when applicable and *disabled* with a
tooltip when not actionable (§4.4) — never silently absent.

### 5.4 Keyboard and focus

The row is a `<div>` carrying `onClick`; the **name cell is a real `<button>`**
that carries focus and Enter; the two actions are sibling `<button>`s that
`stopPropagation`. No nested interactive elements, whole-row click still works,
and `group-has-[:focus-visible]:ring-1 ring-ring` draws the focus ring around the
entire row. `--color-ring` is already `rgb(var(--cs-accent))`, so `ring-ring` is
the amber ring the handoff asks for.

Row click calls `setActiveKey(contactKey)` — today's behaviour. It is a no-op when
`contactKey` is null.

`RailSection` gains `trailing?: () => React.ReactNode`, rendered into
`Collapsible.trailing` by `rightrail/index.tsx`.

### 5.5 Controls and width modes

- **Search** — always present when the roster is non-empty. `height:26px`,
  `margin:0 10px 8px`, `padding:0 8px`, `gap:7px`, `bg-cs-bg-2`,
  `border-cs-border`, `rounded-[7px]`; leading `Search` icon 11px `text-cs-text-dim`;
  input `text-[11.5px]` sans, placeholder **`Search people`**. Component: `Input`
  with `className` overrides (its default is `h-9`).
- **Sort** `Recent · Loudest · A–Z` and **Filter** `All · Contacts` as two
  `ToggleGroup type="single"` groups on one row, `margin:0 10px 6px`, `gap:6px`,
  filter group `margin-left:auto`.
  Container `bg-cs-bg-3`, `border-cs-border`, `rounded-[7px]`, `p-0.5`, `gap-0.5`.
  Item `font-mono text-[9.5px] font-medium`, `px-[7px] py-[3px]`, `rounded-[5px]`,
  `text-cs-text-muted`, hover `text-cs-text`. **Selected:** `bg-cs-bg` +
  `text-cs-accent` + `shadow-[0_1px_0_rgba(0,0,0,.3)]`.
  ToggleGroup's stock selected state is `data-[state=on]:bg-accent` = `cs-bg-3` on
  a `cs-bg-2` rail (~1.05:1, invisible) — the design's opposite polarity (darker
  pill, amber label) is a required per-item override, not a preference.
  Its smallest size is `sm` (32px, `min-w-8`), so `h-[22px] min-w-0` overrides are
  needed too, and Root is `w-fit`.
- **The "New" filter is dropped.** There is no per-sender first-seen datum
  anywhere, and defining New as "not in contacts" would make it the exact
  complement of Contacts — a fact the dot's fill already shows on every row.
  Ship `All · Contacts`.

**Width mode** derives from `ui.rightWidth`, which is already exact, authoritative,
reactive store state — **no `ResizeObserver`** (the test stub in
`tests/component/setup.ts` never fires a callback, so an observer-based mode would
be untestable).

| Width | Behaviour |
|---|---|
| `< 310px` | Search only; control row dropped; no volume track. Columns, buckets and dot unchanged. |
| `>= 310px` | Full control bar + volume track. |
| Wider | All extra width goes to the **name** track; the two right columns stay pinned. |

The threshold is **310**, lowered from the handoff's 330, and
`DEFAULT_UI_STATE.rightWidth` moves **320 → 340** for new profiles only. No
migration: `mergeDefaults` keeps stored values, so existing 320px users clear the
lowered threshold and get the full control bar without their layout being
rewritten.

### 5.6 Recency buckets

Only while `sort === 'recent'`. `TODAY · YESTERDAY · THIS WEEK · EARLIER`, each
header `font-mono text-[9px] uppercase tracking-[0.08em] text-cs-text-dim`, its own
count at 75% opacity, then a `1px` `border-cs-border` rule filling the remaining
width. `padding: 13px 12px 5px`, first header `padding-top:6px`.

Calendar-relative, not rolling. `dayKey()` cannot do this (subtracting 1 from a
`YYYYMMDD` int breaks at month boundaries), so:

```ts
const midnight = (t: number) => { const d = new Date(t); d.setHours(0,0,0,0); return d.getTime(); };
const daysAgo = Math.round((midnight(now) - midnight(ts)) / 86_400_000);
// 0 → TODAY · 1 → YESTERDAY · 2..7 → THIS WEEK · >= 8 → EARLIER
```

`Math.round` rather than `floor` so 23- and 25-hour DST days still land correctly.

**Empty buckets are never rendered.** Buckets are not collapsible in v1. `Loudest`
and `A–Z` flatten the list entirely.

### 5.7 Sort, filter, search

- **Search** filters on display name, case-insensitive substring, as you type. It
  does **not** re-sort. Search + filter + sort compose.
- **`recent`** (default) — `lastSeenAt` desc, bucketed.
- **`loud`** — `msgCount` desc, tie → `lastSeenAt` desc, tie → `name.localeCompare`.
- **`name`** — `localeCompare(sensitivity: 'base')` on a sort key with leading
  non-alphanumeric characters stripped, so emoji and punctuation prefixes sort by
  their first alphanumeric character (the reference's prose; its code does a plain
  `localeCompare` — follow the prose). Also drops the volume bar: a ranking bar
  under an alphabetical list invites a comparison the order does not support.
- **Filter** `all` (default) · `contacts`.

### 5.8 Time ladder

`fmtAge(ts, now)` — pure, no allocation of `Date` in the common path:

| Elapsed | Row | Tooltip (absolute) |
|---|---|---|
| `ts <= 0` or not finite | `—` | *(no tooltip)* |
| `ts > now` | `now` | absolute per below |
| `< 60 s` | `now` | `14:20:31` |
| `< 60 min` | `12m` — `Math.floor(ms / 60000)` | `14:08` |
| `< 24 h` | `3h` — `Math.min(23, Math.round(min / 60))` | `11:20` |
| `< 7 d` | `2d` — `Math.floor(h / 24)` | `Wed 09:14` |
| `>= 7 d` | `3w` — `Math.floor(d / 7)` | `Jul 2, 09:14` |

The `Math.min(23, …)` clamp is deliberate: bare `Math.round(1439/60)` renders
`"24h"`, which the `< 24h` rung is supposed to exclude. A null, zero or negative
`lastSeenAt` renders `—`, **never** `1970` — node RTCs are unreliable and can
report times in the future or far past, which is why the future guard exists too.

Tooltips use the user's locale, timezone and 12/24-hour preference. The row
**never** prints `"ago"`, `"hours"` or `"days"` — that is what the tooltip is for.

Tooltips are needed on: age (absolute), count (`«n» messages seen in this
channel`), and the name **only when the label is actually clipped**. The ambient
provider is `delayDuration={0}`, so each `<Tooltip>` sets its own delay (~400ms) —
instant-fire across 156 rows is unusable.

### 5.9 Empty states

Inside the section, `padding:16px 12px`, `text-[11.5px] text-cs-text-dim`, with the
query echoed in `text-cs-text-muted`. Never a full-panel takeover.

Evaluated in this order:

| # | Condition | Result |
|---|---|---|
| 1 | `loading && !stats` | `Skeleton` rows — three 24px bars. Controls hidden. |
| 2 | roster empty (post-exclusion) | `No one has been heard in this channel yet.` Controls hidden entirely — there is nothing to search or sort. |
| 3 | `query !== ''`, no match | `No one matches "«query»".` + `Clear the search to see all «total».` |
| 4 | `filter !== 'all'`, no match | `No one matches that filter.` |

`«total»` is the roster length after the self / `'unknown'` exclusion — the same
number the header shows. The order matters: the reference shows *"Clear the
search…"* even when only a filter is active, and hardcodes `156`. Both are fixed
here.

---

## 6. State

| State | Where | Persisted |
|---|---|---|
| `sort: 'recent' \| 'loud' \| 'name'` | `ui.peopleRail[channelKey].sort`, default `'recent'` | Locally, per channel (the `lastReadByKey` shape). Not cross-client — `applyUiState` whitelists 6 fields and this is not one. |
| `filter: 'all' \| 'contacts'` | `ui.peopleRail[channelKey].filter`, default `'all'` | Same |
| `query: string` | store **root**, outside `ui` | **Never.** `App.tsx` PUTs `ui` only, so a root-level field is not persisted by construction. |
| `mode` (width) | derived from `ui.rightWidth` | Never |

`query` is cleared on channel switch. This needs an explicit effect keyed on
`channel.key`, because `<Collapsible key={section.id}>` uses a constant id and the
section does not remount (§2.5).

Per-channel maps grow unboundedly, exactly like the existing `lastReadByKey`.
Accepted precedent.

**One shared clock.** `useNowTick(30_000)` at section level passes `now` down as a
prop to every row. `RelativeTime` is dropped from this section — it mounts an
interval *and* a store subscription per instance, and without virtualisation all
156 rows really do mount.

**Live updates.** `useChannelStats` already refetches on every `messagesByKey[key]`
identity change, so counts and ages update in place for free. `inContacts` derives
from `s.contacts` in the renderer, so saving a contact reflects immediately without
invalidating stats. Row reordering is not animated; `prefers-reduced-motion` is
honoured via Tailwind's `motion-reduce:` variant on any transition added.

---

## 7. The ramp

### 7.1 Delivery

**37** CSS custom properties as **RGB triplets** in `src/renderer/index.css`:
`--cs-id-0…11` (dot), `--cs-id-fg-0…11` (text and avatar glyph),
`--cs-id-bg-0…11` (avatar fill), `--cs-id-neutral`. The avatar fills are
required, not optional — `getNameColor` returns `{fg, bg, pillBg}` today and
`ContactAvatar` uses `bg` as the disc fill (§7.4). Defined in
`:root` (dark) and fully overridden in `:root:not(.dark)` (light), with the
originating `oklch()` and the `bg / bg-2 / bg-3` contrast ratios in a trailing
comment per line — exactly the existing `--cs-hash-1/2/3` pattern
(`index.css:32-34`, `:57-62`). Registered in the `@theme` block alongside
`--color-cs-hash-*`.

This is required, not stylistic: `applyTheme()` writes palette keys as **inline
styles on `<html>`** and toggles `.dark`, so anything it does not write must be
themed in CSS via that class. Triplets keep the `--cs-*` contract that composes
with Tailwind's `/15` alpha syntax and keep `contactColor.ts` a **pure**
`djb2(id) % 12 → rgb(var(--cs-id-N))` function with no theme argument and no
re-render on theme change.

**Rule to preserve on future edits: `L_light = 1.30 − L_dark`.**

### 7.2 Dot — `--cs-id-0 … --cs-id-11`

Dark `oklch(0.76 0.095 h)` · Light `oklch(0.54 0.090 h)`. Ratios vs `bg / bg-2 / bg-3`.
Threshold **3:1** (non-text graphical object).

| slot | h | dark | dark ratios | light | light ratios |
|---|---|---|---|---|---|
| 0 | 25 | `#E79992` | 8.83 / 8.24 / 7.60 | `#9C5954` | 5.02 / 4.60 / 3.94 |
| 1 | 55 | `#E0A176` | 8.98 / 8.38 / 7.73 | `#976038` | 4.93 / 4.51 / 3.87 |
| 2 | 85 | `#CDAD68` | 9.21 / 8.60 / 7.93 | `#876A29` | 4.84 / 4.43 / 3.79 |
| 3 | 115 | `#AFB971` | 9.42 / 8.80 / 8.12 | `#6D7533` | 4.70 / 4.30 / 3.69 |
| 4 | 145 | `#8BC18C` | 9.52 / 8.89 / 8.20 | `#4B7C4D` | 4.65 / 4.26 / 3.65 |
| 5 | 175 | `#69C5AE` | 9.61 / 8.97 / 8.28 | `#24806C` | 4.55 / 4.17 / **3.57** |
| 6 | 205 | `#5EC3CE` | 9.58 / 8.95 / 8.26 | `#0C7D87` | 4.64 / 4.25 / 3.64 |
| 7 | 235 | `#72BBE5` | 9.38 / 8.76 / 8.08 | `#31779B` | 4.70 / 4.30 / 3.69 |
| 8 | 265 | `#94B0EE` | 9.14 / 8.54 / 7.87 | `#556DA3` | 4.86 / 4.45 / 3.81 |
| 9 | 295 | `#B5A5E7` | 8.95 / 8.36 / 7.71 | `#72649D` | 4.96 / 4.54 / 3.89 |
| 10 | 325 | `#D09CD2` | 8.82 / 8.24 / 7.60 | `#895C8B` | 5.03 / 4.60 / 3.94 |
| 11 | 355 | `#E298B4` | 8.84 / 8.25 / 7.62 | `#985871` | 5.02 / 4.60 / 3.94 |

Worst dark 7.60, worst light 3.57. All 24 pass. All in sRGB gamut.

### 7.3 Text — `--cs-id-fg-0 … --cs-id-fg-11`

Dark `oklch(0.84 0.060 h)` · Light `oklch(0.46 0.060 h)`. Threshold **4.5:1**.

| slot | h | dark | dark ratios | light | light ratios |
|---|---|---|---|---|---|
| 0 | 25 | `#F0BCB7` | 11.85 / 11.07 / 10.21 | `#764B47` | 6.96 / 6.37 / 5.46 |
| 1 | 55 | `#EAC1A6` | 11.94 / 11.15 / 10.29 | `#724F37` | 6.90 / 6.32 / 5.42 |
| 2 | 85 | `#DDC89E` | 12.08 / 11.29 / 10.41 | `#67552F` | 6.84 / 6.26 / 5.36 |
| 3 | 115 | `#C9D0A3` | 12.28 / 11.47 / 10.58 | `#575C34` | 6.68 / 6.11 / 5.24 |
| 4 | 145 | `#B3D5B3` | 12.33 / 11.51 / 10.62 | `#426143` | 6.60 / 6.04 / 5.18 |
| 5 | 175 | `#A2D8C8` | 12.43 / 11.60 / 10.71 | `#2F6356` | 6.56 / 6.01 / 5.15 |
| 6 | 205 | `#9CD6DD` | 12.32 / 11.50 / 10.61 | `#296268` | 6.56 / 6.00 / **5.14** |
| 7 | 235 | `#A5D2EC` | 12.27 / 11.46 / 10.57 | `#345D75` | 6.72 / 6.15 / 5.27 |
| 8 | 265 | `#B8CBF3` | 12.13 / 11.33 / 10.45 | `#48587A` | 6.76 / 6.18 / 5.30 |
| 9 | 295 | `#CDC3EE` | 11.90 / 11.12 / 10.25 | `#5A5176` | 6.94 / 6.35 / 5.45 |
| 10 | 325 | `#DFBEE0` | 11.85 / 11.07 / 10.21 | `#694C6B` | 7.01 / 6.41 / 5.50 |
| 11 | 355 | `#ECBBCC` | 11.82 / 11.04 / 10.18 | `#734A5A` | 6.98 / 6.39 / 5.48 |

Worst dark 10.18, worst light 5.14. All 24 pass. Against the tint's own `/18` pill
fill (the rule from `index.css:46-56`): dark worst 8.31, light worst 5.03 — still
passing.

### 7.4 Avatar

The one tinted-glyph-on-tinted-fill pair, so it is measured against **its own
fill**, per project convention.

| | fill | glyph | glyph-on-fill | disc vs page |
|---|---|---|---|---|
| Dark | `oklch(0.30 0.050 h)` | `oklch(0.84 0.060 h)` | 8.31 → 8.41 | 1.22 (deliberately soft) |
| Light | `oklch(0.92 0.035 h)` | `oklch(0.46 0.060 h)` | 5.52 → 5.75 | 1.04 (deliberately soft) |

Both clear 4.5:1. Compare today: the disc uses a fixed dark HSL fill in **both**
themes, reading 5.94–11.41:1 against the cream light page — a near-black blob. The
retint is a bug fix, not polish.

### 7.5 Neutral

`--cs-id-neutral` is its own token rather than borrowing `cs-text-dim`, which
measures **3.03:1** on light-mode `bg-3` — passing, but the thinnest number in the
design, and the row hovers to `bg-3`.

The goal is not "as much contrast as possible": the dot column should read as an
**even column of marks**, so a keyless person is a mark without a hue, not a hole.
The neutral therefore sits *inside* the coloured dots' band in each theme, not
above or below it.

| | value | ratios (bg / bg-2 / bg-3) | coloured band on bg-3 |
|---|---|---|---|
| Dark | `188 172 141` (`#BCAC8D`) | 8.88 / 8.29 / **7.65** | 7.60 – 8.28 |
| Light | `122 108 82` (`#7A6C52`) | 4.87 / 4.46 / **3.82** | 3.57 – 3.94 |

Both are the warm grey of `cs-text-dim` re-levelled, so the neutral stays in the
palette's hue family. Both clear the 3:1 non-text threshold with margin.

### 7.6 Verification gate

All 48 ramp values pass their applicable WCAG threshold. **Distinguishability of 12
hues 30° apart at chroma 0.060 is unmeasured.** Before locking the chroma, render
all 12 slots in the real app in both themes and look at them.

- If dark mode reads mushy, it has ~6 points of contrast headroom to spend on chroma.
- Light mode has none: **lower `L`, never raise `C`.** Cyan (h=175/205) is the
  binding hue at every `L` below ~0.60 — max in-gamut chroma at `L=0.54` is 0.092,
  so `C=0.090` already sits just inside. Raising it clips and shifts hue without
  adding contrast.
- Pre-approved fallback if the hollow ring reads weak at 1.5px: dot light value
  `oklch(0.52 0.089 h)` → worst 3.93 on `bg-3`, all 12 in gamut.

---

## 8. Files

### Create

| File | Contents |
|---|---|
| `src/renderer/lib/identity.ts` | `resolveIdentity`, `buildDiscoveredNameIndex`, `identitySlot`. Pure, no React, no store. |
| `src/renderer/shell/rightrail/sections/peopleModel.ts` | `toRosterRows`, `fmtAge`, `fmtAgeAbsolute`, `fmtCount`, `bucketFor`, `sortRoster`, `filterRoster`, `groupByBucket`, `volumeWidth`. Pure. |
| `src/renderer/shell/rightrail/sections/PeopleRow.tsx` | The 24px grid row. |
| `src/renderer/shell/rightrail/sections/PeopleControls.tsx` | Search + the two ToggleGroups + width-mode branch. |
| `src/renderer/hooks/useNowTick.ts` | One interval, returns `now`. |
| `tests/unit/renderer/lib/identity.test.ts` | Ports the 4 `contactKeyForSender` cases; adds discovered-only hit, contacts-over-discovered precedence, duplicate name ⇒ `ambiguous`, case/whitespace mismatch ⇒ miss, `'unknown'` ⇒ excluded, `null` ⇒ excluded. |
| `tests/unit/renderer/shell/peopleModel.test.ts` | Age-ladder boundaries incl. the 1439-minute clamp, `ts <= 0` and future-ts guards, bucket boundaries across a month edge and a DST edge, count abbreviation, sort tiebreakers, A–Z prefix stripping, filter composition, `maxInView`. |
| `tests/component/settings-appearance.test.tsx` | Clone of `settings-updates.test.tsx`; change the Select, Save, assert `putAppSettings` called with `objectContaining({ identityColorMode: 'byName' })`. No Appearance test exists today. |

### Modify

| File | Change |
|---|---|
| `src/shared/types.ts` | `+IdentityColorMode`; `+identityColorMode` on `AppSettings`; `+identityColorMode: 'byKey'` in `DEFAULT_APP_SETTINGS`; `+ui.peopleRail` on `UiState` + its default; `DEFAULT_UI_STATE.rightWidth` **320 → 340**. |
| `src/renderer/index.css` | +37 vars in `:root` and `:root:not(.dark)` with ratio comments; +`@theme` entries. |
| `src/renderer/lib/contactColor.ts` | Replace the 10-entry HSL `PALETTE` with the 12-slot var-reference ramp; `getNameColor` becomes slot-based. **Keep `initialsFor` and `djb2` untouched.** |
| `src/renderer/components/ColoredUsername.tsx` | Read the mode from the store (leaf-level store reads are precedented — `MentionPill.tsx:12`); resolve via `identity.ts` under `byKey`; fall through to the **existing** `neutral` branch when unresolved/ambiguous. |
| `src/renderer/components/ContactAvatar.tsx` | Same mode read; fill + glyph from the new vars; neutral fill + `cs-text-dim` glyph when unresolved. |
| `src/renderer/components/path/SetPathEditor.tsx` | Lines 221 / 319 — pass an explicit identity per §4.3. |
| `src/renderer/panels/settings/app/Appearance.tsx` | `+IDENTITY_COLOR_OPTIONS`; `+` the `eqAppearance` comparison; `+` the `saveApp` field; `+` the `<Row>` with `warning`. All four required. |
| `src/renderer/shell/rightrail/sections/ChannelPeople.tsx` | Rewritten. `contactKeyForSender` deleted (superseded by `identity.ts`); `UserX` + `HoverCard` removed; renders `PeopleControls` + buckets + rows; `RelativeTime` replaced by `fmtAge` + `useNowTick`. |
| `src/renderer/lib/store.ts` | `+peopleQuery` at store **root** with its setter (never persisted, §6); `+` actions for `ui.peopleRail[channelKey]` sort/filter; clear `peopleQuery` on channel switch. |
| `src/renderer/lib/time.ts` | No change to existing exports. `peopleModel.fmtAgeAbsolute` **reuses** this module's 12/24-hour preference handling rather than reimplementing locale logic. |
| `src/renderer/shell/rightrail/sectionsFor.tsx` | `+trailing?: () => React.ReactNode` on `RailSection`; supply it for the People section. |
| `src/renderer/shell/rightrail/index.tsx` | Pass `section.trailing?.()` into `Collapsible.trailing`; drop the `px-3 py-2` body wrapper for the People section id so rows are full-bleed. |

### Rewrite

| File | Why it breaks |
|---|---|
| `tests/unit/renderer/lib/contactColor.test.ts` | Asserts `/^hsl\(/` on `fg`/`bg`. Assert the `rgb(var(--cs-id-…))` reference string and the 12-slot mapping instead — jsdom will not resolve `var()` to a colour. Keep the four `initialsFor` cases verbatim. |
| `tests/component/colored-username.test.tsx` | Tests 1 and 5 assert a truthy inline colour against an **empty store**; under `byKey` those resolve to neutral, so `style.color === ''`. Rewrite as a matrix: mode × (resolvable \| unresolvable) × (self \| unknown), seeding `useStore.setState({ contacts, discovered })`. Tests 3 and 4 (neutral self, neutral unknown) are the invariant — keep verbatim. |
| `tests/component/channel-people-section.test.tsx` | Three hard breaks: the "resolved row is the only `role=button`" assertion dies once every row has actions; the `[data-slot="hover-card-trigger"]` assertion dies with `UserX`; `getByText('3')` becomes ambiguous once the row carries both a count and an age. Move the `contactKeyForSender` describe to `identity.test.ts` and reduce this to smoke renders: renders N rows; disabled actions + tooltip for an unresolvable poster; click on a resolvable poster calls `onSelectContact`; header count switches to `«n» / «total»` under a filter. |

### Verify unchanged

`tests/component/rail-sections-channel.test.tsx` (asserts the exact section id
order and `defaultOpen:false` for Activity — leave `sectionsFor.tsx:199-203`
alone), `tests/component/use-channel-stats.test.tsx`,
`tests/component/message-item-quick-bar.test.tsx`. Caveat: once `ColoredUsername`
and `ContactAvatar` read the store, the quick-bar tests render **neutral**
identities against the empty default store. That is acceptable, but any new colour
assertion in those files must seed state first.

---

## 9. Testing

- **Pure first.** Everything in `peopleModel.ts` and `identity.ts` is unit-testable
  with no DOM. That is where boundary coverage lives — ladder rungs, the 23h clamp,
  the epoch and future guards, month and DST bucket edges, sort tiebreakers, count
  abbreviation, ambiguity.
- **Component tests stay thin** — a handful of smoke renders. Without
  virtualisation, jsdom renders every row, so these are straightforward.
- **Real-app check** before locking the ramp (§7.6), following the project's
  existing Playwright + Electron recipe with a seeded SQLite roster: screenshot the
  section at 300px, 340px and 420px, in both themes, with all 12 hues represented
  and at least one of each dot tier.

---

## 10. Deliberately not done

| | Why |
|---|---|
| List virtualisation | Dropped from scope. The rail stays one scroll container and the section stays plain flow content. The shared `useNowTick` removes the real per-row cost. Revisit if the roster grows unbounded — the SQL has no `LIMIT`. |
| Bundling Commit Mono / Inter | Own licensing gate and a `.design-sync/config.json` lockstep. §5.3 makes the design fit the font we actually render. |
| `AppSettings.theme` is dead | Nothing reads it; the live theme is `ui.themePref` (`App.tsx:36,58`, `Cmd-T`). Worth a one-line PR of its own. Do **not** model `identityColorMode` on it. |
| Rail-local contact detail | Row click navigates via `setActiveKey`, as today. Swapping `ContactDetail` into the rail needs detail-override state and a back affordance — a rail-architecture change. |
| Colouring search results | `panels/search/MessageRow.tsx` is uncoloured today. Pre-existing inconsistency; not silently fixed here. |
| Preserving hue assignments across the 10→12 change | Would need a stored per-identity slot map — real state for a cosmetic. |
