import { Slider } from 'coresense';

// Dark "Field Console" surface — sliders live in map controls and the prune
// settings, so give the panel the same fixed width as those rails.
function Surface({ children }) {
  return (
    <div className="w-72 rounded-lg border border-cs-border bg-cs-bg-2 p-4 text-cs-text">{children}</div>
  );
}

export function MapZoom() {
  return (
    <Surface>
      <div className="space-y-2">
        <div className="flex items-center justify-between text-[11px]">
          <span className="text-cs-text-muted">Map zoom</span>
          <span className="font-mono text-cs-text">11</span>
        </div>
        <Slider defaultValue={[11]} min={1} max={18} step={1} />
      </div>
    </Surface>
  );
}

export function PruneOlderThan() {
  return (
    <Surface>
      <div className="space-y-2">
        <div className="flex items-center justify-between text-[11px]">
          <span className="text-cs-text-muted">Prune older than (days)</span>
          <span className="font-mono text-cs-text">30</span>
        </div>
        <Slider defaultValue={[30]} min={1} max={90} step={1} />
      </div>
    </Surface>
  );
}

export function HopLimitRange() {
  return (
    <Surface>
      <div className="space-y-2">
        <div className="flex items-center justify-between text-[11px]">
          <span className="text-cs-text-muted">Hop limit</span>
          <span className="font-mono text-cs-text">2 – 5</span>
        </div>
        <Slider defaultValue={[2, 5]} min={0} max={8} step={1} />
        <div className="flex justify-between font-mono text-[10px] text-cs-text-dim">
          <span>0</span>
          <span>8</span>
        </div>
      </div>
    </Surface>
  );
}

export function Disabled() {
  return (
    <Surface>
      <div className="space-y-2">
        <div className="flex items-center justify-between text-[11px]">
          <span className="text-cs-text-muted">Last heard cutoff</span>
          <span className="font-mono text-cs-text-dim">disconnected</span>
        </div>
        <Slider defaultValue={[24]} min={1} max={72} step={1} disabled />
      </div>
    </Surface>
  );
}
