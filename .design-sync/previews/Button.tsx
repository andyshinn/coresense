import { Button } from 'coresense';
import { Download, Plus, Radio, Trash2 } from 'lucide-react';

// Dark "Field Console" surface — the DS is dark-themed, so cells render on the
// app's own background rather than the card's default white.
function Surface({ children }) {
  return <div className="flex flex-wrap items-center gap-3 rounded-lg bg-cs-bg p-6 text-cs-text">{children}</div>;
}

export function Variants() {
  return (
    <Surface>
      <Button>Connect</Button>
      <Button variant="secondary">Rescan</Button>
      <Button variant="outline">Settings</Button>
      <Button variant="ghost">Cancel</Button>
      <Button variant="destructive">Remove</Button>
      <Button variant="link">View log</Button>
    </Surface>
  );
}

export function Sizes() {
  return (
    <Surface>
      <Button size="xs">Extra small</Button>
      <Button size="sm">Small</Button>
      <Button size="default">Default</Button>
      <Button size="lg">Large</Button>
    </Surface>
  );
}

export function WithIcons() {
  return (
    <Surface>
      <Button>
        <Radio /> Connect node
      </Button>
      <Button variant="secondary">
        <Plus /> Add channel
      </Button>
      <Button variant="outline">
        <Download /> Export
      </Button>
      <Button variant="destructive">
        <Trash2 /> Delete
      </Button>
    </Surface>
  );
}

export function IconButtons() {
  return (
    <Surface>
      <Button size="icon" aria-label="Add">
        <Plus />
      </Button>
      <Button size="icon-sm" variant="outline" aria-label="Rescan">
        <Radio />
      </Button>
      <Button size="icon" variant="ghost" aria-label="Export">
        <Download />
      </Button>
      <Button size="icon" variant="destructive" aria-label="Delete">
        <Trash2 />
      </Button>
    </Surface>
  );
}

export function Disabled() {
  return (
    <Surface>
      <Button disabled>Connecting…</Button>
      <Button variant="secondary" disabled>
        Rescan
      </Button>
      <Button variant="outline" disabled>
        Settings
      </Button>
    </Surface>
  );
}
