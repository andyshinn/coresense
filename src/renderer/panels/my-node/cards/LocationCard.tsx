import { MapPin } from 'lucide-react';
import { useId, useState } from 'react';
import { Switch } from '../../../components/ui/switch';
import { QUICK_ACTIONS_BY_ID } from '../../../features/quick-actions/catalog';
import { useApiClient } from '../../../lib/apiClientContext';
import { useStore } from '../../../lib/store';
import { NodeCard } from '../NodeCard';

/** A labelled small switch for a card header. */
function HeaderSwitch({
  label,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  checked: boolean;
  disabled: boolean;
  onChange: () => void;
}) {
  const id = useId();
  return (
    <span className="flex items-center gap-1.5">
      <Switch
        id={id}
        size="sm"
        checked={checked}
        disabled={disabled}
        onCheckedChange={(next) => {
          if (next !== checked) onChange();
        }}
      />
      <label htmlFor={id} className="text-[11px] text-cs-text-muted">
        {label}
      </label>
    </span>
  );
}

/** Where the radio says it is, and whether its adverts carry that. The GPS
 *  and share switches run the owner card's own quick actions, so both stay in
 *  step through the store. */
export function LocationCard({ className }: { className?: string }) {
  const client = useApiClient();
  const owner = useStore((s) => s.owner);
  const connected = useStore((s) => s.transportState === 'connected');
  const gpsOn = useStore((s) => QUICK_ACTIONS_BY_ID.gps.getState?.(s) ?? false);
  const shared = useStore((s) => QUICK_ACTIONS_BY_ID.shareLoc.getState?.(s) ?? false);
  const lat = useStore((s) => s.deviceIdentity.lat);
  const lon = useStore((s) => s.deviceIdentity.lon);
  const [busy, setBusy] = useState(false);

  const run = (id: 'gps' | 'shareLoc') => async () => {
    setBusy(true);
    try {
      await QUICK_ACTIONS_BY_ID[id].run({ client, owner });
    } finally {
      setBusy(false);
    }
  };

  const hasPosition = lat !== null && lon !== null && (lat !== 0 || lon !== 0);
  const disabled = !connected || !client || busy;

  return (
    <NodeCard
      icon={MapPin}
      title="Location"
      className={className}
      extras={
        <>
          <HeaderSwitch label="GPS" checked={gpsOn} disabled={disabled} onChange={() => void run('gps')()} />
          <HeaderSwitch
            label="Share in advert"
            checked={shared}
            disabled={disabled}
            onChange={() => void run('shareLoc')()}
          />
        </>
      }
    >
      {/* The draggable map and the position fields replace this in the next phase. */}
      <div
        data-testid="location-map-slot"
        className="flex h-60 flex-col items-center justify-center gap-1 rounded-md border border-cs-border bg-cs-bg-3"
      >
        <span className="font-mono text-[13px] tabular-nums text-cs-text">
          {hasPosition ? `${lat?.toFixed(5)}, ${lon?.toFixed(5)}` : 'No position set'}
        </span>
        <span className="text-[11px] text-cs-text-muted">{shared ? 'Shared in adverts' : 'Not shared in adverts'}</span>
      </div>
    </NodeCard>
  );
}
