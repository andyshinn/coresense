import { LogIn, RotateCcw, Route, ThermometerSun, TriangleAlert, X } from 'lucide-react';
import type { ReactNode } from 'react';
import type { DescribedReading } from '../../../shared/telemetry/describe';
import { Skeleton } from '../../components/ui/skeleton';
import { useNowTick } from '../../hooks/useNowTick';
import { useStore } from '../../lib/store';
import { LOGIN_HINT } from '../../lib/telemetry';
import { dayKey, fmtDateTime, fmtTime } from '../../lib/time';
import { cn } from '../../lib/utils';
import { ageOld, type RequestSummary } from './format';
import { TelemetryRow } from './TelemetryRow';
import { LABEL_MONO, META, TelemetryButton, TelemetryCard, TelemetryChip } from './ui';

// The panel's states (Components.dc.html), each in the group-card frame so
// it sits in the same column as the channel cards. Copy is source-agnostic:
// the panel passes the action's name and the target's noun.

const BODY = 'flex flex-col gap-2 p-3.5';
const COPY = 'text-[12px] leading-[18px] text-cs-text-muted';

function Rows({ readings, muted }: { readings?: readonly DescribedReading[]; muted?: boolean }) {
  if (!readings || readings.length === 0) return null;
  return (
    <div className="flex flex-col gap-1.5">
      {readings.map((d) => (
        <TelemetryRow key={d.reading.offset} reading={d} compact muted={muted} />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------

interface LoadingProps {
  /** The card's title, the pending action: "Requesting telemetry" (default) / "Reading telemetry". */
  title?: string;
  /** From the in-flight entry: when the request left. */
  startedAt: number;
  /** When main gives up; null until the radio's estimate is known. */
  deadlineAt: number | null;
  /** Clock override for tests; the card ticks every second otherwise. */
  now?: number;
}

/** "waiting for reply · 4 s · timeout at 15 s" over skeleton tiles. */
export function waitingLine(startedAt: number, deadlineAt: number | null, now: number): string {
  const elapsed = `${Math.max(0, Math.floor((now - startedAt) / 1000))} s`;
  const timeout = deadlineAt !== null ? `timeout at ${Math.max(0, Math.round((deadlineAt - startedAt) / 1000))} s` : null;
  return ['waiting for reply', elapsed, timeout].filter(Boolean).join(' · ');
}

export function TelemetryLoading({ title = 'Requesting telemetry', startedAt, deadlineAt, now: nowProp }: LoadingProps) {
  const tick = useNowTick(nowProp === undefined ? 1_000 : null);
  const now = nowProp ?? tick;
  return (
    <TelemetryCard aria-busy="true" aria-label={title} header={<span className={LABEL_MONO}>{title}</span>}>
      <div className="overflow-hidden">
        <div className="-mr-px -mb-px grid grid-cols-[repeat(auto-fit,minmax(min(100%,150px),1fr))]">
          {[60, 45, 70].map((w) => (
            <div
              key={w}
              className="flex flex-col gap-2.5 bg-cs-bg-2 px-3.5 py-3 shadow-[inset_-1px_-1px_0_0_rgb(var(--cs-border))]"
            >
              <Skeleton className="h-2.5 w-2/5 rounded" />
              <Skeleton className="h-5.5 rounded" style={{ width: `${w}%` }} />
              <Skeleton className="h-2.5 w-4/5 rounded" />
            </div>
          ))}
        </div>
      </div>
      <div data-testid="telemetry-waiting" className={cn(META, 'px-3.5 py-2.5')}>
        {waitingLine(startedAt, deadlineAt, now)}
      </div>
    </TelemetryCard>
  );
}

// ---------------------------------------------------------------------------

interface GuestProps {
  /** Base readings to list in the card (omit when the tiles are shown above). */
  readings?: readonly DescribedReading[];
  /** "Log in as admin": switch to the login view. Hidden without it. */
  onLogIn?: () => void;
}

/** A guest's base-only reply. */
export function TelemetryGuest({ readings, onLogIn }: GuestProps) {
  return (
    <TelemetryCard
      header={
        <>
          <span className={LABEL_MONO}>Guest login</span>
          <TelemetryChip tone="warn" className="ml-auto">
            Base only
          </TelemetryChip>
        </>
      }
    >
      <div className={BODY}>
        <Rows readings={readings} />
        <p className={COPY}>Environment and location are hidden for guests. Log in as admin to see sensors.</p>
        {onLogIn && (
          <div>
            <TelemetryButton onClick={onLogIn}>
              <LogIn aria-hidden="true" />
              Log in as admin
            </TelemetryButton>
          </div>
        )}
      </div>
    </TelemetryCard>
  );
}

// ---------------------------------------------------------------------------

/** A full-permission reply with nothing past ch 1. */
export function TelemetryNoSensors({
  readings,
  hideRows,
}: {
  readings?: readonly DescribedReading[];
  /** Word the copy from `readings` but don't list them (the panel shows ch 1's tiles above). */
  hideRows?: boolean;
}) {
  // "Battery only" is false when ch 1 also carries the MCU temperature or GPS.
  const batteryOnly = !readings || readings.every((d) => d.kind === 'battery');
  return (
    <TelemetryCard header={<span className={LABEL_MONO}>No sensors</span>}>
      <div className={BODY}>
        {!hideRows && <Rows readings={readings} />}
        <p className={COPY}>{batteryOnly ? 'Battery only. ' : ''}This node reported no environment sensors.</p>
        <p className={META}>firmware detects I²C sensors at boot</p>
      </div>
    </TelemetryCard>
  );
}

// ---------------------------------------------------------------------------

interface OlderProps {
  requestedAt: number;
  readings?: readonly DescribedReading[];
  /** The button that fetches current values, named in the copy. */
  actionLabel?: string;
  now?: number;
}

/** "From 18:42" today, the full date and time on any other day. */
function fromWhen(ts: number, pref: Parameters<typeof fmtTime>[1], now: number): string {
  return dayKey(ts) === dayKey(now) ? fmtTime(ts, pref) : fmtDateTime(ts, pref);
}

/** The selected request isn't the newest, or is over an hour old (DECISIONS B18). */
export function TelemetryOlderRequest({
  requestedAt,
  readings,
  actionLabel = 'Request telemetry',
  now: nowProp,
}: OlderProps) {
  const timeFormat = useStore((s) => s.appSettings.timeFormat);
  const tick = useNowTick(nowProp === undefined ? 30_000 : null);
  const now = nowProp ?? tick;
  return (
    <TelemetryCard
      header={
        <>
          <span className={LABEL_MONO}>Older request</span>
          <TelemetryChip tone="warn" className="ml-auto">
            <TriangleAlert aria-hidden="true" />
            {ageOld(requestedAt, now)}
          </TelemetryChip>
        </>
      }
    >
      <div className={cn(BODY, 'opacity-85')}>
        <Rows readings={readings} muted />
        <p className={COPY}>
          Showing the saved request from {fromWhen(requestedAt, timeFormat, now)}. {actionLabel} for current values.
        </p>
      </div>
    </TelemetryCard>
  );
}

// ---------------------------------------------------------------------------

interface FailedProps {
  request: Pick<RequestSummary, 'outcome' | 'error' | 'roundTripMs' | 'hops' | 'route'>;
  /** The card's header: "Request failed" (default) / "Read failed". */
  title?: string;
  /** The failure line's prefix: "Telemetry request failed" (default) / "Telemetry read failed". */
  failedLabel?: string;
  onRetry?: () => void;
  /** Why "Try again" is disabled (another request holds the radio); null/absent = enabled. */
  retryBlockedHint?: string | null;
  /** "Reset to flood": offered only for a request that went over a stored direct path. */
  onResetToFlood?: () => void;
  /** "Log in": offered when the node needs a login to answer (repeater, no session). */
  onLogIn?: () => void;
}

/** "No reply in 15 s over a 2-hop path." — where the request went and how long it waited. */
export function failureContext(req: FailedProps['request']): string | null {
  const path =
    req.route === 'flood'
      ? ' over flood'
      : req.route === 'direct' && req.hops !== null
        ? req.hops === 0
          ? ' to a direct neighbour'
          : ` over a ${req.hops}-hop path`
        : '';
  if (req.outcome === 'timeout') {
    const waited = req.roundTripMs !== null ? ` in ${Math.max(1, Math.round(req.roundTripMs / 1000))} s` : '';
    return `No reply${waited}${path}.`;
  }
  return path ? `Sent${path}.` : null;
}

export function TelemetryFailed({
  request,
  title = 'Request failed',
  failedLabel = 'Telemetry request failed',
  onRetry,
  retryBlockedHint,
  onResetToFlood,
  onLogIn,
}: FailedProps) {
  const reason = request.error ?? request.outcome;
  const canReset = request.route === 'direct' && onResetToFlood !== undefined;
  const advice =
    onRetry && canReset
      ? 'Try again, or reset the path to flood.'
      : onRetry
        ? 'Try again.'
        : canReset
          ? 'Reset the path to flood.'
          : '';
  const context = [failureContext(request), advice].filter(Boolean).join(' ');
  return (
    <TelemetryCard
      tone="danger"
      header={
        <>
          <span className={LABEL_MONO}>{title}</span>
          <TelemetryChip tone="bad" className="ml-auto">
            <X aria-hidden="true" />
            {request.outcome}
          </TelemetryChip>
        </>
      }
    >
      <div className={BODY}>
        <p className="text-[12px] leading-[18px] text-cs-text">
          {failedLabel}: {reason}
        </p>
        {context && <p className={COPY}>{context}</p>}
        {onLogIn && <p className={COPY}>{LOGIN_HINT}.</p>}
        {(onRetry || canReset || onLogIn) && (
          <div className="flex flex-wrap gap-2">
            {onRetry && (
              <TelemetryButton onClick={onRetry} disabled={!!retryBlockedHint} title={retryBlockedHint ?? undefined}>
                <RotateCcw aria-hidden="true" />
                Try again
              </TelemetryButton>
            )}
            {canReset && (
              <TelemetryButton onClick={onResetToFlood}>
                <Route aria-hidden="true" />
                Reset to flood
              </TelemetryButton>
            )}
            {onLogIn && (
              <TelemetryButton onClick={onLogIn}>
                <LogIn aria-hidden="true" />
                Log in
              </TelemetryButton>
            )}
          </div>
        )}
      </div>
    </TelemetryCard>
  );
}

// ---------------------------------------------------------------------------

interface EmptyProps {
  /** The button the copy names ("Request telemetry", "Read telemetry"). */
  actionLabel?: string;
  /** Who gets asked ("this repeater", "this sensor", "your radio"). */
  target?: string;
  /** An extra line, e.g. "Repeaters and sensors reply only to logged-in clients." */
  hint?: ReactNode;
}

/** No saved requests yet. The house empty state: centred icon over dim copy. */
export function TelemetryEmpty({ actionLabel = 'Request telemetry', target = 'this repeater', hint }: EmptyProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-10 text-center">
      <ThermometerSun aria-hidden="true" className="size-5 text-cs-text-dim" />
      <p className="max-w-sm text-[12px] leading-[18px] text-cs-text-dim">
        No telemetry yet. Click {actionLabel} to ask {target}.
      </p>
      {hint && <p className="max-w-sm text-[11px] leading-4 text-cs-text-dim">{hint}</p>}
    </div>
  );
}
