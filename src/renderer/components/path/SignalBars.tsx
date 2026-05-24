/** Three-bar SVG signal gauge tinted by SNR band. */
export function SignalBars({ snr, size = 12 }: { snr: number; size?: number }) {
  const band = snrBand(snr);
  const lit = band === 'strong' ? 3 : band === 'mid' ? 2 : 1;
  const color = `rgb(var(${snrTokenVar(snr)}))`;
  const dim = 'rgb(var(--cs-border))';
  const heights = [0.4, 0.7, 1.0];
  return (
    <svg
      width={size + 4}
      height={size}
      viewBox={`0 0 ${size + 4} ${size}`}
      role="img"
      aria-label={`Signal ${fmtSnr(snr)}`}
    >
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

/** Coarse SNR classification used to pick a colour token. */
export function snrBand(snr: number): 'strong' | 'mid' | 'weak' {
  if (snr >= 5) return 'strong';
  if (snr >= 0) return 'mid';
  return 'weak';
}

/** CSS custom property name encoding the SNR band's colour. */
export function snrTokenVar(snr: number): string {
  const b = snrBand(snr);
  if (b === 'strong') return '--cs-online';
  if (b === 'mid') return '--cs-warn';
  return '--cs-danger';
}

/** Format an SNR reading as a 2-decimal dB string. */
export function fmtSnr(s: number): string {
  return `${s.toFixed(2)}dB`;
}
