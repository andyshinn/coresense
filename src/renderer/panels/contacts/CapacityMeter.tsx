import { useStore } from '../../lib/store';

export function CapacityMeter() {
  const onRadio = useStore((s) => s.contacts.length);
  const max = useStore((s) => s.deviceInfo.maxContacts);
  const pct = max > 0 ? Math.min(100, Math.round((onRadio / max) * 100)) : 0;
  const warn = pct >= 90;
  return (
    <div className="flex items-center gap-2" title="Contacts committed to the radio's store">
      <div className="text-right">
        <div className="font-mono text-[11px] tabular-nums">
          <span className={warn ? 'text-cs-warn' : 'text-cs-accent'}>{onRadio}</span>
          <span className="text-cs-text-dim"> / {max || '—'}</span>
        </div>
      </div>
      <div className="h-1.5 w-14 overflow-hidden rounded-full border border-cs-border bg-cs-bg-3">
        <div
          className={`h-full ${warn ? 'bg-cs-warn' : 'bg-cs-accent'}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
