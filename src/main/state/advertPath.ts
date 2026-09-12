import { child } from '../log';
import { protocolSession } from '../protocol';
import { discoveredStore } from '../storage/discoveredContacts';
import { transportManager } from '../transport/manager';
import { scheduleDiscoveredEmit } from './contactSync';

const log = child('contacts');

/** How long a measurement is reused before we ask the radio again.
 *
 *  The thing being measured is a single cached advert reception, and the cache
 *  it lives in is a 16-entry RAM ring on the radio — so re-asking more often
 *  than this cannot produce a different answer often enough to be worth the
 *  companion-link traffic. It is also the backstop for the case with no stored
 *  answer at all: a contact the ring has evicted returns "not cached" forever,
 *  and without a cooldown a rail that re-renders on every websocket push would
 *  re-ask on every render. The user-initiated button passes `force` and skips
 *  it; nothing automatic does. */
export const ADVERT_PATH_COOLDOWN_MS = 60_000;

/** How old a radio-reported advert reception may be and still be believed as a
 *  last-heard.
 *
 *  RESP_ADVERT_PATH carries the RADIO's clock, not ours, and a radio whose RTC
 *  was never set reports something near the epoch — so the value cannot simply
 *  be trusted into an our-clock column. It also cannot simply be discarded: it
 *  is firmware-authoritative proof that this node WAS heard, frequently while
 *  coresense was not attached, and dropping it leaves a node the radio heard ten
 *  minutes ago reading "never" everywhere and excluded from every Last-heard
 *  filter (#45 item 9's exact symptom).
 *
 *  A week is generous for the thing being described — the backing store is a
 *  16-entry ring of the most recently heard nodes — while still rejecting an
 *  unset RTC by orders of magnitude. Future timestamps are rejected outright: a
 *  fast clock would otherwise park last_heard_ms ahead of now and, because the
 *  column only ever moves forward, silently block every REAL reception after
 *  it. */
export const MAX_OBSERVED_HEARD_AGE_MS = 7 * 86_400_000;

export type AdvertPathResult =
  /** A real answer. `fromCache` means it came from the sqlite mirror under the
   *  cooldown above rather than from a fresh radio round trip. */
  | { status: 'measured'; hops: number; pathHex: string; recvUnix: number; fromCache: boolean }
  /** The radio's advert-path ring holds no entry for this node — the normal
   *  answer for 15 of every 16 contacts, and not an error. */
  | { status: 'notCached' }
  /** The ring DOES hold this node, but what it cached is the flood / no-path
   *  sentinel (path_len 0xFF): a reception we can date but cannot count hops
   *  for.
   *
   *  Its own status rather than a second way to say `notCached`, for two
   *  reasons. It is a different fact — "the radio heard this node and recorded
   *  no path" versus "the radio has nothing about this node at all" — and,
   *  since meshcore-ts 0.8.1, a distinguishable one. And it behaves
   *  differently here: the reception time is real and still advances
   *  last_heard_ms, so answering "nothing cached" while the rail's Last heard
   *  visibly moves would contradict itself on screen. */
  | { status: 'noPath'; recvUnix: number }
  /** The radio doesn't store this contact, so there is nothing to ask about. */
  | { status: 'notOnRadio' }
  | { status: 'offline' }
  | { status: 'failed'; message: string };

/** One outstanding round trip per pubkey. The same contact can be asked for by
 *  the rail's auto-measure, the rail's button and an advert landing at almost
 *  the same instant; without this they become three commands on the wire for one
 *  answer. Concurrent callers share the promise and all see the same result. */
const inFlight = new Map<string, Promise<AdvertPathResult>>();

/** When we last ASKED the radio about a pubkey, on our clock.
 *
 *  Deliberately process memory rather than a fourth column: `observed_at_unix`
 *  is the RADIO's RTC (it can be unset, or years out) so it cannot be compared
 *  against Date.now(), and a "not cached" answer writes no row at all — the one
 *  case that most needs a cooldown. Losing it on restart is fine: the cost is
 *  one command per contact the user actually looks at. */
const lastAsked = new Map<string, number>();

/** Drop this module's per-pubkey state. Tests reuse the module across fresh
 *  temp databases, so a cooldown armed against one database must not silence a
 *  measurement against the next (see tests/support/sqlite-temp.ts). */
export function resetAdvertPathState(): void {
  inFlight.clear();
  lastAsked.clear();
}

const toPubkey = (keyOrPubkey: string) => (keyOrPubkey.startsWith('c:') ? keyOrPubkey.slice(2) : keyOrPubkey);

