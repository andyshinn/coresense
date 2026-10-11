import { RefreshCw, Send, Trash2 } from 'lucide-react';
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { type DescribedReading, describeChannels } from '../../../shared/telemetry/describe';
import { isGpsValue } from '../../../shared/telemetry/lpp';
import { COMPARE_MAX_COLUMNS, previousForRequest } from '../../../shared/telemetry/previous';
import {
  type SavedRequestDto,
  TELEM_PERM_ENVIRONMENT,
  type TelemetryInFlight,
  type TelemetrySource,
} from '../../../shared/telemetry/types';
import { Skeleton } from '../../components/ui/skeleton';
import { useNowTick } from '../../hooks/useNowTick';
import { type ApiClient, api } from '../../lib/api';
import { publish as publishMapBus } from '../../lib/map/bus';
import { notify } from '../../lib/notify';
import { useStore } from '../../lib/store';
import {
  compareWithPreviousIds,
  LOGIN_HINT,
  RADIO_BUSY_HINT,
  requestTelemetryOnce,
  TELEMETRY_COPY,
  telemetryNodeKey,
  telemetryNoun,
  useEnsureTelemetryLoaded,
  useRadioBusy,
  useSelectedTelemetryRequest,
  useTelemetryCompare,
  useTelemetryInFlight,
  useTelemetryLoaded,
  useTelemetryRequests,
  useTelemetryRetention,
} from '../../lib/telemetry';
import { fmtDateTime } from '../../lib/time';
import { cn } from '../../lib/utils';
import { previousByOffset, requestMetaLine } from './format';
import { LppInspector } from './LppInspector';
import { PermissionChips } from './PermissionChips';
import {
  TelemetryEmpty,
  TelemetryFailed,
  TelemetryGuest,
  TelemetryLoading,
  TelemetryNoSensors,
  TelemetryOlderRequest,
} from './states';
import { ClearSavedRequests, TelemetryCompare } from './TelemetryCompare';
import { TelemetryGroup } from './TelemetryGroup';
import { TelemetryRequestList } from './TelemetryRequestList';
import type { LatLon } from './TelemetryTile';
import { type HeadingLevel, LABEL_MONO, META, TelemetryButton } from './ui';

// The telemetry screen: the saved-request log on the left (request button,
// list, retention + Compare), the selected request — or the compare view —
// on the right. The only telemetry component that knows the source: it names
// the action ("Request" vs "Read", TELEMETRY_COPY), describes readings with
// the source, and decides which states apply. Everything below it is
// source-agnostic and takes its copy as props.

/** The selected request turns "older" past this age even when it is the newest (DECISIONS B18). */
const OLDER_AFTER_MS = 3_600_000;
const MINUTE = 60_000;

/** Battery, MCU temperature and GPS: what a node with no environment sensors still reports. */
function isBaseOrLocation(d: DescribedReading): boolean {
  return d.kind === 'battery' || d.kind === 'mcuTemp' || d.kind === 'gps';
}

const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

const LINK =
  'text-[11px] text-cs-accent underline underline-offset-2 hover:text-cs-text disabled:cursor-not-allowed disabled:opacity-50 disabled:no-underline';

export interface TelemetryPanelProps {
  source: TelemetrySource;
  /** The node asked: `c:<hex>` or bare hex; the owner's own key for a companion read. */
  nodeKey: string;
  client: ApiClient | null;
  /** For the CSV filename and the clear dialog. */
  nodeName?: string;
  /** Who gets asked, in the empty state ("this sensor"); defaults by source. */
  target?: string;
  /** A repeater with no admin session: shows the login hint, and "Log in" on failures. */
  needsLogin?: boolean;
  /** Switch to the login view. "Log in" / "Log in as admin" are hidden without it. */
  onLogIn?: () => void;
  /** The node's advertised position, for the GPS tile's "N m from advertised". */
  advertPosition?: LatLon | null;
  /** The node has a stored direct path, so a failed direct request can offer "Reset to flood". */
  canResetPath?: boolean;
  /** Show the saved-request log column (default true). Compare mode always shows it. */
  showLog?: boolean;
  /** Put the request button above the log (default true). False when the caller renders its own via useTelemetryRequest. */
  requestInLog?: boolean;
  /** Replaces the "No telemetry yet" empty state (My radio's unsupported-library notice). */
  empty?: ReactNode;
  /** Appended to the ch 1 (Self) card's tiles (My radio's GPS-off tile). */
  selfTile?: ReactNode;
  /** Below the selected request, in the same scroll column (My radio's policy and sensor cards). Hidden while comparing. */
  children?: ReactNode;
  /** Handle a failed request before the default toast; return true when handled (My radio's unsupported library). */
  onRequestError?: (err: unknown) => boolean;
  /** Level of the selected request's / compare view's heading (default 2); My radio nests it under "My telemetry". */
  headingLevel?: HeadingLevel;
}

