import { TriangleAlert } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { type ChannelGroup, type DescribedReading, describeChannels } from '../../../../shared/telemetry/describe';
import { fmtAge } from '../../../../shared/telemetry/format';
import { isBaseOnlyReply, type SavedRequestDto } from '../../../../shared/telemetry/types';
import type { Contact, RepeaterAdminSession } from '../../../../shared/types';
import { Skeleton } from '../../../components/ui/skeleton';
import { requestDetail, TelemetryButton, TelemetryRow, waitingLine } from '../../../features/telemetry';
import { useTelemetryRequest } from '../../../features/telemetry/TelemetryPanel';
import { useNowTick } from '../../../hooks/useNowTick';
import { type ApiClient, api } from '../../../lib/api';
import { useApiClient } from '../../../lib/apiClientContext';
import { useStore } from '../../../lib/store';
import {
  TELEMETRY_COPY,
  useEnsureTelemetryLoaded,
  useSelectedTelemetryRequest,
  useTelemetryLoaded,
  useTelemetryRequests,
} from '../../../lib/telemetry';
import { fmtTime } from '../../../lib/time';

// Right rail › Telemetry (DECISIONS B13): the focal repeater/sensor's selected
// or newest saved request as pinned TelemetryRows, a request button gated the
// same way as the Telemetry tab, and a link into that tab. Always the focal
// contact, never the Neighbours tab's selected neighbour. The button is the
// tab's own control (useTelemetryRequest), so the two agree on labels, toasts
// and gating.

/** An `ok` request over an hour old reads as an older request (B18). */
const STALE_AFTER_MS = 3_600_000;

export interface PinnedRow {
  reading: DescribedReading;
  /** "Ch 3 voltage" where the reading's own label would be ambiguous. */
  label?: string;
}

/** "Voltage" → "voltage", leaving acronyms ("CO2", "MCU temp") alone. */
function lowerFirst(label: string): string {
  return /^[A-Z][a-z]/.test(label) ? label.charAt(0).toLowerCase() + label.slice(1) : label;
}

/**
 * The rail's pinned set: battery first, then one row per channel (its first
 * other reading — temperature on an environment channel, voltage on a power
 * one, a T1000-E's ch 1 sensor), then the position. The MCU temperature stays
 * on the tab. A power
 * channel's row, or a label that would repeat, is prefixed "Ch N" so three
 * INA3221 voltages and the battery stay apart.
 */
export function pinnedTelemetryRows(groups: readonly ChannelGroup[]): PinnedRow[] {
  const all = groups.flatMap((g) => g.readings);
  const battery = all.find((d) => d.kind === 'battery');
  const gps = all.find((d) => d.kind === 'gps');
  const heads: Array<{ group: ChannelGroup; reading: DescribedReading }> = [];
  for (const group of groups) {
    const reading = group.readings.find((d) => d !== battery && d !== gps && d.kind !== 'mcuTemp');
    if (reading) heads.push({ group, reading });
  }
  const labelCount = new Map<string, number>();
  for (const { reading } of heads) labelCount.set(reading.label, (labelCount.get(reading.label) ?? 0) + 1);

  const rows: PinnedRow[] = [];
  if (battery) rows.push({ reading: battery });
  for (const { group, reading } of heads) {
    const prefixed = group.name === 'Power' || (labelCount.get(reading.label) ?? 0) > 1;
    rows.push(prefixed ? { reading, label: `Ch ${group.ch} ${lowerFirst(reading.label)}` } : { reading });
  }
  if (gps) rows.push({ reading: gps });
  // A reply with none of the above (a ch 1 holding only an MCU temperature)
  // still shows what it carried rather than an empty section.
  if (rows.length === 0 && all.length > 0) rows.push({ reading: all[0] });
  return rows;
}

interface RailTelemetry {
  /** What the rail shows readings from: the selected/newest request, or — when that failed — the newest earlier `ok` one. */
  shown: SavedRequestDto | null;
  /** The selected/newest request when it failed. */
  failed: SavedRequestDto | null;
  /** `shown` isn't the newest request (the stamp's age covers the 1 h rule). */
  notNewest: boolean;
  count: number;
}

