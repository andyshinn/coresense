import { LocateFixed, MapIcon, MapPin, Minus, Plus } from 'lucide-react';
import type { Map as MapLibreMap } from 'maplibre-gl';
import { useEffect, useId, useMemo, useState } from 'react';
import { ErrorBoundary } from 'react-error-boundary';
import { type CoordAxis, parseCoord, validateLatLon } from '../../../../shared/geo';
import { logError, MapErrorFallback } from '../../../components/errors/ErrorFallback';
import { LeaveGuardDialog } from '../../../components/LeaveGuardDialog';
import { DraggableNodeMarker } from '../../../components/map/DraggableNodeMarker';
import { MapCanvas } from '../../../components/map/MapCanvas';
import { Button } from '../../../components/ui/button';
import { Switch } from '../../../components/ui/switch';
import { UnsavedPill } from '../../../components/ui/UnsavedPill';
import { QUICK_ACTIONS_BY_ID } from '../../../features/quick-actions/catalog';
import { api } from '../../../lib/api';
import { useApiClient } from '../../../lib/apiClientContext';
import { notify } from '../../../lib/notify';
import { useStore } from '../../../lib/store';
import { cn } from '../../../lib/utils';
import { useSectionDraft } from '../../settings/useSectionDraft';
import { NodeCard } from '../NodeCard';

/** My Node edits position to 5 decimal places (about a metre). */
const DECIMALS = 5;
/** Zoom for a map opened on, or recentred to, the radio's position. */
const NODE_ZOOM = 13;

interface CoordDraft {
  lat: string;
  lon: string;
}

const sameDraft = (a: CoordDraft, b: CoordDraft) => a.lat === b.lat && a.lon === b.lon;

/** A coordinate as the fields show it: at most 5 decimals, no trailing zeros. */
function fmtCoord(value: number | null): string {
  return value === null ? '' : String(Number(value.toFixed(DECIMALS)));
}

/** A labelled small switch for a card header. */
function HeaderSwitch({
  label,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  checked: boolean;
  disabled: boolean;
  onChange: () => void;
}) {
  const id = useId();
  return (
    <span className="flex items-center gap-1.5">
      <Switch
        id={id}
        size="sm"
        checked={checked}
        disabled={disabled}
        onCheckedChange={(next) => {
          if (next !== checked) onChange();
        }}
      />
      <label htmlFor={id} className="text-[11px] text-cs-text-muted">
        {label}
      </label>
    </span>
  );
}

const MAP_BUTTON =
  'flex size-7 items-center justify-center rounded-md border border-cs-border bg-cs-bg/90 text-cs-text-muted hover:text-cs-text focus-visible:outline-1 focus-visible:outline-cs-accent disabled:cursor-not-allowed disabled:opacity-50';

/** Zoom and recenter, drawn over the map in place of MapLibre's cluster. The
 *  camera moves ease, and MapLibre itself turns them into jumps under
 *  prefers-reduced-motion. */
function MapButtons({ map, target }: { map: MapLibreMap | null; target: { lat: number; lon: number } | null }) {
  return (
    <div className="absolute top-2 right-2 flex flex-col gap-1">
      <button type="button" aria-label="Zoom in" title="Zoom in" className={MAP_BUTTON} onClick={() => map?.zoomIn()}>
        <Plus aria-hidden="true" className="size-3.5" />
      </button>
      <button type="button" aria-label="Zoom out" title="Zoom out" className={MAP_BUTTON} onClick={() => map?.zoomOut()}>
        <Minus aria-hidden="true" className="size-3.5" />
      </button>
      <button
        type="button"
        aria-label="Recenter on my node"
        title="Recenter on my node"
        className={MAP_BUTTON}
        disabled={!target}
        onClick={() => {
          if (!map || !target) return;
          map.flyTo({ center: [target.lon, target.lat], zoom: Math.max(map.getZoom(), NODE_ZOOM) });
        }}
      >
        <LocateFixed aria-hidden="true" className="size-3.5" />
      </button>
    </div>
  );
}

/** Keep the pin in view: a typed position (or a revert) can land it off the
 *  map, so pan there when it does. A drag always ends inside the view. */
function FollowPin({ map, pin }: { map: MapLibreMap | null; pin: { lat: number; lon: number } | null }) {
  const lat = pin?.lat ?? null;
  const lon = pin?.lon ?? null;
  useEffect(() => {
    if (!map || lat === null || lon === null) return;
    if (map.getBounds().contains([lon, lat])) return;
    map.easeTo({ center: [lon, lat] });
  }, [map, lat, lon]);
  return null;
}

