import { useMemo } from 'react';
import type { ApiClient } from '../../lib/api';
import { useStore } from '../../lib/store';
import { ControlsCard } from './ControlsCard';
import { MapLegend } from './MapLegend';
import { NodeInfoCard } from './NodeInfoCard';
import { SiteInfoCard } from './SiteInfoCard';

interface Props {
  client: ApiClient | null;
}

// Right-rail content for the Map view. Three modes:
//   * Controls (default) — search, filters, sliders, layer toggles.
//   * Node card — when the user selects a single contact marker.
//   * Site card — when the user selects a co-located group marker.
// The legend is sticky to the bottom across all modes.
export function MapDetailsRail({ client }: Props) {
  const contacts = useStore((s) => s.contacts);
  const selectedContactKey = useStore((s) => s.ui.selectedContactKey);
  const selectedSiteKey = useStore((s) => s.ui.selectedSiteKey);

  const selectedContact = useMemo(
    () =>
      selectedContactKey ? (contacts.find((c) => c.key === selectedContactKey) ?? null) : null,
    [contacts, selectedContactKey],
  );

  // Site keys are built as `site:k1|k2|…` (see cluster.ts). Recover the member
  // list by splitting on the delimiter so we don't need a second store field.
  const selectedSite = useMemo(() => {
    if (!selectedSiteKey) return null;
    const raw = selectedSiteKey.startsWith('site:') ? selectedSiteKey.slice(5) : selectedSiteKey;
    const memberKeys = raw.split('|');
    const members = memberKeys
      .map((k) => contacts.find((c) => c.key === k))
      .filter((c): c is NonNullable<typeof c> => Boolean(c));
    if (members.length < 2) return null;
    return { key: selectedSiteKey, members };
  }, [contacts, selectedSiteKey]);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex-1 overflow-y-auto">
        {selectedContact ? (
          <NodeInfoCard contact={selectedContact} client={client} />
        ) : selectedSite ? (
          <SiteInfoCard site={selectedSite} client={client} />
        ) : (
          <ControlsCard client={client} />
        )}
      </div>
      <MapLegend />
    </div>
  );
}
