import maplibregl, { type Map as MapLibreMap } from 'maplibre-gl';
import { useEffect, useMemo, useRef } from 'react';
import { type Contact, hasValidFix } from '../../../shared/types';
import { useStore } from '../../lib/store';
import type { CachedMarker } from './cluster/markerCache';
import {
  buildSpiderCenterElement,
  SPIDERFY_CIRCLE_PADDING_PX,
  SPIDERFY_LEADER_LAYER,
  SPIDERFY_LEADER_SOURCE,
  setLeaderLines,
  spiderfyOffsets,
} from './cluster/spiderfy';
import { upsertDomMarker } from './cluster/upsertDomMarker';
import { upsertContactLikeMarker } from './cluster/upsertMarker';
import { buildCoLocatedSiteMarker } from './markers/CoLocatedSite';
import {
  buildClusterIndex,
  type ClusterFeatureProps,
  type GroupedItem,
  groupByColocation,
  type PointFeatureProps,
} from './markers/cluster';
import { buildClusterMarker } from './markers/clusterDonut';

interface Props {
  map: MapLibreMap | null;
}

const HOUR_MS = 3_600_000;
const RECOMPUTE_DEBOUNCE_MS = 80;

// Replaces the old MapMarkers component. Responsible for:
//   1. Filtering contacts by per-kind toggles, favourites, last-heard cutoff.
//   2. Grouping contacts that share a precise location into a co-located site.
//   3. Running Supercluster at the current viewport so we render donut clusters
//      when zoomed out instead of overlapping pins.
//   4. Diffing the resulting marker set against the live DOM so we don't tear
//      down markers on every store tick.
export function MapClusters({ map }: Props) {
  const contacts = useStore((s) => s.contacts);
  const settings = useStore((s) => s.mapSettings);
  const selectedContactKey = useStore((s) => s.ui.selectedContactKey);
  const selectedSiteKey = useStore((s) => s.ui.selectedSiteKey);
  const setSelectedContact = useStore((s) => s.setSelectedContact);
  const setSelectedSite = useStore((s) => s.setSelectedSite);

  const cacheRef = useRef<Map<string, CachedMarker>>(new Map());
  const recomputeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // The pre-clustered grouped items don't change with the viewport — only the
  // Supercluster query does. Memo so we don't re-walk the contact list on
  // every pan.
  const groupedItems = useMemo(() => {
    const now = Date.now();
    const cutoff =
      settings.lastHeardHours > 0 ? settings.lastHeardHours * HOUR_MS : Number.POSITIVE_INFINITY;
    const filtered = contacts.filter((c) => {
      if (!hasValidFix(c)) return false;
      if (!settings.kindFilters[c.kind]) return false;
      if (settings.favouritesOnly && !c.pinned) return false;
      if (!settings.staleFadeEnabled) {
        // Stale fade off → hide anything older than the cutoff.
        if (typeof c.lastSeenMs === 'number' && now - c.lastSeenMs > cutoff) return false;
      }
      return true;
    });
    return groupByColocation(filtered, settings.coLocationMeters);
  }, [
    contacts,
    settings.kindFilters,
    settings.favouritesOnly,
    settings.lastHeardHours,
    settings.staleFadeEnabled,
    settings.coLocationMeters,
  ]);

  // Build/refresh the Supercluster index whenever the grouped items change.
  // The index is stateless w.r.t. viewport — we query it per render below.
  const index = useMemo(() => {
    if (!settings.clusteringEnabled) return null;
    return buildClusterIndex(groupedItems);
  }, [groupedItems, settings.clusteringEnabled]);

  // Render the markers. Wrapped in a ref so the map move handler can re-fire
  // it without taking React state as a dependency (which would force the
  // closure to capture stale settings/contacts on every move).
  const renderRef = useRef<() => void>(() => {});

  renderRef.current = () => {
    if (!map) return;
    const cache = cacheRef.current;
    const wanted = new Set<string>();

    const now = Date.now();
    const cutoffMs =
      settings.lastHeardHours > 0 ? settings.lastHeardHours * HOUR_MS : Number.POSITIVE_INFINITY;

    const contactState = (c: Contact, selected: boolean) => {
      const stale = typeof c.lastSeenMs === 'number' && now - c.lastSeenMs > cutoffMs;
      return {
        selected,
        faded: stale && settings.staleFadeEnabled,
        stale,
        showLabel: settings.showMarkerLabels,
      };
    };

    const upsertContactMarker = (
      item: Extract<GroupedItem, { kind: 'single' }>,
      siteSelected = false,
    ) => {
      const c = item.contact;
      upsertContactLikeMarker({
        map,
        cache,
        wanted,
        cacheKey: c.key,
        signaturePrefix: 'contact',
        contact: c,
        position: [item.lng, item.lat],
        state: contactState(c, !siteSelected && c.key === selectedContactKey),
        onClick: (e) => {
          e.stopPropagation();
          setSelectedContact(c.key);
        },
      });
    };

    const upsertSiteMarker = (site: GroupedItem & { kind: 'site' }) => {
      // When the site is selected, skip the chip row — its members are
      // rendered as individual spiderfied markers below.
      if (site.site.key === selectedSiteKey) return;
      const signature = `site:${site.site.members.length}`;
      wanted.add(site.site.key);
      const existing = cache.get(site.site.key);
      if (existing) {
        existing.marker.setLngLat([site.site.centroid.lng, site.site.centroid.lat]);
        if (existing.signature !== signature) {
          existing.signature = signature;
        }
        return;
      }
      const el = buildCoLocatedSiteMarker(site.site, false);
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        setSelectedSite(site.site.key);
      });
      const marker = new maplibregl.Marker({ element: el, anchor: 'bottom' })
        .setLngLat([site.site.centroid.lng, site.site.centroid.lat])
        .addTo(map);
      cache.set(site.site.key, { marker, signature, kind: null });
    };

    // One spiderfied member marker. Custom cache key so multiple members of
    // the same site don't fight over a single contact-key cache slot, and so
    // collapsing the spiderfy reliably removes them on the next render.
    const upsertSpiderMember = (siteKey: string, c: Contact, lngLat: [number, number]) => {
      upsertContactLikeMarker({
        map,
        cache,
        wanted,
        cacheKey: `spider:${siteKey}:${c.key}`,
        signaturePrefix: 'spider',
        contact: c,
        position: lngLat,
        state: contactState(c, c.key === selectedContactKey),
        // Marker class for the scrim: spider members must sit ABOVE the bounding
        // disc (which covers surrounding non-member nodes) so they remain visible.
        elementClass: 'cs-map-marker--spider',
        onClick: (e) => {
          e.stopPropagation();
          // Highlight this member without collapsing the spiderfy — the user
          // is still inspecting this site, just zooming in on one node. The
          // first empty-map click below will then clear the contact (returning
          // to the site card); a second clears the site (collapsing spiderfy).
          setSelectedContact(c.key, { keepSite: true });
        },
      });
    };

    // Big bounding disc, DOM-positioned at the centroid. Sized in CSS px so
    // the spread feels the same at every zoom; sits above other HTML markers
    // (z-index in CSS) so it visually scrims surrounding nodes — pointer-events
    // none so clicks pass through to the canvas (empty-map handler dismisses).
    const upsertSpiderDisc = (
      siteKey: string,
      centroid: { lng: number; lat: number },
      diameterPx: number,
    ) => {
      upsertDomMarker({
        map,
        cache,
        wanted,
        cacheKey: `spider-disc:${siteKey}`,
        signature: `disc:${Math.round(diameterPx)}`,
        position: [centroid.lng, centroid.lat],
        build: () => {
          const el = document.createElement('div');
          el.className = 'cs-map-spider-disc';
          el.style.width = `${diameterPx}px`;
          el.style.height = `${diameterPx}px`;
          return el;
        },
        onSignatureChange: (el) => {
          el.style.width = `${diameterPx}px`;
          el.style.height = `${diameterPx}px`;
        },
      });
    };

    // Small amber centroid dot, mirroring the chip-row's anchor dot so the
    // visual language is continuous when the row expands into the spread.
    const upsertSpiderCenter = (siteKey: string, centroid: { lng: number; lat: number }) => {
      upsertDomMarker({
        map,
        cache,
        wanted,
        cacheKey: `spider-center:${siteKey}`,
        signature: 'center:v1',
        position: [centroid.lng, centroid.lat],
        build: buildSpiderCenterElement,
      });
    };

    if (!index) {
      // No clustering — render every grouped item as its own marker.
      for (const item of groupedItems) {
        if (item.kind === 'single') upsertContactMarker(item);
        else upsertSiteMarker(item);
      }
    } else {
      const bounds = map.getBounds();
      const zoom = Math.round(map.getZoom());
      const features = index.getClusters(
        [bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()],
        zoom,
      ) as Array<GeoJSON.Feature<GeoJSON.Point, ClusterFeatureProps | PointFeatureProps>>;

      for (const f of features) {
        const props = f.properties;
        const [lng, lat] = f.geometry.coordinates;
        if (props.cluster) {
          const key = `cluster:${props.cluster_id}`;
          const total = props.point_count;
          const signature = `cluster:${total}:${Object.values(props.breakdown).join(',')}`;
          wanted.add(key);
          const existing = cache.get(key);
          if (existing) {
            existing.marker.setLngLat([lng, lat]);
            if (existing.signature !== signature) {
              existing.marker.getElement().innerHTML = buildClusterMarker(
                props.cluster_id,
                props.breakdown,
                total,
              ).innerHTML;
              existing.signature = signature;
            }
            continue;
          }
          const el = buildClusterMarker(props.cluster_id, props.breakdown, total);
          el.addEventListener('click', (e) => {
            e.stopPropagation();
            const expansionZoom = Math.min(index.getClusterExpansionZoom(props.cluster_id), 22);
            map.easeTo({
              center: [lng, lat],
              zoom: Math.max(map.getZoom() + 0.5, expansionZoom + 0.5),
              duration: 350,
            });
          });
          const marker = new maplibregl.Marker({ element: el, anchor: 'center' })
            .setLngLat([lng, lat])
            .addTo(map);
          cache.set(key, { marker, signature, kind: null });
        } else {
          const item = props.item;
          if (item.kind === 'single') upsertContactMarker(item);
          else upsertSiteMarker(item);
        }
      }
    }

    // Spiderfy pass — if a site is selected, fan its members out around the
    // centroid in pixel space so each can be clicked individually. Runs after
    // the cluster/site pass so spiderfied markers sit on top.
    const leaderFeatures: GeoJSON.Feature<GeoJSON.LineString>[] = [];
    if (selectedSiteKey) {
      const selected = groupedItems.find(
        (it): it is Extract<GroupedItem, { kind: 'site' }> =>
          it.kind === 'site' && it.site.key === selectedSiteKey,
      );
      if (selected) {
        const { centroid, members } = selected.site;
        const centroidPx = map.project([centroid.lng, centroid.lat]);
        const offsets = spiderfyOffsets(members.length);
        let maxOffset = 0;
        for (let i = 0; i < members.length; i++) {
          const m = members[i];
          const o = offsets[i];
          if (!m || !o) continue;
          const memberLngLat = map.unproject([centroidPx.x + o.x, centroidPx.y + o.y]);
          const ll: [number, number] = [memberLngLat.lng, memberLngLat.lat];
          upsertSpiderMember(selected.site.key, m, ll);
          leaderFeatures.push({
            type: 'Feature',
            properties: {},
            geometry: {
              type: 'LineString',
              coordinates: [[centroid.lng, centroid.lat], ll],
            },
          });
          const dist = Math.hypot(o.x, o.y);
          if (dist > maxOffset) maxOffset = dist;
        }
        // Bounding disc + centroid dot — rendered as DOM markers so they sit
        // above other map markers (the disc visually scrims surrounding nodes
        // so the spiderfied set is easy to read in isolation). Only render
        // when there's an actual spread (≥2 members).
        if (members.length >= 2) {
          const discPx = (maxOffset + SPIDERFY_CIRCLE_PADDING_PX) * 2;
          upsertSpiderDisc(selected.site.key, centroid, discPx);
          upsertSpiderCenter(selected.site.key, centroid);
        }
      }
    }
    setLeaderLines(map, leaderFeatures);

    // Remove markers that are no longer in the wanted set.
    for (const [key, entry] of cache) {
      if (!wanted.has(key)) {
        entry.marker.remove();
        cache.delete(key);
      }
    }
  };

  // Re-render when inputs change (state-driven path). The body only touches
  // `map` and `renderRef`; the rest of the deps are intentional re-render
  // triggers — when any of them changes, the renderRef closure (rewritten on
  // every render above) needs to fire so the markers reflect the new state.
  // biome-ignore lint/correctness/useExhaustiveDependencies: triggers, not direct reads
  useEffect(() => {
    if (!map) return;
    renderRef.current();
  }, [
    map,
    groupedItems,
    index,
    selectedContactKey,
    selectedSiteKey,
    settings.showMarkerLabels,
    settings.staleFadeEnabled,
    settings.lastHeardHours,
  ]);

  // Install the spiderfy support layers once the style is loaded. Order
  // matters — `addLayer` stacks bottom-up, so:
  //   1. anchor circle (soft teal halo bounding the group)
  //   2. leader lines (amber, drawn on top of the halo)
  //   3. HTML markers (always above the canvas; nothing to install)
  // We keep both sources present always (empty when no spiderfy is active) so
  // the render pass can `setData` without race-checking layer existence.
  useEffect(() => {
    if (!map) return;
    const install = () => {
      // addSource/addLayer can throw if the style isn't quite ready (e.g.
      // first paint hasn't happened). Caller fires this on every styledata
      // so a transient failure just retries on the next event.
      try {
        installLayers();
      } catch {
        // Style not ready yet; the next styledata will re-attempt.
      }
    };
    const installLayers = () => {
      if (!map.getSource(SPIDERFY_LEADER_SOURCE)) {
        map.addSource(SPIDERFY_LEADER_SOURCE, {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: [] },
        });
      }
      if (!map.getLayer(SPIDERFY_LEADER_LAYER)) {
        map.addLayer({
          id: SPIDERFY_LEADER_LAYER,
          type: 'line',
          source: SPIDERFY_LEADER_SOURCE,
          paint: {
            'line-color': '#f59e0b',
            'line-width': 1.25,
            'line-opacity': 0.95,
          },
        });
      }
      // Anything that called setLeaderLines/setAnchorCircle before the sources
      // existed silently bailed. Re-fire the render so the freshly-created
      // sources get their data on this same frame.
      renderRef.current();
    };
    // Try install on every styledata. addSource/addLayer throw if the style
    // isn't ready yet — catch and try again next event. Once the sources
    // exist the guard checks short-circuit so subsequent calls are O(1).
    // This also handles re-install after `map.setStyle(...)` (theme change /
    // light-basemap toggle) since that wipes our layers and refires styledata.
    install();
    map.on('styledata', install);
    return () => {
      map.off('styledata', install);
    };
  }, [map]);

  // Re-render on map movement so cluster aggregation tracks the viewport.
  // We also fire continuously (no debounce) while a site is spiderfied so the
  // members stay anchored relative to the centroid throughout a zoom animation
  // — otherwise the spread visibly drifts until the gesture settles. The live
  // handler reads `selectedSiteKey` from the store on each tick so it stays
  // current without rebinding listeners.
  useEffect(() => {
    if (!map) return;
    const schedule = () => {
      if (recomputeTimer.current) clearTimeout(recomputeTimer.current);
      recomputeTimer.current = setTimeout(() => {
        recomputeTimer.current = null;
        renderRef.current();
      }, RECOMPUTE_DEBOUNCE_MS);
    };
    const live = () => {
      // Only do the expensive re-render mid-gesture when something is
      // spiderfied; otherwise the debounced path is enough.
      if (useStore.getState().ui.selectedSiteKey) renderRef.current();
    };
    map.on('moveend', schedule);
    map.on('zoomend', schedule);
    map.on('move', live);
    map.on('zoom', live);
    return () => {
      if (recomputeTimer.current) clearTimeout(recomputeTimer.current);
      map.off('moveend', schedule);
      map.off('zoomend', schedule);
      map.off('move', live);
      map.off('zoom', live);
    };
  }, [map]);

  // Clear selection on empty-space clicks so the rail returns to controls.
  useEffect(() => {
    if (!map) return;
    const onClick = () => {
      const ui = useStore.getState().ui;
      if (ui.selectedContactKey) setSelectedContact(null);
      else if (ui.selectedSiteKey) setSelectedSite(null);
    };
    map.on('click', onClick);
    return () => {
      map.off('click', onClick);
    };
  }, [map, setSelectedContact, setSelectedSite]);

  // Tear down all markers on unmount.
  useEffect(() => {
    const cache = cacheRef.current;
    return () => {
      for (const entry of cache.values()) entry.marker.remove();
      cache.clear();
    };
  }, []);

  return null;
}
