// Mesh domain records: packets, channels, contacts, messages, block rules and the owner identity.

import type { ChannelKey, ContactKey } from '../conversationKey';

export interface RawPacket {
  timestamp: number;
  transportType: 'ble' | 'serial';
  kind: 'mesh' | 'companion';
  // Verbatim transport frame — what the bridge fans out to TCP/WS proxy clients.
  // Companion: includes the type code byte. Mesh: includes the 0x84/0x88 + SNR/RSSI prefix.
  hex: string;
  bytes: number[];
  // Parsed payload — what the renderer displays / feeds to MeshCoreDecoder.
  // Companion: payload after the type code. Mesh: the mesh packet only.
  payloadHex: string;
  payloadBytes: number[];
  // Mesh-only: link metrics extracted from companion-radio RAW_DATA / LOG_RX_DATA frames.
  snr?: number;
  rssi?: number;
  // Companion-only: the frame-type byte (e.g. 0x84) and human-readable name.
  code?: number;
  codeName?: string;
}

/** Post-connect handshake progress. `phase` is the high-level state the UI
 *  surfaces alongside the transport-level dot in the connection footer; the
 *  per-bucket counters for channels and contacts are summed to drive the
 *  "Syncing N/M" label and progress bar. `idle` = not currently syncing (either pre-connect
 *  or post-completion); `syncing` = handshake in flight; `done` = handshake
 *  finished this session. */
export interface SyncProgress {
  phase: 'idle' | 'syncing' | 'done';
  channels: { done: number; total: number };
  contacts: { done: number; total: number };
}

export const DEFAULT_SYNC_PROGRESS: SyncProgress = {
  phase: 'idle',
  channels: { done: 0, total: 0 },
  contacts: { done: 0, total: 0 },
};

export type ChannelKind = 'public' | 'hashtag' | 'private';

export interface Channel {
  key: ChannelKey;
  name: string;
  kind: ChannelKind;
  secretHex?: string;
  muted?: boolean;
  pinned?: boolean;
  /** Slot index on the radio (0..N). Set after the protocol session learns it
   *  via RESP_CHANNEL_INFO. Required for outbound CMD_SEND_CHAN_TXT_MSG and
   *  used to dispatch incoming RESP_CHANNEL_MSG_RECV(_V3) frames to the right
   *  channel. */
  idx?: number;
  /** User-defined sort order in the LeftNav. Seeded from `idx` on first sync;
   *  thereafter set explicitly by drag-reorder. Lower = higher in the list. */
  order?: number;
  /** App-owned: epoch ms when this channel was first added (user create or
   *  first radio-sync). Absent on channels created before this field existed. */
  createdAt?: number;
}

/** Every contact kind, in the app's display order. */
export const CONTACT_KINDS = ['chat', 'repeater', 'room', 'sensor'] as const;

export type ContactKind = (typeof CONTACT_KINDS)[number];

export type PathHashSize = 1 | 2 | 3;

/** True iff `n` is a real per-hop path hash size (1, 2 or 3 bytes). */
export function isPathHashSize(n: unknown): n is PathHashSize {
  return n === 1 || n === 2 || n === 3;
}

