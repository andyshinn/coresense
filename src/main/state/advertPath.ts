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

export type AdvertPathResult =
  /** A real answer. `fromCache` means it came from the sqlite mirror under the
   *  cooldown above rather than from a fresh radio round trip. */
  | { status: 'measured'; hops: number; pathHex: string; recvUnix: number; fromCache: boolean }
  /** The radio has no advert path for this node — the normal answer for 15 of
   *  every 16 contacts, and not an error. */
  | { status: 'notCached' }
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

/** Answer from the sqlite mirror, without touching the radio. */
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

async function ask(pubkey: string, key: string): Promise<AdvertPathResult> {
  // Stamp before the round trip, not after. A command that times out is exactly
  // the one we must not re-issue in a tight loop, and the lib's own request
  // timeout means a dead radio answers slowly rather than not at all.
  lastAsked.set(pubkey, Date.now());
  try {
    const p = await protocolSession().getAdvertPath(key);
    // null is "the ring doesn't hold this node" (and, indistinguishably, "the
    // cached path was OUT_PATH_UNKNOWN" — see SessionAdapter.getAdvertPath).
    // Nothing is written: a miss must not overwrite an older real measurement.
    if (!p) return { status: 'notCached' };
    if (discoveredStore.setObservedPath(pubkey, { hops: p.hops, pathHex: p.pathHex, recvUnix: p.recvTimestampUnix })) {
      scheduleDiscoveredEmit();
    }
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
 *  pre-check answers without a command. */
export function sampleAdvertPathAfterAdvert(pubkey: string): void {
  // fetchAdvertPath resolves a status for everything it can foresee; the catch
  // is for what it can't, because an unhandled rejection here would be raised
  // from inside a frame handler on the main process.
  void fetchAdvertPath(pubkey).catch((err: Error) => log.debug(`advert path sample failed: ${err.message}`));
}
