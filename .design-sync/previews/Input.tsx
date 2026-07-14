import { Input } from 'coresense';

// Dark "Field Console" surface, sized like the app's dialog/toolbar fields.
function Surface({ children }) {
  return (
    <div className="w-80 rounded-lg border border-cs-border bg-cs-bg-2 p-4 text-cs-text">{children}</div>
  );
}

export function States() {
  return (
    <Surface>
      <div className="flex flex-col gap-3">
        <Input placeholder="Search 42 contacts by name or key…" />
        <Input value="Ridgeline Repeater" />
        <Input value="Connecting…" disabled />
      </div>
    </Surface>
  );
}

export function BlockRule() {
  return (
    <Surface>
      <div className="flex flex-col gap-3">
        <Input placeholder="^Bob.*$" className="font-mono" />
        <Input value="Spamming #general overnight" />
      </div>
    </Surface>
  );
}

export function ReadOnlyHop() {
  return (
    <Surface>
      <Input value="a3f9" readOnly className="font-mono text-[11px]" aria-label="Hop prefix" />
    </Surface>
  );
}
