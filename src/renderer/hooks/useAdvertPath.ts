import { useCallback, useEffect, useRef, useState } from 'react';
import { type ApiClient, ApiError, api } from '../lib/api';
import { notify } from '../lib/notify';

/** How long a contact has to stay focused before an automatic measurement
 *  fires. Focusing a contact is a click or an arrow key, so a user walking down
 *  the Contact Manager generates a focus change every few tens of milliseconds;
 *  without a settle window each one would be an HTTP request and a companion
 *  command for a row that is already gone from the rail. */
const FOCUS_SETTLE_MS = 500;

/** Pubkeys this renderer session has already auto-measured.
 *
 *  The presence of a measurement can't be used for this: the common answer is
 *  "the radio has nothing cached", which stores nothing, so an effect keyed on
 *  the row's value would re-ask on every one of the websocket pushes that the
 *  rail re-renders on. One automatic attempt per contact per session; the button
 *  is the retry.
 *
 *  Only an attempt the RADIO actually answered is recorded (see `Outcome`). The
 *  memo used to be armed before the request went out, which burned a contact's
 *  one automatic attempt on things that never reached the radio at all — the
 *  rail focuses a contact as soon as the local API server is up, seconds before
 *  a BLE link exists, and a request skipped because another contact's was in
 *  flight never left the renderer. Both left the row reading "not measured" for
 *  the rest of the session. */
const autoMeasured = new Set<string>();

/** Test seam — the memo above is module state keyed by pubkey. */
export function resetAdvertPathMemo(): void {
  autoMeasured.clear();
}

/** What one attempt did, for the memo above.
 *
 *  `answered` — the radio was asked and said something about this node (a hop
 *    count, or "nothing cached"); that is the attempt the memo spends.
 *  `retryable` — no radio attached yet, a dropped link, or a contact that is
 *    not on the radio YET; a later visit can legitimately do better.
 *  `skipped` — nothing was issued at all (no client/key, or this same contact
 *    is already in flight). */
type Outcome = 'answered' | 'retryable' | 'skipped';

function describe(hops: number | undefined): string {
  if (hops === 0) return 'Heard direct — 0 hops';
  return `Heard ${hops} hop${hops === 1 ? '' : 's'} away`;
}

/** The two ways the radio can answer without a hop count.
 *
 *  Both are informational, but they are different facts and only one of them is
 *  about us not having asked recently enough. `noPath` means the radio's ring
 *  holds this node and cached the flood / no-path sentinel for it — the same
 *  reply that, before meshcore-ts 0.8.1 made the sentinel visible, was toasted
 *  as "Heard direct — 0 hops" for a node no path is known to. Saying "no recent
 *  advert path" for it would be wrong twice over: the radio heard it, and the
 *  same reply can move the row's Last heard a moment later. */
function describeMiss(reason: 'noPath' | undefined): string {
  return reason === 'noPath'
    ? 'Radio heard this node but cached no path for it — hop count unknown'
    : 'Radio has no recent advert path for this node';
}

/** Measure a contact's INBOUND hop count by asking the radio for its cached
 *  advert path (#45 item 7).
 *
 *  Two triggers, one request path. `auto` fires once per contact per session
 *  after the rail settles on it, and says nothing on failure — an automatic
 *  measurement the user did not ask for must not toast at them, least of all to
 *  report the ordinary "the radio hasn't heard this node lately". The returned
 *  `measure` is the explicit button: it skips the server's re-ask cooldown and
 *  reports every outcome.
 *
 *  The measurement itself is not returned. It is persisted server-side and
 *  arrives as a `discovered` push, so the row re-renders from the store like
 *  every other contact field. */
export function useAdvertPath(
  client: ApiClient | null,
  publicKeyHex: string | null,
  opts: { auto?: boolean } = {},
): { measuring: boolean; measure: () => Promise<void> } {
  const auto = opts.auto ?? false;
  // Which pubkeys this hook has outstanding. A ref, not the state below: the
  // websocket push that follows a successful measurement re-renders this
  // component, and a stale closure over a state flag would let a second request
  // through. Keyed by pubkey, not a bare boolean, because the rail re-uses ONE
  // ContactDetail instance as the focus moves — a boolean survived the switch,
  // so an outstanding measurement for contact A silently swallowed B's (button
  // press included: no request, no spinner, no toast) for as long as A's
  // command took to time out, which is up to the lib's 5s request timeout.
  const busy = useRef<Set<string>>(new Set());
  // The same set, mirrored into state so the spinner can render. `measuring` is
  // therefore about THIS contact rather than about the component: a request
  // still outstanding for the previously focused one must not leave the button
  // spinning — and disabled — for the contact now on screen.
  const [inFlight, setInFlight] = useState<readonly string[]>([]);

  const run = useCallback(
    async (silent: boolean): Promise<Outcome> => {
      const pubkey = publicKeyHex;
      if (!client || !pubkey || busy.current.has(pubkey)) return 'skipped';
      busy.current.add(pubkey);
      setInFlight([...busy.current]);
      try {
        const res = await api.getAdvertPath(client, `c:${pubkey}`, { force: !silent });
        if (!silent) {
          if (!res.cached) notify.info(describeMiss(res.reason));
          else notify.success(describe(res.hops));
        }
        return 'answered';
      } catch (err) {
        // The radio not storing this contact is a state, not a fault — the app
        // knows plenty of nodes the radio doesn't — and it is a state one click
        // on "Add to radio" changes, so it stays retryable.
        if (err instanceof ApiError && err.code === 'NOT_ON_RADIO') {
          if (!silent) notify.info('Add this contact to the radio before measuring its advert path');
          return 'retryable';
        }
        if (!silent) notify.error(`Could not measure heard hops: ${(err as Error).message}`, err);
        return 'retryable';
      } finally {
        busy.current.delete(pubkey);
        setInFlight([...busy.current]);
      }
    },
    [client, publicKeyHex],
  );

  useEffect(() => {
    if (!auto || !client || !publicKeyHex || autoMeasured.has(publicKeyHex)) return;
    const pubkey = publicKeyHex;
    const timer = setTimeout(() => {
      // Memoised AFTER the attempt and only on an answer. Arming it up front
      // spent the contact's single automatic attempt on requests that never
      // reached the radio — the app focuses a contact as soon as the local API
      // server answers, which is seconds before a BLE link exists.
      void run(true).then((outcome) => {
        if (outcome === 'answered') autoMeasured.add(pubkey);
      });
    }, FOCUS_SETTLE_MS);
    // Focus moved on before the window elapsed: that contact never gets asked
    // about at all, which is the whole point of the delay.
    return () => clearTimeout(timer);
  }, [auto, client, publicKeyHex, run]);

  return {
    measuring: publicKeyHex != null && inFlight.includes(publicKeyHex),
    measure: useCallback(async () => {
      await run(false);
    }, [run]),
  };
}
