import { useMemo } from 'react';
import { Slider } from '../../../components/ui/slider';

// Slider goes 1..720 hours (1h..30d). Log-scale presentation so the slider
// gives finer control at the recent end, where it matters most for triage.
const HOUR_STOPS = [1, 3, 6, 12, 24, 48, 168, 720];

export function LastHeardSlider({
  value,
  onChange,
}: {
  value: number;
  onChange: (hours: number) => void;
}) {
  // Slider drives an index into the discrete hour stops above. Snapping to the
  // canonical stops keeps the labels honest and matches the design's three
  // tick marks (1h · ≤24h · 30d).
  const index = useMemo(() => {
    let best = 0;
    let diff = Number.POSITIVE_INFINITY;
    for (let i = 0; i < HOUR_STOPS.length; i++) {
      const stop = HOUR_STOPS[i] ?? 0;
      const d = Math.abs(stop - value);
      if (d < diff) {
        diff = d;
        best = i;
      }
    }
    return best;
  }, [value]);

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-[11px]">
        <span className="text-cs-text-muted">cutoff</span>
        <span className="font-mono text-cs-text">{formatHours(value)}</span>
      </div>
      <Slider
        min={0}
        max={HOUR_STOPS.length - 1}
        step={1}
        value={[index]}
        onValueChange={([v]) => {
          const next = HOUR_STOPS[v ?? 0];
          if (typeof next === 'number') onChange(next);
        }}
      />
      <div className="flex justify-between font-mono text-[10px] text-cs-text-dim">
        <span>1h</span>
        <span>24h</span>
        <span>30d</span>
      </div>
    </div>
  );
}

function formatHours(h: number): string {
  if (h < 24) return `${h}h`;
  if (h < 168) return `${Math.round(h / 24)}d`;
  return `${Math.round(h / 168)}w`;
}
