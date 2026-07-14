import { Separator } from 'coresense';

// Dark "Field Console" surface, sized like the right-rail detail / path editor
// panel where separators divide stacked sections.
function Surface({ children }) {
  return (
    <div className="w-72 rounded-lg border border-cs-border bg-cs-bg-2 p-4 text-cs-text">{children}</div>
  );
}

export function StackedRows() {
  return (
    <Surface>
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <span className="text-[12px] text-cs-text-muted">Ridgeline Repeater</span>
          <span className="font-mono text-[12px] text-cs-text">+9.5 dB</span>
        </div>
        <Separator />
        <div className="flex items-center justify-between">
          <span className="text-[12px] text-cs-text-muted">Valley Base</span>
          <span className="font-mono text-[12px] text-cs-text">+4.0 dB</span>
        </div>
        <Separator />
        <div className="flex items-center justify-between">
          <span className="text-[12px] text-cs-text-muted">Trailhead Relay</span>
          <span className="font-mono text-[12px] text-cs-text">-2.5 dB</span>
        </div>
      </div>
    </Surface>
  );
}

export function InlineStats() {
  return (
    <Surface>
      <div className="flex h-5 items-center gap-3 font-mono text-[12px] text-cs-text">
        <span>3 hops</span>
        <Separator orientation="vertical" />
        <span>-72 dBm</span>
        <Separator orientation="vertical" />
        <span>87%</span>
      </div>
    </Surface>
  );
}

export function PathSection() {
  return (
    <Surface>
      <div className="flex flex-col gap-3">
        <div className="flex flex-col">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-cs-text-muted">Path</span>
          <span className="font-mono text-[13px] text-cs-text">a3f9 › 1c2b › d8e4</span>
        </div>
        <Separator />
        <div className="flex flex-col">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-cs-text-muted">Channel</span>
          <span className="font-mono text-[13px] text-cs-text">Public</span>
        </div>
      </div>
    </Surface>
  );
}
