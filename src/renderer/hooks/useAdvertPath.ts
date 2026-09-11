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
 *  is the retry. */
const autoMeasured = new Set<string>();

/** Test seam — the memo above is module state keyed by pubkey. */
export function resetAdvertPathMemo(): void {
  autoMeasured.clear();
}

function describe(hops: number | undefined): string {
  if (hops === 0) return 'Heard direct — 0 hops';
  return `Heard ${hops} hop${hops === 1 ? '' : 's'} away`;
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
  const [measuring, setMeasuring] = useState(false);
  // A ref, not the state flag: the websocket push that follows a successful
  // measurement re-renders this component, and a stale `measuring` closure
  // would let a second request through.
  const busy = useRef(false);

  const run = useCallback(
    async (silent: boolean) => {
      if (!client || !publicKeyHex || busy.current) return;
      busy.current = true;
      setMeasuring(true);
      try {
        const res = await api.getAdvertPath(client, `c:${publicKeyHex}`, { force: !silent });
        if (silent) return;
        if (!res.cached) notify.info('Radio has no recent advert path for this node');
        else notify.success(describe(res.hops));
      } catch (err) {
        if (silent) return;
        // The radio not storing this contact is a state, not a fault — the app
        // knows plenty of nodes the radio doesn't.
        if (err instanceof ApiError && err.code === 'NOT_ON_RADIO') {
          notify.info('Add this contact to the radio before measuring its advert path');
        } else {
          notify.error(`Could not measure heard hops: ${(err as Error).message}`, err);
        }
      } finally {
        busy.current = false;
        setMeasuring(false);
      }
    },
    [client, publicKeyHex],
  );

  useEffect(() => {
    if (!auto || !client || !publicKeyHex || autoMeasured.has(publicKeyHex)) return;
    const timer = setTimeout(() => {
      autoMeasured.add(publicKeyHex);
      void run(true);
    }, FOCUS_SETTLE_MS);
    // Focus moved on before the window elapsed: that contact never gets asked
    // about at all, which is the whole point of the delay.
    return () => clearTimeout(timer);
  }, [auto, client, publicKeyHex, run]);

  return { measuring, measure: useCallback(() => run(false), [run]) };
}
