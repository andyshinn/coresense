import { Box, Clock, Mountain, Tag } from 'lucide-react';
import type { MapSettings } from '../../../shared/types';
import type { ApiClient } from '../../lib/api';
import { api } from '../../lib/api';
import { useStore } from '../../lib/store';
import { Slider } from '../ui/slider';
import { Switch } from '../ui/switch';

interface MapControlsProps {
  client: ApiClient;
  hasTerrain: boolean;
}

// Overlay panel for live toggles. Mutations are applied optimistically — the
// renderer flips the store immediately so the canvas re-renders, then persists
// to main. Main re-broadcasts via WS, which is a no-op on this client since the
// store already holds the same value.
export function MapControls({ client, hasTerrain }: MapControlsProps) {
  const settings = useStore((s) => s.mapSettings);
  const applyMapSettings = useStore((s) => s.applyMapSettings);

  function persist(next: MapSettings) {
    applyMapSettings(next);
    void api.putMapSettings(client, next);
  }

  return (
    <div className="pointer-events-auto absolute right-3 top-3 z-10 w-60 space-y-2 rounded-md border bg-background/95 p-3 shadow-md backdrop-blur">
      {hasTerrain && (
        <>
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <Mountain className="h-4 w-4 text-muted-foreground" aria-hidden />
              <label htmlFor="map-hillshade-toggle" className="text-sm font-medium">
                Hillshade
              </label>
            </div>
            <Switch
              id="map-hillshade-toggle"
              checked={settings.terrainHillshadeEnabled}
              onCheckedChange={(checked) =>
                persist({ ...settings, terrainHillshadeEnabled: checked })
              }
            />
          </div>
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <Box className="h-4 w-4 text-muted-foreground" aria-hidden />
              <label htmlFor="map-3d-toggle" className="text-sm font-medium">
                3D terrain
              </label>
            </div>
            <Switch
              id="map-3d-toggle"
              checked={settings.terrain3DEnabled}
              onCheckedChange={(checked) => persist({ ...settings, terrain3DEnabled: checked })}
            />
          </div>
        </>
      )}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <Tag className="h-4 w-4 text-muted-foreground" aria-hidden />
          <label htmlFor="map-labels-toggle" className="text-sm font-medium">
            Marker labels
          </label>
        </div>
        <Switch
          id="map-labels-toggle"
          checked={settings.showMarkerLabels}
          onCheckedChange={(checked) => persist({ ...settings, showMarkerLabels: checked })}
        />
      </div>
      <div className="space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4 text-muted-foreground" aria-hidden />
            <label htmlFor="map-stale-slider" className="text-sm font-medium">
              Stale fade
            </label>
          </div>
          <span className="font-mono text-xs text-muted-foreground">
            {settings.staleFadeDays === 0 ? 'Off' : `${settings.staleFadeDays}d`}
          </span>
        </div>
        <Slider
          id="map-stale-slider"
          min={0}
          max={30}
          step={1}
          value={[settings.staleFadeDays]}
          onValueChange={([v]) => persist({ ...settings, staleFadeDays: v ?? 0 })}
        />
      </div>
    </div>
  );
}
