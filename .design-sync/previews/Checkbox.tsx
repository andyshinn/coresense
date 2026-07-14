import { Checkbox, Label } from 'coresense';

// Dark "Field Console" surface, sized like the app's dialog body.
function Surface({ children }) {
  return (
    <div className="w-80 rounded-lg border border-cs-border bg-cs-bg-2 p-4 text-cs-text">{children}</div>
  );
}

export function States() {
  return (
    <Surface>
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <Checkbox checked id="cb-prefer-direct" />
          <Label htmlFor="cb-prefer-direct">Prefer direct path</Label>
        </div>
        <div className="flex items-center gap-2">
          <Checkbox id="cb-auto-add" />
          <Label htmlFor="cb-auto-add">Auto-add new contacts</Label>
        </div>
        <div className="flex items-center gap-2">
          <Checkbox checked disabled id="cb-pubkey" />
          <Label htmlFor="cb-pubkey">Public key</Label>
        </div>
      </div>
    </Surface>
  );
}

export function BlockIdentifiers() {
  return (
    <Surface>
      <div className="flex flex-col gap-2">
        <Label className="text-xs uppercase text-cs-text-dim">Identifiers from this message</Label>
        <div className="flex items-center gap-2">
          <Checkbox checked id="cb-id-key" />
          <span className="flex-1">Public key</span>
          <code className="text-xs text-cs-text-muted">a3f9c1d8…2b7e</code>
        </div>
        <div className="flex items-center gap-2">
          <Checkbox id="cb-id-prefix" />
          <span className="flex-1">Key prefix</span>
          <code className="text-xs text-cs-text-muted">a3f9</code>
        </div>
        <div className="flex items-center gap-2">
          <Checkbox checked id="cb-id-name" />
          <span className="flex-1">Name</span>
          <code className="text-xs text-cs-text-muted">Basecamp Node</code>
        </div>
      </div>
    </Surface>
  );
}

export function TypeFilter() {
  return (
    <Surface>
      <div className="flex flex-col gap-1">
        <label htmlFor="cm-type-repeater" className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-xs">
          <Checkbox checked id="cm-type-repeater" />
          Repeaters
        </label>
        <label htmlFor="cm-type-companion" className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-xs">
          <Checkbox id="cm-type-companion" />
          Companions
        </label>
        <label htmlFor="cm-type-room" className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-xs">
          <Checkbox checked id="cm-type-room" />
          Room servers
        </label>
      </div>
    </Surface>
  );
}
