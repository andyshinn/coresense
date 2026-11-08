import { Bluetooth } from 'lucide-react';
import type { NodeCacheEntry } from '../../../shared/types';
import { Button } from '../../components/ui/button';
import { useNowTick } from '../../hooks/useNowTick';
import { useStore } from '../../lib/store';
import { fmtRelative } from '../../lib/time';
import { cn } from '../../lib/utils';

interface Props {
  connected: boolean;
  /** The BLE peripheral's advertised name, or its id when unnamed. */
  linkName: string | null;
  entry: NodeCacheEntry | null;
  busy: boolean;
  onDisconnect: () => void;
}

/** My Node's 56 px header: which radio this is, and the link to it. */
export function NodeHeader({ connected, linkName, entry, busy, onDisconnect }: Props) {
  const owner = useStore((s) => s.owner);
  const deviceInfo = useStore((s) => s.deviceInfo);
  const now = useNowTick(30_000);

  const name = (connected ? owner?.name : entry?.identity.name) || entry?.identity.name || 'No radio yet';
  const info = connected ? deviceInfo : entry?.deviceInfo;
  const detail = connected
    ? [info?.deviceModel, info?.firmwareVersion].filter(Boolean).join(' · ')
    : entry?.lastSeenAt
      ? `Last connected ${fmtRelative(entry.lastSeenAt, now)}`
      : 'Connect a radio to see it here';

  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-cs-border bg-cs-bg-2 px-4">
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="label-caps-mono text-cs-text-muted">My node</span>
        <h2 className={cn('truncate text-[16px] leading-6 font-medium', connected ? 'text-cs-text' : 'text-cs-text-muted')}>
          {name}
        </h2>
        {detail && <span className="truncate font-mono text-[11px] leading-4 text-cs-text-muted">{detail}</span>}
      </div>
      {connected ? (
        <div className="flex shrink-0 items-center gap-3">
          <span className="flex min-w-0 items-center gap-1.5 font-mono text-[11px] text-cs-text-muted">
            <Bluetooth aria-hidden="true" className="size-3.5 shrink-0 text-cs-accent" />
            <span className="max-w-56 truncate">BLE{linkName ? ` · ${linkName}` : ''}</span>
          </span>
          <span aria-hidden="true" className="h-5 w-px bg-cs-border" />
          <Button variant="outline" size="sm" onClick={onDisconnect} disabled={busy}>
            Disconnect
          </Button>
        </div>
      ) : (
        <span className="flex shrink-0 items-center gap-2 text-[12px] text-cs-text-muted">
          <span aria-hidden="true" className="size-2 rounded-full bg-cs-text-dim" />
          Not connected
        </span>
      )}
    </header>
  );
}