export interface Contact {
  key: ContactKey;
  publicKeyHex: string;
  name: string;
  kind: ContactKind;
  lastSeenMs?: number;
  /** Last-heard link metrics. Declared to mirror @andyshinn/meshcore-ts's
   *  Contact, but NOTHING assigns either one — the companion protocol's contact
   *  record has no room for them (writeContactRespFrame ends at gps/lastmod),
   *  PUSH_NEW_ADVERT (0x8A) reuses that frame, and PUSH_ADVERT (0x80) is a bare
   *  [code][pubkey] frame carrying even less. Treat every read as undefined; the
   *  `{{ peer_rssi }}` / `{{ peer_snr }}` macros resolve through these and are
   *  documented as unpopulated because of it. Filling them means correlating the
   *  0x88 RX-log push onto the contact, upstream in the library (issue #33). */
  rssi?: number;
  snr?: number;
  /** Relay count to this contact, derived by the library from the advert's
   *  out_path_len — unlike rssi/snr above, this one is real. */
  hops?: number;
  /** @deprecated Nothing writes it — the radio sync only preserves an existing
   *  value — so every read is undefined. The nav pin is `UiState.pinned`; the
   *  radio flag is `favourite` below. Until #47 resolves which one the map
   *  filter and NodeInfoCard star should read, don't add new reads. */
  pinned?: boolean;
  /** Radio-level favourite — maps to the firmware contact flag bit 0, which
   *  protects the contact from overwrite-oldest eviction. Distinct from
   *  `UiState.pinned` (app-only pin-to-top in the nav) and from the deprecated
   *  `Contact.pinned`. */
  favourite?: boolean;
  muted?: boolean;
  /** Hex-encoded out-path bytes (no separators) mirroring the firmware's
   *  advert.out_path. Empty / undefined means "flood" (no source-route). The
   *  byte length must be a multiple of `outPathHashSize`. */
  outPathHex?: string;
  /** Bytes per hop prefix (1, 2 or 3). Snapshot of the radio's `path.hash.mode`
   *  at the time the path was captured / written. Needed to split `outPathHex`
   *  into the per-hop chips the UI renders. */
  outPathHashSize?: PathHashSize;
  /** When true, the app skips mesh routing entirely and uses the companion-side
   *  direct flow for this contact (CMD_SEND_LOGIN for repeaters; direct DM
   *  otherwise). Takes precedence over `outPathHex`. */
  preferDirect?: boolean;
  /** True iff the current `outPathHex` was set by hand in the UI (not learned
   *  by the auto-retry pipeline). Drives the "overwrite manual path?" dialog. */
  pathManual?: boolean;
  /** Wall-clock ms of the most recent auto-learn that wrote `outPathHex`. */
  pathLearnedAt?: number;
  /** Last advertised position in WGS84 degrees. Both present together or both
   *  absent — a partial fix is never written. 0/0 from firmware is treated as
   *  absent (default for radios without a GPS module). */
  gpsLat?: number;
  gpsLon?: number;
}

export type MessageState = 'sending' | 'sent' | 'heard' | 'ack' | 'failed' | 'received';

/** One node in a routing path. `kind` distinguishes the message originator
 *  (sender, derived from the "name: " prefix in channel messages), intermediate
 *  repeaters, and the sink (our radio). `shortId` is the per-hop prefix hex
 *  (1, 2, or 3 bytes wide) as encoded by the firmware in the on-air path.
 *  `unnamed: true` means we only know the prefix byte(s) — no advert ever seen
 *  for that prefix, so the UI renders a dashed avatar + italic placeholder. */
export interface MessageHop {
  kind: 'origin' | 'hop' | 'sink';
  shortId: string;
  name?: string | null;
  pk?: string | null;
  unnamed?: boolean;
}

/** One observed reception of a flood message: the sequence of hops it took
 *  from origin to our radio. A single Message can carry multiple paths when
 *  the same packet arrived via multiple flood routes (merged on receipt by
 *  deterministic id). `hashMode` is the firmware-encoded per-hop hash byte
 *  count (1, 2, or 3 — 4 is reserved). `finalSnr` is the SNR our radio
 *  measured on the LAST hop only; per-hop SNR is never available on flood. */
export interface MessagePath {
  id: string;
  hops: MessageHop[];
  hashMode: number;
  finalSnr: number;
}

