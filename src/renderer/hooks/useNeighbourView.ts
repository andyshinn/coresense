import { useMemo } from 'react';
import { type Contact, hasValidFix } from '../../shared/types';
import type { ApiClient } from '../lib/api';
import { resolveNeighbours, sortNeighbours } from '../lib/neighbours';
import { useStore } from '../lib/store';

/** The repeater Neighbours view as both halves render it: the map in the main
 *  pane (NeighboursTab) and the list in the right rail (NeighboursRailBody).
 *  Both read the shared `neighbours` store slice, so deriving the view here
 *  keeps them in lockstep — same page, selection and hover, the same map-shown
 *  verdict (which the list uses to group rows on/off the map), and the same
 *  resolved, sorted, count-sliced rows. The slice's page and selection belong
 *  to `nb.forKey`; for any other repeater they read as empty. */
export function useNeighbourView(contact: Contact, client: ApiClient | null) {
  const contacts = useStore((s) => s.contacts);
  const discovered = useStore((s) => s.discovered);
  const manifest = useStore((s) => s.mapManifest);
  const nb = useStore((s) => s.neighbours);

  const isForThis = nb.forKey === contact.key;
  const page = isForThis ? nb.page : null;
  const selectedId = isForThis ? nb.selectedId : null;
  const hoveredId = isForThis ? nb.hoveredId : null;

  // The map is shown only when the focal repeater has a fix, tiles are
  // installed and the radio is connected.
  const tilesOk = !manifest.missing && !!manifest.basemap;
  const mapShown = hasValidFix(contact) && tilesOk && !!client;

  const displayed = useMemo(() => {
    if (!page) return [];
    const resolved = resolveNeighbours(page.neighbours, contacts, discovered);
    return sortNeighbours(resolved, nb.sortKey).slice(0, nb.count);
  }, [page, contacts, discovered, nb.sortKey, nb.count]);

  return { nb, page, selectedId, hoveredId, tilesOk, mapShown, displayed };
}
