import { MapIcon, MapPinOff } from 'lucide-react';
import { useEffect, useMemo } from 'react';
import { ErrorBoundary } from 'react-error-boundary';
import type { Contact } from '../../../shared/types';
import { hasValidFix } from '../../../shared/types';
import { logError, MapErrorFallback } from '../../components/errors/ErrorFallback';
import { MapCanvas } from '../../components/map/MapCanvas';
import { NeighbourMapLayer } from '../../components/map/NeighbourMapLayer';
import type { ApiClient } from '../../lib/api';
import { resolveNeighbours, sortNeighbours } from '../../lib/neighbours';
import { useStore } from '../../lib/store';

interface Props {
  contact: Contact;
  client: ApiClient | null;
}

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

/** Neighbours tab body — the map (hero) fills the whole main pane. The
 *  controls + neighbour list live in the right rail (NeighboursRailBody), sharing
 *  state through the `neighbours` store slice. This component owns resetting that
 *  slice when the focal repeater changes. */
export function NeighboursTab({ contact, client }: Props) {
  const contacts = useStore((s) => s.contacts);
  const discovered = useStore((s) => s.discovered);
  const manifest = useStore((s) => s.mapManifest);
  const settings = useStore((s) => s.mapSettings);
  const nb = useStore((s) => s.neighbours);
  const setNeighboursFor = useStore((s) => s.setNeighboursFor);
  const setNeighbourSelected = useStore((s) => s.setNeighbourSelected);
  const setNeighbourHovered = useStore((s) => s.setNeighbourHovered);

  // Align the shared slice to this repeater — resets the fetched page + selection
  // when you switch repeaters (sort/count are kept as user preferences).
  useEffect(() => {
    setNeighboursFor(contact.key);
  }, [contact.key, setNeighboursFor]);

  const isForThis = nb.forKey === contact.key;
  const page = isForThis ? nb.page : null;
  const selectedId = isForThis ? nb.selectedId : null;
  const hoveredId = isForThis ? nb.hoveredId : null;

  const focalLocated = hasValidFix(contact);
  const tilesOk = !manifest.missing && !!manifest.basemap;
  const mapShown = focalLocated && tilesOk && !!client;

  const displayed = useMemo(() => {
    if (!page) return [];
    const resolved = resolveNeighbours(page.neighbours, contacts, discovered);
    return sortNeighbours(resolved, nb.sortKey).slice(0, nb.count);
  }, [page, contacts, discovered, nb.sortKey, nb.count]);

  if (mapShown && client) {
    return (
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
              showNames={nb.showNames}
              onHover={setNeighbourHovered}
              onSelect={setNeighbourSelected}
            />
          )}
        />
      </ErrorBoundary>
    );
  }
  if (!client) {
    return <MapPlaceholder icon="no-gps" text="Waiting for radio connection…" />;
  }
  if (!tilesOk) {
    return <MapPlaceholder icon="no-tiles" text="Map tiles not installed — the neighbour list is in the right rail." />;
  }
  return (
    <MapPlaceholder
      icon="no-gps"
      text="No location for this repeater. Neighbours are listed in the right rail; none can be plotted."
    />
  );
}
