import { fmtSnr, snrBand, snrTokenVar } from '../../lib/signal';

/** Three-bar SVG signal gauge tinted by SNR band. */
export function SignalBars({ snr, size = 12 }: { snr: number; size?: number }) {
  const band = snrBand(snr);
  const lit = band === 'strong' ? 3 : band === 'mid' ? 2 : 1;
  const color = `rgb(var(${snrTokenVar(snr)}))`;
  const dim = 'rgb(var(--cs-border))';
  const heights = [0.4, 0.7, 1.0];
  return (
    <svg width={size + 4} height={size} viewBox={`0 0 ${size + 4} ${size}`} role="img" aria-label={`Signal ${fmtSnr(snr)}`}>
      {heights.map((h, i) => {
        const barW = 3;
        const gap = 2;
        const x = i * (barW + gap);
        const y = size - size * h;
        return (
          <rect
            // biome-ignore lint/suspicious/noArrayIndexKey: fixed-length 3-bar gauge
            key={i}
            x={x}
            y={y}
            width={barW}
            height={size * h}
            rx={0.5}
            fill={i < lit ? color : dim}
          />
        );
      })}
    </svg>
  );
}
