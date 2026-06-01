import { MapIcon, MapPinOff } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { ErrorBoundary } from 'react-error-boundary';
import type { Contact, RepeaterNeighboursPage } from '../../../shared/types';
import { hasValidFix } from '../../../shared/types';
import { logError, MapErrorFallback } from '../../components/errors/ErrorFallback';
import { MapCanvas } from '../../components/map/MapCanvas';
import { NeighbourMapLayer } from '../../components/map/NeighbourMapLayer';
import { type ApiClient, api } from '../../lib/api';
import { type NeighbourSortKey, resolveNeighbours, sortNeighbours } from '../../lib/neighbours';
import { notify } from '../../lib/notify';
import { useStore } from '../../lib/store';
import { NeighbourList } from './neighbours/NeighbourList';

interface Props {
  contact: Contact;
  client: ApiClient | null;
}

// Client Order key -> firmware orderBy byte for the fetch window
// (0=newest, 1=oldest, 2=strongest SNR, 3=weakest). 'name' has no firmware
// equivalent, so fetch the strongest window.
const ORDER_BY_FOR_SORT: Record<NeighbourSortKey, number> = {
  'snr-desc': 2,
  'snr-asc': 3,
  recent: 0,
  oldest: 1,
  name: 2,
};

function MapPlaceholder({ icon, text }: { icon: 'no-gps' | 'no-tiles'; text: string }) {
  const Icon = icon === 'no-gps' ? MapPinOff : MapIcon;
  return (
    <div className="flex h-full w-full items-center justify-center bg-cs-bg p-8">
      <div className="flex flex-col items-center gap-2 text-center">
        <Icon className="h-7 w-7 text-cs-text-dim" aria-hidden="true" />
        <p className="max-w-xs text-sm text-cs-text-muted">{text}</p>
      </div>
    </div>
  );
}

export function NeighboursTab({ contact, client }: Props) {
  const contacts = useStore((s) => s.contacts);
  const discovered = useStore((s) => s.discovered);
  const manifest = useStore((s) => s.mapManifest);
  const settings = useStore((s) => s.mapSettings);

  const [page, setPage] = useState<RepeaterNeighboursPage | null>(null);
  const [sortKey, setSortKey] = useState<NeighbourSortKey>('snr-desc');
  const [count, setCount] = useState(16);
  const [busy, setBusy] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  // Switching to a different repeater must not show the previous repeater's
  // neighbours/selection under the new name. Clear fetched data + selection on
  // contact change (sortKey/count are user preferences and intentionally kept).
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset only on contact change
  useEffect(() => {
    setPage(null);
    setSelectedId(null);
    setHoveredId(null);
  }, [contact.key]);

  const focalLocated = hasValidFix(contact);
  const tilesOk = !manifest.missing && !!manifest.basemap;
  const mapShown = focalLocated && tilesOk && !!client;

  // Resolve -> sort -> count-slice. Map and list share the same displayed set.
  const displayed = useMemo(() => {
    if (!page) return [];
    const resolved = resolveNeighbours(page.neighbours, contacts, discovered);
    return sortNeighbours(resolved, sortKey).slice(0, count);
  }, [page, contacts, discovered, sortKey, count]);

  const load = async () => {
    if (!client || busy) return;
    setBusy(true);
    try {
      const res = await api.repeaterNeighbours(client, contact.key, {
        count,
        orderBy: ORDER_BY_FOR_SORT[sortKey],
        prefixLen: 6,
      });
      setPage(res.page);
    } catch (err) {
      notify.error(`Neighbours fetch failed: ${(err as Error).message}`, err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-full min-h-0">
      {/* Map (hero) */}
      <div className="relative min-w-0 flex-1">
        {mapShown && client ? (
          <ErrorBoundary FallbackComponent={MapErrorFallback} onError={logError}>
            <MapCanvas
              client={client}
              manifest={manifest}
              settings={settings}
              persistViewport={false}
              initialView={{
                center: [contact.gpsLon as number, contact.gpsLat as number],
                zoom: 12,
                bearing: 0,
                pitch: 0,
              }}
              renderOverlays={(map) => (
                <NeighbourMapLayer
                  map={map}
                  focal={{
                    lat: contact.gpsLat as number,
                    lon: contact.gpsLon as number,
                    name: contact.name,
                  }}
                  neighbours={displayed}
                  selectedId={selectedId}
                  hoveredId={hoveredId}
                  onHover={setHoveredId}
                  onSelect={setSelectedId}
                />
              )}
            />
          </ErrorBoundary>
        ) : !client ? (
          <MapPlaceholder icon="no-gps" text="Waiting for radio connection…" />
        ) : !tilesOk ? (
          <MapPlaceholder
            icon="no-tiles"
            text="Map tiles not installed — the neighbour list is still available."
          />
        ) : (
          <MapPlaceholder
            icon="no-gps"
            text="No location for this repeater. Neighbours are listed on the right; none can be plotted."
          />
        )}
      </div>

      {/* List */}
      <NeighbourList
        neighbours={displayed}
        total={page?.total ?? 0}
        mapShown={mapShown}
        sortKey={sortKey}
        count={count}
        busy={busy}
        hasFetched={page !== null}
        onSort={setSortKey}
        onCount={setCount}
        onFetch={load}
        selectedId={selectedId}
        hoveredId={hoveredId}
        onHover={setHoveredId}
        onSelect={setSelectedId}
      />
    </div>
  );
}
