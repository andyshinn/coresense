interface Props {
  data: number[];
  className?: string;
}

const W = 4;
const GAP = 2;
const H = 24;

/** Tiny inline-SVG bar chart. Color follows `currentColor`, so set it via a
 *  text-color class on `className` (e.g. `text-cs-accent`). */
export function Sparkline({ data, className }: Props) {
  const max = Math.max(1, ...data);
  return (
    <svg
      className={className}
      width={data.length * (W + GAP)}
      height={H}
      viewBox={`0 0 ${data.length * (W + GAP)} ${H}`}
      role="img"
      aria-label="activity over the last 7 days"
    >
      {data.map((v, i) => {
        const barH = Math.round((v / max) * H);
        // biome-ignore lint/suspicious/noArrayIndexKey: fixed-length positional day gauge (see SignalBars.tsx)
        return <rect key={i} x={i * (W + GAP)} y={H - barH} width={W} height={barH} rx={1} fill="currentColor" />;
      })}
    </svg>
  );
}