function MapEmpty({ text }: { text: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
      <MapIcon aria-hidden="true" className="size-5 text-cs-text-dim" />
      <p className="max-w-xs text-[12px] text-cs-text-muted">{text}</p>
    </div>
  );
}

/** One coordinate field: a real label, mono input, and the parse error. */
function CoordField({
  axis,
  label,
  value,
  error,
  disabled,
  onChange,
}: {
  axis: CoordAxis;
  label: string;
  value: string;
  error: string | null;
  disabled: boolean;
  onChange: (text: string) => void;
}) {
  const id = useId();
  const errorId = `${id}-error`;
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1">
      <label htmlFor={id} className="label-caps text-cs-text-muted">
        {label}
      </label>
      <input
        id={id}
        name={axis}
        inputMode="decimal"
        autoComplete="off"
        spellCheck={false}
        value={value}
        disabled={disabled}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        onChange={(e) => onChange(e.target.value)}
        className={cn(
          'h-7 w-full rounded-md border bg-cs-bg px-2 font-mono text-[12px] tabular-nums text-cs-text focus-visible:outline-1 focus-visible:outline-cs-accent disabled:cursor-not-allowed disabled:opacity-60',
          error ? 'border-cs-danger' : 'border-cs-border',
        )}
      />
      {error && (
        <span id={errorId} className="text-[11px] text-cs-danger">
          {error}
        </span>
      )}
    </div>
  );
}

/**
 * Where the radio says it is, and whether its adverts carry that. Drag the
 * pin or type the coordinates; either makes a draft that Save pushes to the
 * radio. The GPS and share switches run the owner card's own quick actions,
 * so both stay in step through the store. While GPS is on the radio sets its
 * own position, so the pin and fields are read-only.
 */
