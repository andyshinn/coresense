import { type SettingsTab, useStore } from '../../lib/store';
import { cn } from '../../lib/utils';

// Small header status pill: App and Quick Actions settings are stored locally;
// every other tab shows the live radio connection. Extra's Packet Log setting is
// local too, but the tab's other sections act on the radio.
export function StatusPill({ tab }: { tab: SettingsTab }) {
  const connected = useStore((s) => s.transportState === 'connected');
  const online = tab === 'app' || tab === 'quickActions' ? true : connected;
  const label =
    tab === 'app' || tab === 'quickActions'
      ? 'Local · stored on this machine'
      : connected
        ? 'Radio connected'
        : 'No radio connected';

  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] text-cs-text-muted">
      <span aria-hidden className={cn('size-1.5 rounded-full', online ? 'bg-cs-online' : 'bg-cs-text-dim')} />
      {label}
    </span>
  );
}
