import { useRef, useState } from 'react';
import { notify } from '../lib/notify';

/** Wrap an async action with a busy flag and a failure toast.
 *
 *  `run` is a no-op while a previous call is still in flight; a throw becomes
 *  `notify.failure(failureLabel, err)` ("<label> failed: <message>"). The
 *  in-flight guard is a ref rather than the `busy` state, so two calls in the
 *  same render (a double click) cannot both get through. */
export function useBusyAction<A extends unknown[]>(
  fn: (...args: A) => Promise<void>,
  failureLabel: string,
): [run: (...args: A) => Promise<void>, busy: boolean] {
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const run = async (...args: A) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    try {
      await fn(...args);
    } catch (err) {
      notify.failure(failureLabel, err);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };
  return [run, busy];
}