/** Answer from the sqlite mirror, without touching the radio.
 *
 *  Only `measured` and `notCached` can come out of it: neither a miss nor the
 *  no-path sentinel writes a row (deliberately — neither is a measurement), so
 *  a repeat asked inside the cooldown reports what the mirror HOLDS rather than
 *  what the radio last said. */
function stored(pubkey: string): AdvertPathResult {
  const row = discoveredStore.get(pubkey);
  // >= 0, not truthiness: 0 hops is a measurement, not a miss.
  if (!row || row.observed_hops < 0) return { status: 'notCached' };
  return {
    status: 'measured',
    hops: row.observed_hops,
    pathHex: row.observed_path_hex,
    recvUnix: row.observed_at_unix,
    fromCache: true,
  };
}

/** A radio-reported advert reception time as an our-clock ms value, or null when
 *  it is not believable enough to write into `last_heard_ms`. Exported for the
 *  tests that pin each rejection. */
export function adoptableHeardMs(recvUnix: number, nowMs: number = Date.now()): number | null {
  if (!Number.isFinite(recvUnix) || recvUnix <= 0) return null;
  const ms = recvUnix * 1000;
  if (ms > nowMs) return null;
  if (nowMs - ms > MAX_OBSERVED_HEARD_AGE_MS) return null;
  return ms;
}

/** Fold a radio-reported reception time into `last_heard_ms`, reporting whether
 *  the column actually moved.
 *
 *  The reply's reception time is a real last-heard, and often the only one we
 *  will ever get for this node: the radio hears adverts while we are detached
 *  and a GET_CONTACTS walk (heardLive: false) deliberately never advances the
 *  column, so without this a node the radio heard minutes ago reads "never" and
 *  is dropped from every Last-heard window.
 *
 *  Shared by BOTH answers that carry a timestamp. The flood sentinel says
 *  nothing about the reception — only that no path was recorded for it — so
 *  refusing its timestamp would throw away firmware-authoritative proof of a
 *  reception for a reason that has nothing to do with reception. Range-checked
 *  because the value is the radio's RTC, and markHeard is monotonic, so an
 *  unbelievable one is a no-op rather than a step backwards. */
function adoptHeard(pubkey: string, recvUnix: number): boolean {
  const heard = adoptableHeardMs(recvUnix);
  return heard !== null && discoveredStore.markHeard(pubkey, heard);
}

async function ask(pubkey: string, key: string): Promise<AdvertPathResult> {
  // Stamp before the round trip, not after. A command that times out is exactly
  // the one we must not re-issue in a tight loop, and the lib's own request
  // timeout means a dead radio answers slowly rather than not at all.
  lastAsked.set(pubkey, Date.now());
  try {
    const p = await protocolSession().getAdvertPath(key);
    // null is RESP_ERR NOT_FOUND — the ring doesn't hold this node — OR a link
    // that dropped mid-round-trip. meshcore-ts 0.8.1 removed the third meaning
    // it used to have: a flood-sentinel reply now decodes successfully and
    // arrives flagged (below) instead of failing a length guard and returning
    // null like a miss. It does NOT separate a miss from an abandoned request:
    // the library's teardown resolves the shared ack FIFO before it rejects the
    // typed queue, and requestOrNull's ack entry resolves null without looking
    // at `ok` (pinned in tests/integration/adapter/session-lifecycle.test.ts).
    // So 'notCached' is not radio-authoritative — never persist or cache it as
    // "the ring has no entry". Nothing is written here either way: a miss must
    // not overwrite an older real measurement. The cost of the conflation is
    // the 60s lastAsked cooldown stamped above, which delays the user's retry.
    if (!p) return { status: 'notCached' };
    // path_len 0xFF: the entry exists, but the path it cached is the flood /
    // no-path sentinel. The library reports that as `hops: 0` with an empty
    // path — there are no path bytes on the wire to report — plus `flood`, so
    // this branch MUST come before `hops` is read. Skipping it files a node we
    // know no path to as "heard direct, 0 hops", which then wins the Hops
    // column (cellHops prefers the inbound number), outlives the query in
    // sqlite, and toasts a measurement that never happened. The flag is only
    // ever present-and-true, so test truthiness, never `=== false`.
    if (p.flood) {
      // The reception is real even though the path is unknown, so the timestamp
      // is still worth having; the hop columns are left exactly as they were.
      if (adoptHeard(pubkey, p.recvTimestampUnix)) scheduleDiscoveredEmit();
      log.debug(`advert path ${pubkey.slice(0, 12)}: entry cached with no path`);
      return { status: 'noPath', recvUnix: p.recvTimestampUnix };
    }
    const rowChanged = discoveredStore.setObservedPath(pubkey, {
      hops: p.hops,
      pathHex: p.pathHex,
      recvUnix: p.recvTimestampUnix,
    });
    const bumped = adoptHeard(pubkey, p.recvTimestampUnix);
    if (rowChanged || bumped) scheduleDiscoveredEmit();
    log.debug(`advert path ${pubkey.slice(0, 12)}: ${p.hops} hops`);
    return { status: 'measured', hops: p.hops, pathHex: p.pathHex, recvUnix: p.recvTimestampUnix, fromCache: false };
  } catch (err) {
    // A dropped link or a radio that never replied. Degrade to an honest status
    // rather than a rejection — every caller here is a UI affordance.
    log.debug(`advert path ${pubkey.slice(0, 12)} failed: ${(err as Error).message}`);
    return { status: 'failed', message: (err as Error).message };
  }
}