export interface TelemetryRequestControl {
  /** Ask the node (or read the radio). A no-op while blocked. */
  request: () => Promise<void>;
  inFlight: TelemetryInFlight | null;
  /** Another node's mesh request holds the radio. */
  blockedByOther: boolean;
  disabled: boolean;
  /** The action's name ("Request telemetry"), or its pending form while in flight. */
  label: string;
  /** Visible hint under the button: the radio-busy or login hint, else null. */
  hint: string | null;
}

interface RequestControlOptions {
  source: TelemetrySource;
  nodeKey: string;
  client: ApiClient | null;
  needsLogin?: boolean;
  /** Handle a failed POST before the default toast; return true when handled. */
  onError?: (err: unknown) => boolean;
}

/**
 * The request button's state and action, shared by the panel's log column
 * and callers that place the button elsewhere (My radio's action row). One
 * request per node, and mesh requests queue behind another node's: the
 * companion firmware keeps one pending request per radio. A self read over
 * BLE/USB takes no radio lock, so it is never blocked by another node.
 */
export function useTelemetryRequest({
  source,
  nodeKey,
  client,
  needsLogin,
  onError,
}: RequestControlOptions): TelemetryRequestControl {
  const inFlight = useTelemetryInFlight(nodeKey);
  const radioBusy = useRadioBusy();
  const setTelemetrySelected = useStore((s) => s.setTelemetrySelected);
  // The POST is out but main's in-flight push hasn't landed yet: without
  // this a fast second click would send again.
  const [posting, setPosting] = useState(false);
  const copy = TELEMETRY_COPY[source];
  const busy = !!inFlight || posting;
  const blockedByOther = source !== 'companion' && radioBusy && !busy;

  const request = async () => {
    if (!client || busy || blockedByOther) return;
    // Unpin, so the loading card and then the new request take the right side.
    setTelemetrySelected(nodeKey, null);
    setPosting(true);
    try {
      await requestTelemetryOnce(client, nodeKey, source, onError);
    } finally {
      setPosting(false);
    }
  };

  return {
    request,
    inFlight,
    blockedByOther,
    disabled: !client || busy || blockedByOther,
    label: busy ? copy.busy : copy.action,
    hint: blockedByOther ? RADIO_BUSY_HINT : needsLogin ? LOGIN_HINT : null,
  };
}

/** The header's "12 s ago · 1.8 s round trip · …", on its own clock so the panel doesn't redraw every second. */
function RequestMeta({ request }: { request: SavedRequestDto }) {
  const fresh = Date.now() - request.requestedAt < MINUTE;
  const now = useNowTick(fresh ? 1_000 : 30_000);
  return <span className={cn(META, 'text-cs-text-muted')}>{requestMetaLine(request, now)}</span>;
}

/** The older-request notice, when the request isn't the newest or has aged past an hour. Ticks per minute. */
function OlderNotice({ request, newest, actionLabel }: { request: SavedRequestDto; newest: boolean; actionLabel: string }) {
  const now = useNowTick(MINUTE);
  if (newest && now - request.requestedAt <= OLDER_AFTER_MS) return null;
  return <TelemetryOlderRequest requestedAt={request.requestedAt} actionLabel={actionLabel} now={now} />;
}

interface DetailProps {
  request: SavedRequestDto;
  requests: readonly SavedRequestDto[];
  source: TelemetrySource;
  client: ApiClient | null;
  nodeKey: string;
  nodeName?: string;
  headingLevel: HeadingLevel;
  onRequest: () => void;
  retryBlockedHint: string | null;
  needsLogin?: boolean;
  onLogIn?: () => void;
  advertPosition?: LatLon | null;
  canResetPath?: boolean;
  selfTile?: ReactNode;
}

