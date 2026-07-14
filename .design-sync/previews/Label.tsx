import { Checkbox, Input, Label } from 'coresense';

// Dark "Field Console" surface, sized like the app's dialog body.
function Surface({ children }) {
  return (
    <div className="w-80 rounded-lg border border-cs-border bg-cs-bg-2 p-4 text-cs-text">{children}</div>
  );
}

export function WithInput() {
  return (
    <Surface>
      <div className="space-y-1">
        <Label htmlFor="block-note" className="text-xs uppercase text-cs-text-dim">
          Note (optional)
        </Label>
        <Input id="block-note" placeholder="Reason for blocking…" />
      </div>
    </Surface>
  );
}

export function WithCheckbox() {
  return (
    <Surface>
      <div className="flex items-start gap-2">
        <Checkbox checked id="prefer-direct" />
        <div className="flex flex-col gap-0.5">
          <Label htmlFor="prefer-direct" className="cursor-pointer">
            Direct
          </Label>
          <span className="text-[11px] text-cs-text-dim">Connection to radio will prefer a direct path.</span>
        </div>
      </div>
    </Surface>
  );
}

export function SectionHeading() {
  return (
    <Surface>
      <div className="flex flex-col gap-2">
        <Label className="text-[11px] uppercase tracking-wider text-cs-text-muted">Hops (in order)</Label>
        <Input value="a3f9 → 7c21 → Basecamp Node" readOnly className="font-mono text-[11px]" />
      </div>
    </Surface>
  );
}
