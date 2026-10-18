import type { Contact } from '../../../../shared/types';
import { useNeighbourView } from '../../../hooks/useNeighbourView';
import { api } from '../../../lib/api';
import { useApiClient } from '../../../lib/apiClientContext';
import type { NeighbourSortKey } from '../../../lib/neighbours';
import { notify } from '../../../lib/notify';
import { useStore } from '../../../lib/store';
import { NeighbourList } from './NeighbourList';

// Client Order key -> firmware orderBy byte for the fetch window
// (0=newest, 1=oldest, 2=strongest SNR, 3=weakest). 'name' has no firmware
// equivalent, so fetch the strongest window and re-sort client-side.
const ORDER_BY_FOR_SORT: Record<NeighbourSortKey, number> = {
  'snr-desc': 2,
  'snr-asc': 3,
  recent: 0,
  oldest: 1,
  name: 2,
};

/** Right-rail body for the repeater Neighbours tab: the Order/Count/Fetch
 *  controls + the resolved neighbour list. Reads the shared `neighbours` store
 *  slice so it stays in sync with the map in the main pane (hover/selection
 *  couple across both). The map (NeighboursTab) owns resetting the slice when
 *  the focal repeater changes; this body only reads + fetches. */
export function NeighboursRailBody({ contact }: { contact: Contact }) {
  const client = useApiClient();
  const setNeighboursSort = useStore((s) => s.setNeighboursSort);
  const setNeighboursCount = useStore((s) => s.setNeighboursCount);
  const setNeighboursBusy = useStore((s) => s.setNeighboursBusy);
  const setNeighboursPage = useStore((s) => s.setNeighboursPage);
  const setNeighbourSelected = useStore((s) => s.setNeighbourSelected);
  const setNeighbourHovered = useStore((s) => s.setNeighbourHovered);
  const setNeighboursShowNames = useStore((s) => s.setNeighboursShowNames);

  // mapShown is the main pane's verdict; the list uses it to decide on-map grouping.
  const { nb, page, selectedId, hoveredId, mapShown, displayed } = useNeighbourView(contact);

  const doFetch = async () => {
    if (!client || nb.busy) return;
    setNeighboursBusy(true);
    try {
      const res = await api.repeaterNeighbours(client, contact.key, {
        count: nb.count,
        orderBy: ORDER_BY_FOR_SORT[nb.sortKey],
        prefixLen: 6,
      });
      setNeighboursPage(res.page, contact.key);
    } catch (err) {
      notify.failure('Neighbours fetch', err);
    } finally {
      setNeighboursBusy(false);
    }
  };

  return (
    <NeighbourList
      neighbours={displayed}
      total={page?.total ?? 0}
      mapShown={mapShown}
      sortKey={nb.sortKey}
      count={nb.count}
      busy={nb.busy}
      hasFetched={page !== null}
      onSort={setNeighboursSort}
      onCount={setNeighboursCount}
      onFetch={doFetch}
      showNames={nb.showNames}
      onShowNames={setNeighboursShowNames}
      selectedId={selectedId}
      hoveredId={hoveredId}
      onHover={setNeighbourHovered}
      onSelect={setNeighbourSelected}
    />
  );
}
