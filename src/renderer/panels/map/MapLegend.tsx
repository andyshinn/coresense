import { useMemo } from 'react';
import { hasValidFix } from '../../../shared/types';
import { MARKER_KIND_ORDER, MARKER_TYPES, MarkerShape } from '../../components/map/markers/MarkerShape';
import { useStore } from '../../lib/store';

// Sticky two-column legend at the bottom of the Map rail. Shows the four
// shape/color/type pairs plus a grand total so the user can spot at a glance
// whether the filters above are hiding anything.
export function MapLegend() {
  const contacts = useStore((s) => s.contacts);

  const total = useMemo(() => contacts.filter(hasValidFix).length, [contacts]);

  return (
    <div className="border-t border-cs-border bg-cs-bg px-3 py-2.5">
      <div className="mb-1.5 flex items-center justify-between">
        <span className="font-mono text-[9px] uppercase tracking-wider text-cs-text-dim">Legend</span>
        <span className="font-mono text-[9px] text-cs-text-dim">{total} nodes</span>
      </div>
      <div className="grid grid-cols-2 gap-x-3 gap-y-1">
        {MARKER_KIND_ORDER.map((kind) => (
          <div key={kind} className="flex items-center gap-1.5">
            <MarkerShape type={kind} size={14} />
            <span className="text-[11px] text-cs-text">{MARKER_TYPES[kind].label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