export function LocationCard({ className }: { className?: string }) {
  const client = useApiClient();
  const owner = useStore((s) => s.owner);
  const connected = useStore((s) => s.transportState === 'connected');
  const gpsOn = useStore((s) => QUICK_ACTIONS_BY_ID.gps.getState?.(s) ?? false);
  const shared = useStore((s) => QUICK_ACTIONS_BY_ID.shareLoc.getState?.(s) ?? false);
  const lat = useStore((s) => s.deviceIdentity.lat);
  const lon = useStore((s) => s.deviceIdentity.lon);
  const radioName = useStore((s) => s.deviceIdentity.name);
  const manifest = useStore((s) => s.mapManifest);
  const mapSettings = useStore((s) => s.mapSettings);
  const setLocationDirty = useStore((s) => s.setLocationDirty);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);

  // 0,0 is the radio's "no position set", not a point off West Africa.
  const hasSaved = lat !== null && lon !== null && (lat !== 0 || lon !== 0);
  const saved = useMemo<CoordDraft>(
    () => (hasSaved ? { lat: fmtCoord(lat), lon: fmtCoord(lon) } : { lat: '', lon: '' }),
    [hasSaved, lat, lon],
  );
  const { draft, setDraft, dirty, reset } = useSectionDraft(saved, sameDraft);

  // Errors only for an edit: an untouched card with no position isn't wrong.
  const latError = dirty ? errorFor(draft.lat, 'lat') : null;
  const lonError = dirty ? errorFor(draft.lon, 'lon') : null;
  const checked = validateLatLon(draft.lat, draft.lon, { maxDecimals: DECIMALS });
  const pin = checked.ok ? checked.value : null;

  useEffect(() => {
    setLocationDirty(dirty);
  }, [dirty, setLocationDirty]);
  // Unmounted (disconnect, or a move the guard let through), the draft is
  // gone: don't leave the guard holding a flag no dialog can answer.
  useEffect(() => () => setLocationDirty(false), [setLocationDirty]);

  const run = (id: 'gps' | 'shareLoc') => async () => {
    setBusy(true);
    try {
      await QUICK_ACTIONS_BY_ID[id].run({ client, owner });
    } catch (err) {
      // The actions toast their own API failures; this catches anything else.
      notify.failure(QUICK_ACTIONS_BY_ID[id].label, err);
    } finally {
      setBusy(false);
    }
  };

  /** Push the draft. Rejects on failure (the leave dialog relies on that). */
  const push = async () => {
    if (!client) throw new Error('no radio connected');
    if (!checked.ok) throw new Error(checked.error);
    setSaving(true);
    try {
      await api.putDeviceIdentity(client, { lat: checked.value.lat, lon: checked.value.lon });
      notify.success('Position pushed to radio');
    } finally {
      setSaving(false);
    }
  };

  const save = () => push().catch((err) => notify.failure('Save', err));

  const switchesDisabled = !connected || !client || busy;
  const editable = connected && !!client && !gpsOn && !saving;
  const tilesOk = !manifest.missing && !!manifest.basemap;
  const name = radioName || owner?.name || 'My node';

  return (
    <NodeCard
      icon={MapPin}
      title="Location"
      className={className}
      extras={
        <>
          <HeaderSwitch label="GPS" checked={gpsOn} disabled={switchesDisabled} onChange={() => void run('gps')()} />
          <HeaderSwitch
            label="Share in advert"
            checked={shared}
            disabled={switchesDisabled}
            onChange={() => void run('shareLoc')()}
          />
        </>
      }
    >
      <div
        data-testid="location-map"
        className="relative h-60 overflow-hidden rounded-md border border-cs-border bg-cs-bg-3"
      >
        {tilesOk && client ? (
          <ErrorBoundary FallbackComponent={MapErrorFallback} onError={logError}>
            <MapCanvas
              client={client}
              manifest={manifest}
              settings={mapSettings}
              controls="none"
              persistViewport={false}
              initialView={
                hasSaved && lat !== null && lon !== null
                  ? { center: [lon, lat], zoom: NODE_ZOOM, bearing: 0, pitch: 0 }
                  : undefined
              }
              renderOverlays={(map) => (
                <>
                  <DraggableNodeMarker
                    map={map}
                    position={pin}
                    name={name}
                    draggable={editable}
                    onDragEnd={(nextLat, nextLon) => setDraft({ lat: fmtCoord(nextLat), lon: fmtCoord(nextLon) })}
                  />
                  <FollowPin map={map} pin={pin} />
                  <MapButtons map={map} target={pin} />
                  {!pin && editable && (
                    <div className="absolute inset-x-0 bottom-2 flex justify-center">
                      <Button
                        variant="outline"
                        size="xs"
                        className="bg-cs-bg/90"
                        onClick={() => {
                          if (!map) return;
                          const c = map.getCenter();
                          setDraft({ lat: fmtCoord(c.lat), lon: fmtCoord(c.lng) });
                        }}
                      >
                        <MapPin aria-hidden="true" />
                        Drop pin at map center
                      </Button>
                    </div>
                  )}
                </>
              )}
            />
          </ErrorBoundary>
        ) : (
          <MapEmpty text="Map tiles aren't installed. Type the position below." />
        )}
      </div>

      <div className="flex flex-col gap-2 @min-[360px]/card:flex-row @min-[360px]/card:items-start">
        <div className="flex min-w-0 flex-1 gap-2">
          <CoordField
            axis="lat"
            label="Latitude"
            value={draft.lat}
            error={latError}
            disabled={!editable}
            onChange={(text) => setDraft((d) => ({ ...d, lat: text }))}
          />
          <CoordField
            axis="lon"
            label="Longitude"
            value={draft.lon}
            error={lonError}
            disabled={!editable}
            onChange={(text) => setDraft((d) => ({ ...d, lon: text }))}
          />
        </div>
        <div className="flex shrink-0 items-center gap-2 @min-[360px]/card:mt-[18px] @min-[360px]/card:h-7">
          {dirty && <UnsavedPill />}
          <Button variant="ghost" size="xs" onClick={reset} disabled={!dirty || saving}>
            Revert
          </Button>
          <Button size="xs" onClick={() => void save()} disabled={!dirty || !checked.ok || !editable}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </div>

      <p className="text-[11px] text-cs-text-muted">
        {gpsOn
          ? 'GPS is on, so the radio sets its own position. Turn GPS off to place it by hand.'
          : `Drag the pin or type coordinates. ${shared ? 'Adverts share this position.' : "Adverts don't share it."}`}
      </p>

      <LeaveGuardDialog
        title="Unsaved position"
        description={(action) => `The radio's new position hasn't been saved. Push it to the radio before ${action}?`}
        saveLabel="Save position"
        onSave={push}
        onDiscard={reset}
      />
    </NodeCard>
  );
}

/** The field's own error, or null when it parses. */
function errorFor(text: string, axis: CoordAxis): string | null {
  const r = parseCoord(text, axis, { maxDecimals: DECIMALS });
  return r.ok ? null : r.error;
}
