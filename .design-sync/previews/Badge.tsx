import { Badge } from 'coresense';
import { Radio, Signal, ShieldBan } from 'lucide-react';

// Dark "Field Console" surface — the DS is dark-themed, so cells render on the
// app's own background rather than the card's default white.
function Surface({ children }) {
  return <div className="flex flex-wrap items-center gap-2 rounded-lg bg-cs-bg p-6 text-cs-text">{children}</div>;
}

export function Variants() {
  return (
    <Surface>
      <Badge>Online</Badge>
      <Badge variant="secondary">5 hops</Badge>
      <Badge variant="destructive">Blocked</Badge>
      <Badge variant="outline">Repeater</Badge>
      <Badge variant="ghost">Idle</Badge>
      <Badge variant="link">View path</Badge>
    </Surface>
  );
}

export function NodeStatus() {
  return (
    <Surface>
      <Badge>Connected</Badge>
      <Badge variant="secondary">+9.5 dB SNR</Badge>
      <Badge variant="outline">Heltec V3</Badge>
      <Badge variant="destructive">Stale</Badge>
    </Surface>
  );
}

export function WithIcons() {
  return (
    <Surface>
      <Badge>
        <Radio /> Repeater
      </Badge>
      <Badge variant="secondary">
        <Signal /> -72 dBm
      </Badge>
      <Badge variant="destructive">
        <ShieldBan /> Blocked
      </Badge>
    </Surface>
  );
}

export function PathBadge() {
  return (
    <Surface>
      <Badge variant="secondary" className="font-mono">
        2-byte hops · radio default
      </Badge>
    </Surface>
  );
}
