import { X } from 'lucide-react';
import { type Contact, hasValidFix } from '../../../shared/types';
import { MARKER_TYPES, MarkerShape } from '../../components/map/markers/MarkerShape';
import { Button } from '../../components/ui/button';
import { publish as publishMapBus } from '../../lib/map/bus';
import { useStore } from '../../lib/store';
import { fmtRelative } from '../../lib/time';

interface Props {
  site: { key: string; members: Contact[] };
  client: unknown; // unused; preserved for parity with NodeInfoCard's call-site
}

// Card shown when a co-located site marker (≥2 contacts within the
// `coLocationMeters` threshold) is selected. Lists every member with its
// shape badge and last-heard, plus a single "Trace paths" action that flies
// the camera to the site centroid.
export function SiteInfoCard({ site }: Props) {
  const setSelectedSite = useStore((s) => s.setSelectedSite);
  const coLocationMeters = useStore((s) => s.mapSettings.coLocationMeters);

  const centroid = computeCentroid(site.members);

  return (
    <div className="border-b border-cs-border px-3 pb-3 pt-3">
      <div className="mb-2 flex items-start gap-2.5">
        <div className="flex h-6 w-6 items-center justify-center rounded border border-cs-border bg-cs-bg-3 font-mono text-[10px] text-cs-text">
          {site.members.length}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold leading-tight text-cs-text">Co-located site</div>
          <div className="mt-0.5 font-mono text-[10px] uppercase tracking-wider text-cs-text-dim">
            {site.members.length} nodes · within {coLocationMeters} m
          </div>
        </div>
        <button
          type="button"
          onClick={() => setSelectedSite(null)}
          aria-label="Close"
          className="rounded p-0.5 text-cs-text-dim hover:bg-cs-bg-3 hover:text-cs-text"
        >
          <X size={12} />
        </button>
      </div>

      <ul className="space-y-1 border-t border-cs-border pt-2">
        {site.members.map((m) => (
          <li key={m.key}>
            <button
              type="button"
              onClick={() => useStore.getState().setSelectedContact(m.key)}
              className="flex w-full items-center gap-2 rounded px-1 py-1 text-left text-xs hover:bg-cs-bg-3"
            >
              <MarkerShape type={m.kind} size={16} />
              <span className="min-w-0 flex-1 truncate">{m.name}</span>
              <span className="font-mono text-[10px] text-cs-text-dim">{MARKER_TYPES[m.kind].label}</span>
              {m.lastSeenMs ? (
                <span className="font-mono text-[10px] text-cs-text-dim">{fmtRelative(m.lastSeenMs)}</span>
              ) : null}
            </button>
          </li>
        ))}
      </ul>

      <div className="mt-3">
        <Button
          size="sm"
          variant="outline"
          className="w-full"
          onClick={() => {
            if (centroid) {
              publishMapBus({ kind: 'flyTo', lng: centroid.lng, lat: centroid.lat, zoom: 16 });
            }
          }}
        >
          Trace paths
        </Button>
      </div>
    </div>
  );
}

function computeCentroid(members: Contact[]): { lng: number; lat: number } | null {
  const fixes = members.filter(hasValidFix);
  if (!fixes.length) return null;
  const lng = fixes.reduce((s, c) => s + c.gpsLon, 0) / fixes.length;
  const lat = fixes.reduce((s, c) => s + c.gpsLat, 0) / fixes.length;
  return { lng, lat };
}