export interface MessageMeta {
  /** @deprecated meshcore-ts never sets it; only older stored rows carry it.
   *  Derive the hop count from `paths` (shared/messagePath.ts `relayHopCount` /
   *  `firstPathStats`), which keeps this only as a legacy fallback. */
  hops?: number;
  /** @deprecated Nothing writes it: the V3 message frames carry no RSSI (their
   *  bytes 2-3 are firmware-reserved), so every read is undefined. Populating it
   *  means correlating the 0x88 RX-log push (#33). Prefer `snr`. */
  rssi?: number;
  snr?: number;
  /** Decoded route(s) the message travelled, populated when a matching mesh
   *  observation (PUSH_CODE_LOG_RX_DATA 0x88) preceded the channel-msg push. */
  paths?: MessagePath[];
  /** Number of distinct flood receptions merged into this Message row. Absent
   *  ⇒ treat as 1. Bumped by the lib's multi-path merge for inbound messages,
   *  and by holder.appendMessagePath (mirrored by the renderer store's
   *  appendMessagePath) for outgoing relay echoes. */
  timesHeard?: number;
  signatureHex?: string;
  /** Set by main when the message matches an active block rule. The
   *  renderer hides annotated rows from MessageList, Unreads, and Search.
   *  Re-evaluated per query — disabling or deleting the rule clears the
   *  annotation on the next read (not sticky). */
  blocked?: boolean;
  /** The id of the first rule (by createdAt asc) that matched this message
   *  at first-match time. Used to attribute matchCount; not used for hiding. */
  blockedByRuleId?: string;
}

export interface Message {
  id: string;
  key: string; // channel or contact key the message belongs to
  fromPublicKeyHex?: string; // omitted when sent by the owner
  body: string;
  ts: number;
  state: MessageState;
  meta?: MessageMeta;
}

export interface ChannelSenderStat {
  /** Raw from_pk: null=self, 'name:<n>'=channel poster, 'unknown', or hex pubkey. */
  fromPk: string | null;
  count: number;
  lastTs: number;
}

export interface ChannelStats {
  count: number;
  firstTs: number | null;
  lastTs: number | null;
  count24h: number;
  count7d: number;
  /** Distinct identifiable non-self senders (excludes null self and 'unknown'). */
  distinctSenders: number;
  /** Grouped per sender, ordered by most-recently-active first. */
  roster: ChannelSenderStat[];
  /** 7 local-day message-count buckets, oldest→newest; index 6 is today. */
  perDay: number[];
}

/** One window of the channel Activity chart. `total` is always the sum of `buckets`,
 *  so the lead number can never disagree with the bars drawn under it. */
export interface ActivityWindow {
  /** Bucket counts, oldest→newest. Length is 24 (hourly), 7 or 30 (daily). */
  buckets: number[];
  /** Sum of `buckets`. */
  total: number;
  /** Count over the same-length immediately-preceding period. 0 when no prior history. */
  prevTotal: number;
  /** Epoch ms of the first bucket's start edge, so the renderer can label the axis
   *  from real edges instead of re-deriving them from a possibly-drifted clock. */
  startMs: number;
}

/** Hour-of-day band, local time. `startHour` inclusive, `endHour` exclusive and
 *  modulo 24 — so `endHour <= startHour` means the band wraps past midnight. */
export interface ActivityBand {
  startHour: number;
  endHour: number;
}

export type ActivityWindowKey = '24h' | '7d' | '30d';

export interface ChannelActivity {
  windows: Record<ActivityWindowKey, ActivityWindow>;
  /** Busiest 3h band over the trailing 168h. null when too sparse to name. */
  peakBand: ActivityBand | null;
  /** Calmest 4h band over the trailing 168h. null when too sparse to name. */
  quietBand: ActivityBand | null;
  /** Epoch ms of the most recent message in this channel; null if it has none. */
  lastTs: number | null;
}

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

export interface Owner {
  name: string;
  publicKeyHex: string;
  publicKeyShort: string;
}

export interface PathLearnedEvent {
  contactKey: string;
  /** New out-path bytes the radio observed when the send succeeded. May be
   *  empty (e.g. a path-known send fell back to flood and the radio still
   *  hasn't a path it trusts). */
  newOutPathHex: string;
  newOutPathHashSize: PathHashSize;
  /** Path that was on the contact immediately before the learn. */
  previousOutPathHex: string;
  /** True iff the previous path was set manually — the renderer uses this to
   *  decide whether to prompt or apply silently. */
  previousManual: boolean;
  /** Wall-clock ms of the learn event. */
  learnedAt: number;
}

/** A node we've heard an advert from. Superset of the on-radio contact list:
 *  `onRadio` marks whether it is currently committed to the radio's store. */
