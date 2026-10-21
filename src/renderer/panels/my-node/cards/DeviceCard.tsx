import { Cpu, TriangleAlert } from 'lucide-react';
import { KeyValueRow } from '../../../components/ui/KeyValueRow';
import { useStore } from '../../../lib/store';
import { cn } from '../../../lib/utils';
import { fmtFirmware, fmtStorageKb } from '../../../shell/leftnav/ownerFormat';
import { CardLink, NodeCard } from '../NodeCard';

function CapacityRow({
  label,
  used,
  max,
  value,
  warn,
}: {
  label: string;
  used: number;
  max: number;
  value: string;
  warn?: boolean;
}) {
  const pct = max > 0 ? Math.min(100, (used / max) * 100) : 0;
  return (
    <div className="flex items-center gap-2">
      <span className="w-16 shrink-0 text-[10px] uppercase tracking-wider text-cs-text-muted">{label}</span>
      <div className="h-1 flex-1 overflow-hidden rounded-full bg-cs-bg-3" aria-hidden="true">
        <div className={cn('h-full rounded-full', warn ? 'bg-cs-warn' : 'bg-cs-accent')} style={{ width: `${pct}%` }} />
      </div>
      <span
        className={cn('w-24 shrink-0 text-right font-mono text-[11px] tabular-nums', warn ? 'text-cs-warn' : 'text-cs-text')}
      >
        {value}
      </span>
    </div>
  );
}

/** Model, firmware and the radio's capacity. Same store fields as the owner
 *  card's hover popover; no fetch of its own. */
export function DeviceCard({ className }: { className?: string }) {
  const deviceInfo = useStore((s) => s.deviceInfo);
  const contactCount = useStore((s) => s.contacts.length);
  const channelCount = useStore((s) => s.channels.length);
  const setActiveKey = useStore((s) => s.setActiveKey);

  const maxContacts = deviceInfo.maxContacts || 0;
  const maxChannels = deviceInfo.maxChannels || 0;
  const storageTotal = deviceInfo.storageTotalKb || 0;
  const contactsFull = maxContacts > 0 && contactCount >= maxContacts;

  return (
    <NodeCard icon={Cpu} title="Device" className={className}>
      <div className="flex flex-col gap-1">
        <KeyValueRow label="Model" labelTone="muted" value={deviceInfo.deviceModel || '—'} />
        <KeyValueRow
          label="Firmware"
          labelTone="muted"
          mono
          valueClassName="text-cs-accent"
          value={fmtFirmware(deviceInfo.firmwareVersion, deviceInfo.firmwareVerCode)}
        />
        <KeyValueRow label="Build" labelTone="muted" mono value={deviceInfo.firmwareBuildDate || '—'} />
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="label-caps text-cs-text-muted">Capacity</span>
        <CapacityRow
          label="Contacts"
          used={contactCount}
          max={maxContacts}
          value={`${contactCount} / ${maxContacts || '—'}`}
          warn={contactsFull}
        />
        <CapacityRow
          label="Channels"
          used={channelCount}
          max={maxChannels}
          value={`${channelCount} / ${maxChannels || '—'}`}
        />
        <CapacityRow
          label="Storage"
          used={deviceInfo.storageUsedKb}
          max={storageTotal}
          value={storageTotal > 0 ? `${fmtStorageKb(deviceInfo.storageUsedKb)} / ${fmtStorageKb(storageTotal)}` : '—'}
        />
      </div>

      {contactsFull && (
        <div
          role="status"
          className="flex items-start gap-2 rounded-md border border-cs-warn/40 bg-cs-warn/10 px-2.5 py-2 text-[12px] text-cs-text"
        >
          <TriangleAlert aria-hidden="true" className="mt-px size-3.5 shrink-0 text-cs-warn" />
          <span className="flex-1">Contacts full — new adverts won't be added.</span>
          <CardLink onClick={() => setActiveKey('tool:contacts')}>Manage</CardLink>
        </div>
      )}
    </NodeCard>
  );
}