/** The ONE way to measure a contact's inbound hop count (#45 item 7).
 *
 *  Every caller shares this entry point because every guard it applies —
 *  connected, on-radio, one-in-flight, cooldown — only guards anything if it is
 *  shared. It is a PER-CONTACT round trip and must stay one: fanning it out over
 *  a contact pool would be hundreds of commands for data that is only ever
 *  displayed one row at a time.
 *
 *  Never rejects. Everything the radio can do wrong is a status. */
export async function fetchAdvertPath(keyOrPubkey: string, opts: { force?: boolean } = {}): Promise<AdvertPathResult> {
  const pubkey = toPubkey(keyOrPubkey);
  const key = `c:${pubkey}`;

  if (transportManager.getState().state !== 'connected') return { status: 'offline' };

  const running = inFlight.get(pubkey);
  if (running) return running;

  if (!opts.force) {
    const asked = lastAsked.get(pubkey);
    if (asked !== undefined && Date.now() - asked < ADVERT_PATH_COOLDOWN_MS) return stored(pubkey);
  }

  // Pre-check rather than catch: meshcore-ts THROWS for a contact the radio
  // doesn't store, and reporting that as a radio error would be both wrong and
  // alarming for the discovered-only majority of a real pool. Guarded because
  // reaching the session at all can fail (the link can drop between the check
  // above and here) and this function's contract is that it never rejects — the
  // advert-triggered sampler has nowhere to put a rejection.
  try {
    if (!protocolSession().hasRadioContact(key)) return { status: 'notOnRadio' };
  } catch (err) {
    return { status: 'failed', message: (err as Error).message };
  }

  const p = ask(pubkey, key);
  inFlight.set(pubkey, p);
  try {
    return await p;
  } finally {
    inFlight.delete(pubkey);
  }
}

/** Sample the advert-path ring immediately after hearing an advert from a node.
 *
 *  This is how the column actually fills up. The firmware holds only the 16 most
 *  recently heard nodes, which is emphatically not the set of contacts a user
 *  clicks on — but it is guaranteed to hold the node whose advert just landed,
 *  so the moment of reception is the one moment the answer is certain to exist.
 *
 *  Fire-and-forget by design: it is a hint, not part of ingesting the advert,
 *  and fetchAdvertPath already refuses when disconnected, throttles per pubkey
 *  and de-duplicates in flight. A node that is not on the radio (the common case
 *  for a brand-new advert we did not auto-add) costs nothing — the on-radio
 *  pre-check answers without a command.
 *
 *  Those guards carry more weight than they look like they do. Since meshcore-ts
 *  0.8.x `contactObserved(record, 'advert')` fires for every bare PUSH_ADVERT
 *  (0x80) re-advert, not only for a PUSH_NEW_ADVERT, so on a busy mesh this is
 *  called continuously — which is what the column wants, but it means the
 *  per-pubkey cooldown (one command per node per minute, stamped BEFORE the
 *  round trip) and the in-flight map are the only things standing between a
 *  re-advert storm and a companion link full of CMD_GET_ADVERT_PATH. Keep this
 *  function free of per-call work of its own. */
export function sampleAdvertPathAfterAdvert(pubkey: string): void {
  // fetchAdvertPath resolves a status for everything it can foresee; the catch
  // is for what it can't, because an unhandled rejection here would be raised
  // from inside a frame handler on the main process.
  void fetchAdvertPath(pubkey).catch((err: Error) => log.debug(`advert path sample failed: ${err.message}`));
}
