import { useEffect, useState } from 'react';

/** One clock for a whole list.
 *
 *  RelativeTime mounts an interval AND a store subscription per instance, which
 *  is fine for a handful of timestamps and pathological for a 156-row roster.
 *  Sections that render many ages call this once and pass `now` down as a prop.
 *
 *  The default 30s cadence is half the shortest ladder rung (1 minute), so an
 *  age is never more than one tick stale. */
export function useNowTick(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}