/** Select what the section and its header stamp show. Shared so both agree. */
function useRailTelemetry(nodeKey: string): RailTelemetry {
  const requests = useTelemetryRequests(nodeKey);
  const selected = useSelectedTelemetryRequest(nodeKey);
  return useMemo(() => {
    if (!selected) return { shown: null, failed: null, notNewest: false, count: requests.length };
    if (selected.outcome === 'ok') {
      return { shown: selected, failed: null, notNewest: selected !== requests[0], count: requests.length };
    }
    const at = requests.indexOf(selected);
    const shown = requests.slice(at + 1).find((r) => r.outcome === 'ok') ?? null;
    return { shown, failed: selected, notNewest: shown !== null, count: requests.length };
  }, [requests, selected]);
}

/** Tick every second while a stamp's age is in seconds, then every 30 s. */
function useStampTick(ts: number | null): number {
  const fresh = ts !== null && Date.now() - ts < 60_000;
  return useNowTick(fresh ? 1_000 : 30_000);
}

/** Header trailing slot: "from 21:29 · 12 s ago". */
export function TelemetryRailStamp({ contact }: { contact: Contact }) {
  const { shown, failed } = useRailTelemetry(contact.key);
  const timeFormat = useStore((s) => s.appSettings.timeFormat);
  const ts = (shown ?? failed)?.requestedAt ?? null;
  const now = useStampTick(ts);
  if (ts === null) return null;
  return (
    <span className="shrink-0 font-mono text-[10px] tabular-nums text-cs-text-dim">
      from {fmtTime(ts, timeFormat)} · {fmtAge(ts, now)}
    </span>
  );
}

/** Repeaters and sensors both answer only clients in their ACL (simple_repeater
 *  and simple_sensor searchPeersByHash), so both get the login hint. */
const dropsNonAclClients = (contact: Contact) => contact.kind === 'repeater' || contact.kind === 'sensor';

/**
 * The login state the hint needs. RepeaterAdmin keeps its session locally, so
 * the rail asks main too; it re-reads after each login/logout (RepeaterAdmin
 * bumps `repeaterAdminSessionRev`), a tab switch and each saved request.
 */
function useHasSession(client: ApiClient | null, contact: Contact, refreshOn: unknown): boolean | null {
  const [has, setHas] = useState<boolean | null>(null);
  const activeTab = useStore((s) => s.repeaterAdminActiveTab);
  const sessionRev = useStore((s) => s.repeaterAdminSessionRev);
  const applies = dropsNonAclClients(contact);
  // biome-ignore lint/correctness/useExhaustiveDependencies: activeTab/sessionRev/refreshOn only trigger a re-read
  useEffect(() => {
    if (!client || !applies) {
      setHas(null);
      return;
    }
    let cancelled = false;
    api
      .repeaterSession(client, contact.key)
      .then((res: { session: RepeaterAdminSession | null }) => {
        if (!cancelled) setHas(res.session !== null);
      })
      .catch(() => {
        // Non-fatal: without an answer the hint just stays off.
        if (!cancelled) setHas(null);
      });
    return () => {
      cancelled = true;
    };
  }, [client, contact.key, applies, activeTab, sessionRev, refreshOn]);
  return has;
}

/**
 * "waiting for reply · 4 s · timeout at 15 s" on its own 1 s clock, so the
 * section doesn't redraw every second. The counter is hidden from screen
 * readers (it would be re-announced each second); the status says it once.
 */
function RailWaiting({ startedAt, deadlineAt, label }: { startedAt: number; deadlineAt: number | null; label: string }) {
  const now = useNowTick(1_000);
  return (
    <div className="font-mono text-[10px] tabular-nums text-cs-text-dim">
      <span role="status" className="sr-only">
        {label}
      </span>
      <span aria-hidden="true">{waitingLine(startedAt, deadlineAt, now)}</span>
    </div>
  );
}

