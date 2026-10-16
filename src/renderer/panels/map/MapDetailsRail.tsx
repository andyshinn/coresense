import { useMemo } from 'react';
import { parseSiteKey } from '../../components/map/markers/cluster';
import { useStore } from '../../lib/store';
import { ControlsCard } from './ControlsCard';
import { MapLegend } from './MapLegend';
import { NodeInfoCard } from './NodeInfoCard';
import { SiteInfoCard } from './SiteInfoCard';

// Right-rail content for the Map view. Three modes:
//   * Controls (default) — search, filters, sliders, layer toggles.
//   * Node card — when the user selects a single contact marker.
//   * Site card — when the user selects a co-located group marker.
// The legend is sticky to the bottom across all modes.
export function MapDetailsRail() {
  const contacts = useStore((s) => s.contacts);
  const selectedContactKey = useStore((s) => s.ui.selectedContactKey);
  const selectedSiteKey = useStore((s) => s.ui.selectedSiteKey);

  const selectedContact = useMemo(
    () => (selectedContactKey ? (contacts.find((c) => c.key === selectedContactKey) ?? null) : null),
    [contacts, selectedContactKey],
  );

  // A site key encodes its member keys, so recover the member list from it
  // rather than keeping a second store field.
  const selectedSite = useMemo(() => {
    if (!selectedSiteKey) return null;
    const members = parseSiteKey(selectedSiteKey)
      .map((k) => contacts.find((c) => c.key === k))
      .filter((c): c is NonNullable<typeof c> => Boolean(c));
    if (members.length < 2) return null;
    return { key: selectedSiteKey, members };
  }, [contacts, selectedSiteKey]);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex-1 overflow-y-auto">
        {selectedContact ? (
          <NodeInfoCard contact={selectedContact} />
        ) : selectedSite ? (
          <SiteInfoCard site={selectedSite} />
        ) : (
          <ControlsCard />
        )}
      </div>
      <MapLegend />
    </div>
  );
}
