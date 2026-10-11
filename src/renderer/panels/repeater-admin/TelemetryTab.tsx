import { describeChannels } from '../../../shared/telemetry/describe';
import { fmtSeconds } from '../../../shared/telemetry/format';
import type { Contact, RepeaterAdminSession } from '../../../shared/types';
import { type ApiClient, api } from '../../lib/api';
import { notify } from '../../lib/notify';
import { useStore } from '../../lib/store';
import {
  notifyTelemetryOutcome,
  RADIO_BUSY_HINT,
  useEnsureTelemetryLoaded,
  useRadioBusy,
  useSelectedTelemetryRequest,
  useTelemetryInFlight,
  useTelemetryRequests,
} from '../../lib/telemetry';
import { fmtDateTime, fmtTime } from '../../lib/time';

interface Props {
  contact: Contact;
  client: ApiClient | null;
  session: RepeaterAdminSession | null;
}

const OUTCOME_LABEL = { ok: 'Reply', timeout: 'No reply', error: 'Failed' } as const;

/**
 * Telemetry tab body: request a node's telemetry and show the newest saved
 * request. Interim: features/telemetry/TelemetryPanel (tiles, saved-request
 * log, compare, LPP inspector) replaces this body; the request flow, store
 * hooks and copy here are the ones it builds on.
 */
export function TelemetryTab({ contact, client, session }: Props) {
  useEnsureTelemetryLoaded(client, contact.key);
  const requests = useTelemetryRequests(contact.key);
  const selected = useSelectedTelemetryRequest(contact.key);
  const inFlight = useTelemetryInFlight(contact.key);
  const radioBusy = useRadioBusy();
  const timeFormat = useStore((s) => s.appSettings.timeFormat);
  const setRepeaterAdminTab = useStore((s) => s.setRepeaterAdminTab);
  // Repeaters drop requests from clients outside their ACL — it shows as a timeout.
  const needsLogin = contact.kind === 'repeater' && !session;

  const onRequest = async () => {
    if (!client) return;
    try {
      notifyTelemetryOutcome(await api.requestTelemetry(client, contact.key));
    } catch (err) {
      notify.error(`Telemetry request failed: ${(err as Error).message}`, err);
    }
  };

  // Our own pending request reads as "Requesting…"; another node's holds the radio.
  const blockedByOther = radioBusy && !inFlight;
  const groups = selected?.outcome === 'ok' ? describeChannels(selected.readings, selected.source) : [];

  return (
    <div className="flex h-full flex-col gap-3 overflow-auto p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-cs-text-muted">Telemetry</h3>
        <button
          type="button"
          onClick={onRequest}
          disabled={!client || !!inFlight || blockedByOther}
          title={blockedByOther ? RADIO_BUSY_HINT : needsLogin ? 'Repeaters reply only to logged-in clients' : undefined}
          className="rounded border border-cs-border bg-cs-bg-3 px-2 py-0.5 text-[11px] text-cs-text-muted hover:bg-cs-accent-soft/30 hover:text-cs-text disabled:opacity-50"
        >
          {inFlight ? 'Requesting…' : 'Request telemetry'}
        </button>
      </div>

      {inFlight && (
        <p className="text-[12px] text-cs-text-dim">
          Waiting for reply
          {inFlight.deadlineAt !== null ? ` · timeout at ${fmtTime(inFlight.deadlineAt, timeFormat)}` : ''}
        </p>
      )}

      {!selected && !inFlight && (
        <p className="text-[12px] text-cs-text-dim">
          No saved requests yet.{needsLogin ? ' Repeaters reply only to logged-in clients.' : ''}
        </p>
      )}

      {selected && (
        <section className="rounded border border-cs-border bg-cs-bg-2 p-3 text-[12px]">
          <header className="mb-2 font-mono text-[10px] text-cs-text-dim">
            {OUTCOME_LABEL[selected.outcome]} · {fmtDateTime(selected.requestedAt, timeFormat)}
            {selected.roundTripMs !== null ? ` · ${fmtSeconds(selected.roundTripMs)}` : ''}
            {requests.length > 1 ? ` · ${requests.length} saved requests` : ''}
          </header>
          {selected.outcome !== 'ok' && (
            <div className="flex flex-wrap items-center gap-2 text-cs-text-muted">
              <span>{selected.error ?? 'The node did not answer before the timeout'}</span>
              {needsLogin && (
                <button
                  type="button"
                  onClick={() => setRepeaterAdminTab('login')}
                  className="font-medium text-cs-accent underline-offset-2 hover:underline"
                >
                  Log in
                </button>
              )}
            </div>
          )}
          {selected.outcome === 'ok' && groups.length === 0 && (
            <p className="text-cs-text-dim">The reply held no readings.</p>
          )}
          {groups.map((g) => (
            <div key={g.ch} className="mb-2 last:mb-0">
              <div className="text-[10px] uppercase tracking-wider text-cs-text-muted">
                {g.name} · ch {g.ch}
                {g.caption ? ` · ${g.caption}` : ''}
              </div>
              <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-0.5">
                {g.readings.map((d) => (
                  <div key={`${d.reading.ch}-${d.reading.offset}`} className="contents">
                    <dt className="text-cs-text-muted">{d.label}</dt>
                    <dd className="font-mono text-cs-text">
                      {d.text}
                      {d.batteryPercent !== null ? ` · ≈ ${d.batteryPercent}% est.` : ''}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
