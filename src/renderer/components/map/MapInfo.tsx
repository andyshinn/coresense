import type { Map as MapLibreMap } from 'maplibre-gl';
import { useEffect, useState } from 'react';

interface Props {
  map: MapLibreMap | null;
}

interface Viewport {
  zoom: number;
  lng: number;
  lat: number;
  bearing: number;
  pitch: number;
}

// Live viewport readout pinned bottom-left. Subscribes to MapLibre's `move`
// event directly so re-renders stay scoped to this component — MapCanvas
// doesn't see them.
export function MapInfo({ map }: Props) {
  const [vp, setVp] = useState<Viewport | null>(null);

  useEffect(() => {
    if (!map) return;
    const update = () => {
      const c = map.getCenter();
      setVp({
        zoom: map.getZoom(),
        lng: c.lng,
        lat: c.lat,
        bearing: map.getBearing(),
        pitch: map.getPitch(),
      });
    };
    update();
    map.on('move', update);
    map.on('zoom', update);
    map.on('rotate', update);
    map.on('pitch', update);
    return () => {
      map.off('move', update);
      map.off('zoom', update);
      map.off('rotate', update);
      map.off('pitch', update);
    };
  }, [map]);

  if (!vp) return null;

  return (
    <div className="pointer-events-none absolute bottom-3 left-3 z-10 rounded-md border bg-background/95 px-2.5 py-1.5 font-mono text-[11px] leading-tight text-muted-foreground shadow-md backdrop-blur">
      <div>
        z <span className="text-foreground">{vp.zoom.toFixed(2)}</span>
        <span className="mx-2 opacity-50">·</span>
        {vp.lat.toFixed(5)}, {vp.lng.toFixed(5)}
      </div>
      <div>
        bearing <span className="text-foreground">{vp.bearing.toFixed(1)}°</span>
        <span className="mx-2 opacity-50">·</span>
        pitch <span className="text-foreground">{vp.pitch.toFixed(1)}°</span>
      </div>
    </div>
  );
}