/** One saved request: header and actions, grants, the state notes, a card per channel, and the raw payload. */
function RequestDetail({
  request,
  requests,
  source,
  client,
  nodeKey,
  nodeName,
  headingLevel,
  onRequest,
  retryBlockedHint,
  needsLogin,
  onLogIn,
  advertPosition,
  canResetPath,
  selfTile,
}: DetailProps) {
  const timeFormat = useStore((s) => s.appSettings.timeFormat);
  const setTelemetryCompare = useStore((s) => s.setTelemetryCompare);
  const ok = request.outcome === 'ok';

  const groups = useMemo(
    () => (ok ? describeChannels(request.readings, request.source) : []),
    [ok, request.readings, request.source],
  );
  // Previous values come from the list already held (it is the whole stored
  // history, up to retention), so no detail GET is needed.
  const previous = useMemo(
    () => previousByOffset(request.readings, previousForRequest(requests, request)),
    [requests, request],
  );
  // The inspector lists records in byte order; describeChannels groups by channel.
  const described = useMemo(
    () => groups.flatMap((g) => g.readings).sort((a, b) => a.reading.offset - b.reading.offset),
    [groups],
  );
  const gps = useMemo(() => {
    const v = request.readings.find((r) => r.ch === 1 && isGpsValue(r.value))?.value;
    return v && isGpsValue(v) ? v : null;
  }, [request.readings]);

  const comparePair = useMemo(() => compareWithPreviousIds(requests, request.id), [requests, request.id]);
  const newest = requests[0]?.id === request.id;
  const companion = source === 'companion';
  const copy = TELEMETRY_COPY[source];
  const Heading = `h${headingLevel}` as const;
  const guest = ok && request.aclRole === 'guest';
  const envGranted = request.permsGranted === null || (request.permsGranted & TELEM_PERM_ENVIRONMENT) !== 0;
  // Nothing but base and location readings. Not "nothing past ch 1": a
  // T1000-E reports its luminosity and temperature on ch 1 (DECISIONS fact 3).
  const noSensors = ok && !guest && envGranted && groups.every((g) => g.ch === 1 && g.readings.every(isBaseOrLocation));
  const deleteLabel = `Delete this ${copy.noun}`;

  const onDelete = async () => {
    if (!client) return;
    try {
      await api.deleteTelemetryRequest(client, request.id);
      // The telemetryDeleted push does the same; this keeps the view right if it's lost.
      useStore.getState().applyTelemetryDeleted({ nodeKey, ids: [request.id] });
      notify.success(`${capitalise(copy.noun)} deleted`);
    } catch (err) {
      notify.error(`Deleting ${copy.noun} failed: ${(err as Error).message}`, err);
    }
  };

  const onResetToFlood = async () => {
    if (!client) return;
    try {
      await api.resetContactPath(client, `c:${telemetryNodeKey(nodeKey) ?? nodeKey}`);
      notify.success('Reset to flood');
    } catch (err) {
      notify.error(`Reset to flood failed: ${(err as Error).message}`, err);
    }
  };

  const onViewOnMap = gps
    ? () => {
        useStore.getState().setActiveKey('tool:map');
        publishMapBus({ kind: 'flyTo', lng: gps.lon, lat: gps.lat, zoom: 12 });
      }
    : undefined;

  return (
    <>
      <div className="flex flex-wrap items-start gap-3">
        <div className="flex min-w-0 flex-col gap-0.75">
          <Heading className="text-[14px] font-semibold leading-5 text-cs-text">
            {fmtDateTime(request.requestedAt, timeFormat)}
          </Heading>
          <RequestMeta request={request} />
        </div>
        <div className="ml-auto flex gap-2">
          <TelemetryButton
            onClick={() => setTelemetryCompare(nodeKey, comparePair)}
            disabled={!ok || comparePair.length < 2}
            title={ok && comparePair.length < 2 ? 'No earlier reply to compare with' : undefined}
          >
            Compare with previous
          </TelemetryButton>
          <TelemetryButton aria-label={deleteLabel} title={deleteLabel} onClick={() => void onDelete()} disabled={!client}>
            <Trash2 aria-hidden="true" />
          </TelemetryButton>
        </div>
      </div>

      {ok && !companion && <PermissionChips permsGranted={request.permsGranted} aclRole={request.aclRole} />}
      {ok && <OlderNotice request={request} newest={newest} actionLabel={copy.action} />}

      {!ok && (
        <TelemetryFailed
          request={request}
          title={copy.failedTitle}
          failedLabel={copy.failed}
          onRetry={onRequest}
          retryBlockedHint={retryBlockedHint}
          onResetToFlood={!companion && canResetPath ? () => void onResetToFlood() : undefined}
          // A repeater outside the ACL just doesn't answer: only a timeout points at the login.
          onLogIn={needsLogin && request.outcome === 'timeout' ? onLogIn : undefined}
        />
      )}

      {groups.map((g) => (
        <TelemetryGroup
          key={g.ch}
          group={g}
          previous={previous}
          showPermission={!companion && request.permsGranted !== null}
          advertPosition={advertPosition}
          onViewOnMap={onViewOnMap}
          extraTile={g.ch === 1 ? selfTile : undefined}
        />
      ))}

      {guest && <TelemetryGuest onLogIn={onLogIn} />}
      {/* The tiles above already show ch 1; the card only needs it for its "Battery only." wording. */}
      {noSensors && <TelemetryNoSensors readings={groups[0]?.readings} hideRows />}

      {/* Keyed so a new selection starts collapsed again. */}
      {request.rawHex && (
        <LppInspector key={request.id} rawHex={request.rawHex} readings={described} restHex={request.restHex} />
      )}

      <div className="flex justify-end pt-1">
        <ClearSavedRequests client={client} nodeKey={nodeKey} count={requests.length} nodeName={nodeName} noun={copy.noun} />
      </div>
    </>
  );
}