export interface DiscoveredContact {
  key: string; // `c:${publicKeyHex}`
  publicKeyHex: string;
  name: string;
  kind: ContactKind;
  hops?: number;
  outPathHex?: string;
  outPathHashSize?: PathHashSize;
  gpsLat?: number;
  gpsLon?: number;
  /** Last advert time stamped by the NODE's own clock, ms. Unreliable — a node
   *  with a wrong RTC can report a time in the future or far past. Shown as the
   *  secondary "advertised" timestamp, never used for the "last heard" sort. */
  lastAdvertMs?: number;
  /** Last time WE genuinely received ANYTHING from this node (our clock), ms.
   *  Advert, DM, ack, path learn, repeater status/telemetry or CLI reply — any
   *  identity-bearing reception. On the advert side that is both a PUSH_ADVERT
   *  (0x80) refresh of a stored contact and a PUSH_NEW_ADVERT (0x8a), which
   *  since meshcore-ts 0.8.0 means the radio REFUSED to store the node — either
   *  way we demodulated a real advert. Never a GET_CONTACTS resync (the device
   *  just listing what it stores) and never our own outbound traffic, so
   *  committing a contact to the radio can't bump it. Reception only: it says
   *  nothing about whether the radio holds the contact. Undefined until the
   *  first reception.
   *
   *  One value here does NOT come from our own clock: a RESP_ADVERT_PATH reply
   *  carries the radio's own reception time for an advert it heard while we were
   *  not attached, and that is a real reception we would otherwise report as
   *  "never". It is adopted only after a plausibility check and only when it is
   *  NEWER than what we already hold (see state/advertPath.ts), so a radio with
   *  an unset or skewed RTC can never move this column.
   *
   *  Widened from "last live advert" in #45: a node we DM daily was showing
   *  "never" because only PUSH_NEW_ADVERT wrote here, and every Last-heard
   *  filter (hour/day/week) drops rows with no value at all. */
  lastHeardMs?: number;
  /** Hops the radio counted on the last advert it actually HEARD from this node
   *  (CMD_GET_ADVERT_PATH → RESP_ADVERT_PATH). This is an INBOUND measurement
   *  and is deliberately a field of its own: `hops` above is derived from
   *  out_path_len, the LEARNED OUTBOUND route we would use to SEND. A mesh is
   *  routinely asymmetric, so the two legitimately differ and neither may
   *  overwrite the other (#45 item 7).
   *
   *  0 is a real measurement — "the advert arrived direct" — not an absence.
   *  Undefined means nobody has measured it yet, which is NOT the same state as
   *  `hops === undefined` ("no stored route → flood"); see formatObservedHops.
   *
   *  The firmware's backing store is a 16-entry RAM ring keyed on a 7-BYTE
   *  pubkey PREFIX (companion_radio `AdvertPath.pubkey_prefix[7]`, compared with
   *  memcmp) and evicted oldest-first, so this is a sample of one recent advert
   *  rather than a durable property of the node — and, being a prefix match, not
   *  full-key fidelity. */
  observedHops?: number;
  /** The path bytes that advert arrived over, hex. Empty for a 0-hop (direct)
   *  reception, which is why `observedHops` — never this — is the presence test.
   *
   *  The firmware's other empty path, the 0xFF flood / no-path sentinel, is
   *  never written here at all: the radio reports it as zero hops with an empty
   *  path, and state/advertPath.ts drops it on the `flood` flag rather than
   *  filing it as a direct reception. */
  observedPathHex?: string;
  /** When the RADIO received that advert, ms. Its RTC, not our clock and not the
   *  advertising node's clock (see lastHeardMs / lastAdvertMs respectively). A
   *  radio with an unset RTC reports something near the epoch, which is why it
   *  is range-checked before it is allowed to advance `lastHeardMs` — but a
   *  plausible value IS firmware-authoritative proof of a reception, and is used
   *  as one (state/advertPath.ts). */
  observedAtMs?: number;
  /** First time WE heard this pubkey (our clock), ms. Tracked app-side. */
  firstHeardMs: number;
  onRadio: boolean;
  favourite: boolean;
  blocked: boolean;
}
