import { Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { type ContactKind, hasValidFix, type MapSettings } from '../../../shared/types';
import {
  MARKER_KIND_ORDER,
  MARKER_TYPES,
  MarkerShape,
} from '../../components/map/markers/MarkerShape';
import { Input } from '../../components/ui/input';
import { type ApiClient, api } from '../../lib/api';
import { useStore } from '../../lib/store';
import { cn } from '../../lib/utils';
import { NumberRow, SectionHeader, SwitchVisual, ToggleRow } from './controls/atoms';
import { LastHeardSlider } from './controls/LastHeardSlider';

interface Props {
  client: ApiClient | null;
}

export function ControlsCard({ client }: Props) {
  const contacts = useStore((s) => s.contacts);
  const settings = useStore((s) => s.mapSettings);
  const applyMapSettings = useStore((s) => s.applyMapSettings);
  const manifest = useStore((s) => s.mapManifest);
  const [query, setQuery] = useState('');

  const counts = useMemo(() => {
    const out: Record<ContactKind, number> = { chat: 0, repeater: 0, room: 0, sensor: 0 };
    for (const c of contacts) {
      if (!hasValidFix(c)) continue;
      out[c.kind] += 1;
    }
    return out;
  }, [contacts]);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return contacts
      .filter((c) => hasValidFix(c))
      .filter((c) => c.name.toLowerCase().includes(q) || c.publicKeyHex.toLowerCase().startsWith(q))
      .slice(0, 10);
  }, [contacts, query]);

  function persist(next: MapSettings) {
    applyMapSettings(next);
    if (client) void api.putMapSettings(client, next);
  }

  function setKindFilter(kind: ContactKind, on: boolean) {
    persist({ ...settings, kindFilters: { ...settings.kindFilters, [kind]: on } });
  }

  return (
    <div className="flex flex-col">
      {/* Search */}
      <div className="px-3 pt-3">
        <div className="relative">
          <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-cs-text-dim" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name or pubkey…"
            className="h-8 pl-8 text-xs"
            aria-label="Search nodes"
          />
        </div>
        {matches.length > 0 && (
          <ul className="mt-1 max-h-40 overflow-y-auto rounded border border-cs-border bg-cs-bg-3">
            {matches.map((c) => (
              <li key={c.key}>
                <button
                  type="button"
                  onClick={() => {
                    useStore.getState().setSelectedContact(c.key);
                    setQuery('');
                  }}
                  className="flex w-full items-center gap-2 px-2 py-1.5 text-left text-xs hover:bg-cs-bg-2"
                >
                  <MarkerShape type={c.kind} size={14} />
                  <span className="truncate">{c.name}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Node types */}
      <SectionHeader>Node types</SectionHeader>
      <div className="space-y-1 px-3 pb-3">
        {MARKER_KIND_ORDER.map((kind) => {
          const meta = MARKER_TYPES[kind];
          const on = settings.kindFilters[kind] !== false;
          return (
            <button
              key={kind}
              type="button"
              onClick={() => setKindFilter(kind, !on)}
              className={cn(
                'flex w-full items-center gap-2.5 rounded border px-2 py-1.5 text-left text-xs transition-opacity',
                on
                  ? 'border-cs-border bg-cs-bg-3'
                  : 'border-transparent bg-transparent opacity-60 hover:opacity-90',
              )}
              aria-pressed={on}
            >
              <MarkerShape type={kind} size={16} />
              <span className="flex-1 truncate">{meta.plural}</span>
              <span className="font-mono text-[11px] text-cs-text-dim">{counts[kind]}</span>
              {/* Visual-only switch — the outer <button> handles the toggle.
                  Avoids nesting <button> inside <button> (Radix Switch is itself
                  a button), which React flags as invalid DOM. */}
              <SwitchVisual on={on} />
            </button>
          );
        })}
      </div>

      {/* Last heard */}
      <SectionHeader>Last heard</SectionHeader>
      <div className="px-3 pb-3">
        <LastHeardSlider
          value={settings.lastHeardHours}
          onChange={(hours) => persist({ ...settings, lastHeardHours: hours })}
        />
      </div>

      {/* Show */}
      <SectionHeader>Show</SectionHeader>
      <div className="space-y-1 px-3 pb-3">
        <ToggleRow
          label="Favourites only"
          on={settings.favouritesOnly}
          onChange={(v) => persist({ ...settings, favouritesOnly: v })}
        />
        <ToggleRow
          label="Stale fade"
          on={settings.staleFadeEnabled}
          sub="fade vs hide stale nodes"
          onChange={(v) => persist({ ...settings, staleFadeEnabled: v })}
        />
        <ToggleRow
          label="Cluster nearby"
          on={settings.clusteringEnabled}
          onChange={(v) => persist({ ...settings, clusteringEnabled: v })}
        />
        <NumberRow
          label="Co-location distance"
          sub="contacts within N m collapse into a site row"
          value={settings.coLocationMeters}
          min={0}
          max={1000}
          step={5}
          unit="m"
          onChange={(meters) => persist({ ...settings, coLocationMeters: meters })}
        />
        <ToggleRow
          label="Marker labels"
          on={settings.showMarkerLabels}
          sub="auto · hover-only when off"
          onChange={(v) => persist({ ...settings, showMarkerLabels: v })}
        />
      </div>

      {/* Layers */}
      <SectionHeader>Layers</SectionHeader>
      <div className="space-y-1 px-3 pb-4">
        {manifest.terrain && (
          <>
            <ToggleRow
              label="Hillshade"
              on={settings.terrainHillshadeEnabled}
              onChange={(v) => persist({ ...settings, terrainHillshadeEnabled: v })}
            />
            <ToggleRow
              label="3D terrain"
              on={settings.terrain3DEnabled}
              onChange={(v) => persist({ ...settings, terrain3DEnabled: v })}
            />
          </>
        )}
        <ToggleRow
          label="Light basemap"
          on={settings.lightBasemap}
          sub="override theme-derived flavor"
          onChange={(v) => persist({ ...settings, lightBasemap: v })}
        />
      </div>
    </div>
  );
}
