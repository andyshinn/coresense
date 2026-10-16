import { MapIcon, MapPinOff } from 'lucide-react';
import { useEffect } from 'react';
import { ErrorBoundary } from 'react-error-boundary';
import { type Contact, hasValidFix } from '../../../shared/types';
import { logError, MapErrorFallback } from '../../components/errors/ErrorFallback';
import { MapCanvas } from '../../components/map/MapCanvas';
import { NeighbourMapLayer } from '../../components/map/NeighbourMapLayer';
import { useNeighbourView } from '../../hooks/useNeighbourView';
import { useApiClient } from '../../lib/apiClientContext';
import { useStore } from '../../lib/store';

interface Props {
  contact: Contact;
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
export function NeighboursTab({ contact }: Props) {
  const client = useApiClient();
  const manifest = useStore((s) => s.mapManifest);
  const settings = useStore((s) => s.mapSettings);
  const setNeighboursFor = useStore((s) => s.setNeighboursFor);
  const setNeighbourSelected = useStore((s) => s.setNeighbourSelected);
  const setNeighbourHovered = useStore((s) => s.setNeighbourHovered);

  // Align the shared slice to this repeater — resets the fetched page + selection
  // when you switch repeaters (sort/count are kept as user preferences).
  useEffect(() => {
    setNeighboursFor(contact.key);
  }, [contact.key, setNeighboursFor]);

  const { nb, selectedId, hoveredId, tilesOk, mapShown, displayed } = useNeighbourView(contact);

  // hasValidFix is restated (mapShown already implies it) so it narrows
  // contact's coords for the map below.
  if (mapShown && client && hasValidFix(contact)) {
    return (
      <ErrorBoundary FallbackComponent={MapErrorFallback} onError={logError}>
        <MapCanvas
          client={client}
          manifest={manifest}
          settings={settings}
          persistViewport={false}
          initialView={{
            center: [contact.gpsLon, contact.gpsLat],
            zoom: 12,
            bearing: 0,
            pitch: 0,
          }}
          renderOverlays={(map) => (
            <NeighbourMapLayer
              map={map}
              focal={{
                lat: contact.gpsLat,
                lon: contact.gpsLon,
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
