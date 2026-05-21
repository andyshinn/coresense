import { useEffect, useState } from 'react';
import { useStore } from '../lib/store';
import { fmtDateTime, fmtRelative } from '../lib/time';

interface Props {
  ts: number;
  className?: string;
}

// A self-updating "2 minutes ago" label with the absolute timestamp on hover.
// Ticks once a minute so the relative text never goes stale while on screen.
export function RelativeTime({ ts, className }: Props) {
  const pref = useStore((s) => s.appSettings.timeFormat);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  return (
    <time dateTime={new Date(ts).toISOString()} title={fmtDateTime(ts, pref)} className={className}>
      {fmtRelative(ts, now)}
    </time>
  );
}