/**
 * Source-aware telemetry screen. Repeater/sensor admin and My radio mount it
 * with their node; it loads the node's saved requests, keeps the request
 * button gated (one request per node, and one mesh request per radio), and
 * switches the right side between the selected request and the compare view.
 */
export function TelemetryPanel({
  source,
  nodeKey,
  client,
  nodeName,
  target,
  needsLogin,
  onLogIn,
  advertPosition,
  canResetPath,
  showLog = true,
  requestInLog = true,
  empty,
  selfTile,
  children,
  onRequestError,
  headingLevel = 2,
}: TelemetryPanelProps) {
  useEnsureTelemetryLoaded(client, nodeKey);
  const requests = useTelemetryRequests(nodeKey);
  const loaded = useTelemetryLoaded(nodeKey);
  const selected = useSelectedTelemetryRequest(nodeKey);
  const compareIds = useTelemetryCompare(nodeKey);
  const control = useTelemetryRequest({ source, nodeKey, client, needsLogin, onError: onRequestError });
  const { inFlight, blockedByOther, hint } = control;
  const retention = useTelemetryRetention();
  const key = telemetryNodeKey(nodeKey);
  // Whether the user picked a request (vs. the newest shown by default).
  const pinned = useStore((s) => (key ? s.telemetrySelectedId[key] !== undefined : false));
  const setTelemetrySelected = useStore((s) => s.setTelemetrySelected);
  const setTelemetryCompare = useStore((s) => s.setTelemetryCompare);
  const toggleTelemetryCompare = useStore((s) => s.toggleTelemetryCompare);

  const copy = TELEMETRY_COPY[source];
  const nouns = telemetryNoun(source, 2);
  const retryBlockedHint = inFlight ? copy.busy : blockedByOther ? RADIO_BUSY_HINT : null;
  const comparing = compareIds !== null;
  const okCount = useMemo(() => requests.filter((r) => r.outcome === 'ok').length, [requests]);
  const onRequest = control.request;

  const onCompare = () => {
    const seed = selected?.outcome === 'ok' ? compareWithPreviousIds(requests, selected.id) : [];
    setTelemetryCompare(nodeKey, seed);
  };

  // The control that switches modes (Compare, Compare with previous, Done)
  // unmounts with the view it sat in. Don't strand keyboard focus on <body>:
  // land on the control that switches back.
  const doneRef = useRef<HTMLButtonElement>(null);
  const compareRef = useRef<HTMLButtonElement>(null);
  const detailRef = useRef<HTMLElement>(null);
  const wasComparing = useRef(comparing);
  useEffect(() => {
    if (wasComparing.current === comparing) return;
    wasComparing.current = comparing;
    const active = document.activeElement;
    if (active && active !== document.body) return;
    (comparing ? doneRef.current : (compareRef.current ?? detailRef.current))?.focus();
  }, [comparing]);

  return (
    // A container query reads the nearest ANCESTOR container, so the row
    // switch below needs this wrapper.
    <div className="@container h-full min-h-0">
      <div className="flex h-full min-h-0 flex-col @2xl:flex-row">
        {(showLog || comparing) && (
          <section
            aria-label={`Telemetry ${nouns}`}
            className="flex max-h-[45%] min-h-0 shrink-0 flex-col border-b border-cs-border bg-cs-bg @2xl:max-h-none @2xl:w-[270px] @2xl:border-r @2xl:border-b-0"
          >
            {requestInLog && (
              <div className="flex flex-col gap-2 border-b border-cs-border px-3.5 pt-3.5 pb-3">
                <TelemetryButton
                  variant="primary"
                  onClick={() => void onRequest()}
                  disabled={control.disabled}
                  title={hint ?? undefined}
                  className="h-8 justify-center"
                >
                  {source === 'companion' ? <RefreshCw aria-hidden="true" /> : <Send aria-hidden="true" />}
                  {control.label}
                </TelemetryButton>
                {hint && (
                  <p data-testid="telemetry-request-hint" className={cn(META, 'text-cs-text-muted')}>
                    {hint}
                  </p>
                )}
              </div>
            )}

            {comparing ? (
              <div className="flex items-center gap-2 border-b border-cs-border bg-cs-accent-soft/[0.18] px-3.5 py-2">
                <span className="text-[12px] font-medium text-cs-text">{compareIds.length} selected</span>
                {compareIds.length >= COMPARE_MAX_COLUMNS && <span className={META}>max {COMPARE_MAX_COLUMNS}</span>}
                <button
                  ref={doneRef}
                  type="button"
                  onClick={() => setTelemetryCompare(nodeKey, null)}
                  className={cn(LINK, 'ml-auto')}
                >
                  Done
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2 border-b border-cs-border px-3.5 py-2">
                <span className={LABEL_MONO}>{capitalise(nouns)}</span>
                <span className={cn(META, 'ml-auto')}>{requests.length} saved</span>
              </div>
            )}

            <div className="min-h-0 flex-1 overflow-y-auto">
              {!loaded && requests.length === 0 ? (
                <div
                  role="status"
                  aria-busy="true"
                  aria-label={`Loading saved ${nouns}`}
                  className="flex flex-col gap-3 px-3.5 py-3"
                >
                  {[0, 1, 2].map((i) => (
                    <div key={i} className="flex flex-col gap-1.5">
                      <Skeleton className="h-3 w-3/5 rounded" />
                      <Skeleton className="h-2.5 w-4/5 rounded" />
                    </div>
                  ))}
                </div>
              ) : requests.length === 0 ? (
                <p className={cn(META, 'px-3.5 py-3')}>No saved {nouns}</p>
              ) : (
                <TelemetryRequestList
                  requests={requests}
                  selectedId={selected?.id ?? null}
                  onSelect={(id) => setTelemetrySelected(nodeKey, id)}
                  mode={comparing ? 'compare' : 'select'}
                  compareIds={compareIds ?? undefined}
                  maxCompare={COMPARE_MAX_COLUMNS}
                  onToggleCompare={(id) => toggleTelemetryCompare(nodeKey, id)}
                  label={`Saved ${nouns}`}
                />
              )}
            </div>

            <div className="flex items-center gap-2 border-t border-cs-border px-3.5 py-2.5">
              {comparing ? (
                <span className={META}>failed {nouns} can’t be compared</span>
              ) : (
                <>
                  <span className={META}>keeps the last {retention} per node</span>
                  <button
                    ref={compareRef}
                    type="button"
                    onClick={onCompare}
                    disabled={okCount === 0}
                    className={cn(LINK, 'ml-auto')}
                  >
                    Compare
                  </button>
                </>
              )}
            </div>
          </section>
        )}

        <section
          ref={detailRef}
          tabIndex={-1}
          aria-label={`Selected ${copy.noun}`}
          className="@container flex min-h-0 min-w-0 flex-1 flex-col outline-none"
        >
          {comparing ? (
            <TelemetryCompare
              nodeKey={nodeKey}
              source={source}
              client={client}
              requests={requests}
              compareIds={compareIds}
              nodeName={nodeName}
              headingLevel={headingLevel}
            />
          ) : (
            <div className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto px-5 py-4.5">
              {inFlight && (
                <TelemetryLoading title={copy.pending} startedAt={inFlight.startedAt} deadlineAt={inFlight.deadlineAt} />
              )}
              {selected && (!inFlight || pinned) ? (
                <RequestDetail
                  request={selected}
                  requests={requests}
                  source={source}
                  client={client}
                  nodeKey={nodeKey}
                  nodeName={nodeName}
                  headingLevel={headingLevel}
                  onRequest={() => void onRequest()}
                  retryBlockedHint={retryBlockedHint}
                  needsLogin={needsLogin}
                  onLogIn={onLogIn}
                  advertPosition={advertPosition}
                  canResetPath={canResetPath}
                  selfTile={selfTile}
                />
              ) : (
                !inFlight &&
                loaded &&
                (empty ?? (
                  <TelemetryEmpty
                    actionLabel={copy.action}
                    target={target ?? copy.target}
                    hint={
                      needsLogin ? (
                        <>
                          {LOGIN_HINT}.
                          {onLogIn && (
                            <>
                              {' '}
                              <button type="button" onClick={onLogIn} className={LINK}>
                                Log in
                              </button>
                            </>
                          )}
                        </>
                      ) : undefined
                    }
                  />
                ))
              )}
              {children}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
