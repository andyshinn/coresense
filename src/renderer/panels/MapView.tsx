import { MapIcon } from 'lucide-react';
import { ErrorBoundary } from 'react-error-boundary';
import { logError, MapErrorFallback } from '../components/errors/ErrorFallback';
import { MapCanvas } from '../components/map/MapCanvas';
import type { ApiClient } from '../lib/api';
import { useStore } from '../lib/store';

interface MapViewProps {
  client: ApiClient | null;
}

export function MapView({ client }: MapViewProps) {
  const manifest = useStore((s) => s.mapManifest);
  const settings = useStore((s) => s.mapSettings);

  if (manifest.missing) {
    return (
      <div className="flex h-full w-full items-center justify-center p-8">
        <div className="max-w-lg space-y-4 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-muted">
            <MapIcon className="h-7 w-7 text-muted-foreground" />
          </div>
          <h2 className="text-lg font-semibold">Map tiles not installed</h2>
          <p className="text-sm text-muted-foreground">
            The bundled basemap and terrain extracts aren't present in this build. Drop{' '}
            <code className="rounded bg-muted px-1 py-0.5 text-xs">basemap.pmtiles</code> and{' '}
            <code className="rounded bg-muted px-1 py-0.5 text-xs">terrain.pmtiles</code> into{' '}
            <code className="rounded bg-muted px-1 py-0.5 text-xs">resources/tiles/</code> and relaunch — or run{' '}
            <code className="rounded bg-muted px-1 py-0.5 text-xs">git lfs pull</code> if you cloned without LFS.
          </p>
          <p className="text-xs text-muted-foreground">
            See <code className="rounded bg-muted px-1 py-0.5 text-xs">scripts/build-tiles.md</code> for instructions on
            generating your own extracts with <code className="rounded bg-muted px-1 py-0.5 text-xs">pmtiles extract</code>.
          </p>
        </div>
      </div>
    );
  }

  if (!manifest.basemap) {
    return (
      <div className="flex h-full w-full items-center justify-center p-8">
        <p className="text-sm text-muted-foreground">Basemap extract is missing; only terrain is loaded.</p>
      </div>
    );
  }
  if (!client) {
    return (
      <div className="flex h-full w-full items-center justify-center p-8">
        <p className="text-sm text-muted-foreground">Waiting for API client…</p>
      </div>
    );
  }

  return (
    <ErrorBoundary FallbackComponent={MapErrorFallback} onError={logError}>
      <MapCanvas client={client} manifest={manifest} settings={settings} />
    </ErrorBoundary>
  );
}
