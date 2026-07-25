import type { ReactNode } from 'react';
import type { ActivityBand } from '../../../../../shared/types';
import { fmtAgoShort } from '../../../../lib/time';
import { type ActivityMode, fmtBand } from './activity';

function Value({ children }: { children: ReactNode }) {
  return <span className="font-semibold text-cs-text">{children}</span>;
}

/** One muted line describing the channel's habit. The bands come from a fixed
 *  trailing-168h histogram, so they do not change when the window tab does —
 *  they describe the channel, not the selected period. */
export function RhythmFooter({
  peak,
  quiet,
  lastTs,
  mode,
  now,
}: {
  peak: ActivityBand | null;
  quiet: ActivityBand | null;
  lastTs: number | null;
  mode: ActivityMode;
  now: number;
}) {
  const parts: Array<{ id: string; node: ReactNode }> = [];
  if (peak) {
    parts.push({
      id: 'peak',
      node: (
        <>
          Peak <Value>{fmtBand(peak)}</Value>
        </>
      ),
    });
  }
  if (mode === 'full' && quiet) {
    parts.push({
      id: 'quiet',
      node: (
        <>
          quiet <Value>{fmtBand(quiet)}</Value>
        </>
      ),
    });
  }
  if (lastTs != null) {
    parts.push({
      id: 'last',
      node: (
        <>
          last msg <Value>{fmtAgoShort(lastTs, now)}</Value>
        </>
      ),
    });
  }
  if (parts.length === 0) return null;

  return (
    <p data-testid="activity-rhythm" className="mt-[13px] text-[11px] text-cs-text-muted">
      {parts.map((part, i) => (
        <span key={part.id}>
          {i > 0 && <span className="mx-[5px] text-cs-text-dim">·</span>}
          {part.node}
        </span>
      ))}
    </p>
  );
}
