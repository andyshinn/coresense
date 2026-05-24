import { Crosshair, MessageSquare, Settings } from 'lucide-react';
import { type Contact, hasValidFix } from '../../../../shared/types';
import { KeyValueRow } from '../../../components/ui/KeyValueRow';
import { publish as publishMapBus } from '../../../lib/map/bus';
import { useStore } from '../../../lib/store';
import { fmtDateTime, fmtRelative } from '../../../lib/time';
import { Placeholder } from '../atoms';

/** Identity, link metrics, position, and quick actions for a contact. */
export function ContactCardSection({ contact }: { contact: Contact | null }) {
  const setActiveKey = useStore((s) => s.setActiveKey);
  const timeFormat = useStore((s) => s.appSettings.timeFormat);
  if (!contact) return <Placeholder label="unknown contact" />;
  const hasFix = hasValidFix(contact);
  const canAdminister = contact.kind === 'repeater' || contact.kind === 'sensor';
  return (
    <div className="space-y-1.5 text-cs-text-muted">
      <KeyValueRow label="Name" value={contact.name} />
      <KeyValueRow label="Kind" value={contact.kind} mono />
      <KeyValueRow label="Public key" value={`${contact.publicKeyHex.slice(0, 16)}…`} mono />
      {contact.lastSeenMs != null && (
        <KeyValueRow
          label="Last seen"
          value={fmtRelative(contact.lastSeenMs)}
          title={fmtDateTime(contact.lastSeenMs, timeFormat)}
        />
      )}
      {contact.rssi != null && <KeyValueRow label="RSSI" value={`${contact.rssi} dBm`} mono />}
      {contact.hops != null && <KeyValueRow label="Hops" value={String(contact.hops)} mono />}
      {hasFix && (
        <>
          <KeyValueRow
            label="Position"
            value={`${(contact.gpsLat as number).toFixed(5)}, ${(contact.gpsLon as number).toFixed(5)}`}
            mono
          />
          <div className="flex flex-wrap gap-1.5 pt-1">
            <CardActionButton
              icon={MessageSquare}
              label="Open conversation"
              onClick={() => setActiveKey(contact.key)}
            />
            {canAdminister && (
              <CardActionButton
                icon={Settings}
                label="Administer"
                onClick={() => setActiveKey(contact.key)}
              />
            )}
            <CardActionButton
              icon={Crosshair}
              label="Center on map"
              onClick={() => {
                // Open the Map panel first; if it isn't mounted yet the bus
                // stashes this flyTo and replays it once MapCanvas subscribes.
                setActiveKey('tool:map');
                publishMapBus({
                  kind: 'flyTo',
                  lng: contact.gpsLon as number,
                  lat: contact.gpsLat as number,
                  zoom: 12,
                });
              }}
            />
          </div>
        </>
      )}
    </div>
  );
}

/** Compact icon+label button used inside the contact card action row. */
export function CardActionButton({
  icon: Icon,
  label,
  onClick,
}: {
  icon: typeof MessageSquare;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1 rounded border border-cs-border bg-cs-bg-3 px-2 py-0.5 text-[10px] text-cs-text hover:bg-cs-border"
    >
      <Icon size={11} aria-hidden />
      {label}
    </button>
  );
}