interface Props {
  contact: Contact;
}

export function TelemetryRailSection({ contact }: Props) {
  const client = useApiClient();
  useEnsureTelemetryLoaded(client, contact.key);
  const loaded = useTelemetryLoaded(contact.key);
  const { shown, failed, notNewest, count } = useRailTelemetry(contact.key);
  const setRepeaterAdminTab = useStore((s) => s.setRepeaterAdminTab);
  const setActiveKey = useStore((s) => s.setActiveKey);
  const hasSession = useHasSession(client, contact, shown?.id ?? failed?.id);
  // Only for the one-hour "older" rule; the waiting line keeps its own clock.
  const now = useNowTick();
  // The tab's source for both kinds (TelemetryTab); main saves a sensor's
  // requests as 'repeater' too.
  const source = 'repeater';
  const needsLogin = dropsNonAclClients(contact) && hasSession === false;
  const control = useTelemetryRequest({ source, nodeKey: contact.key, client, needsLogin });
  const { inFlight, hint } = control;

  const rows = useMemo(() => (shown ? pinnedTelemetryRows(describeChannels(shown.readings, shown.source)) : []), [shown]);
  const older = shown !== null && (notNewest || now - shown.requestedAt > STALE_AFTER_MS);

  const openTab = () => {
    setRepeaterAdminTab('telemetry');
    setActiveKey(contact.key);
  };

  return (
    <div className="flex flex-col gap-2">
      {!loaded && count === 0 ? (
        <div className="flex flex-col gap-1.5" aria-busy="true">
          <span className="sr-only">Loading saved requests</span>
          {[70, 55, 62].map((w) => (
            <Skeleton key={w} className="h-3.5 bg-cs-bg-3" style={{ width: `${w}%` }} />
          ))}
        </div>
      ) : count === 0 ? (
        <p className="text-[11px] text-cs-text-dim">No telemetry yet.</p>
      ) : (
        <>
          {failed && (
            <p className="flex items-start gap-1 text-[11px] leading-4 text-cs-trend-down">
              <TriangleAlert aria-hidden="true" className="mt-0.5 size-3 shrink-0" />
              <span>
                {TELEMETRY_COPY[source].failed}: {requestDetail(failed)}
              </span>
            </p>
          )}
          {shown && rows.length === 0 && <p className="text-[11px] text-cs-text-dim">The reply held no readings.</p>}
          {rows.length > 0 && (
            <div className="flex flex-col gap-1.5">
              {rows.map((r) => (
                <TelemetryRow key={r.reading.reading.offset} reading={r.reading} label={r.label} muted={older} />
              ))}
            </div>
          )}
          {shown && isBaseOnlyReply(shown) && <p className="text-[11px] text-cs-text-dim">Base only · guest login</p>}
          {older && (
            <p className="flex items-center gap-1 text-[11px] text-[rgb(var(--cs-hop-far))]">
              <TriangleAlert aria-hidden="true" className="size-3 shrink-0" />
              Older request · request telemetry for current values
            </p>
          )}
        </>
      )}

      {inFlight && (
        <RailWaiting
          startedAt={inFlight.startedAt}
          deadlineAt={inFlight.deadlineAt}
          label={TELEMETRY_COPY[source].pending}
        />
      )}

      <div className="flex items-center gap-2">
        <TelemetryButton onClick={() => void control.request()} disabled={control.disabled} title={hint ?? undefined}>
          {control.label}
        </TelemetryButton>
        {count > 0 && (
          <button
            type="button"
            onClick={openTab}
            className="ml-auto text-[11px] text-cs-accent underline underline-offset-2 hover:text-cs-text"
          >
            {`${count} saved request${count === 1 ? '' : 's'}`}
          </button>
        )}
      </div>
      {/* Muted, not dim: the hint is the only visible reason the button is off, so it needs AA. */}
      {hint && <p className="text-[11px] leading-4 text-cs-text-muted">{hint}</p>}
    </div>
  );
}
