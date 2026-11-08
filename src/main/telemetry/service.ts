// Telemetry request orchestration: one button press → one SavedRequest.
//
// Every attempt that reached the radio is saved — replies, timeouts and errors
// alike — so the history shows what actually happened. Failures BEFORE
// anything was sent (offline, contact not on the radio, library too old) are
// statuses for the route to turn into 503/422/501, and are not saved.
//
// Like state/advertPath.ts, requestTelemetry() never rejects: everything is a
// status. A second request for a node that already has one in flight joins it
// and gets the same result rather than sending again; a request while another
// mesh request holds the radio (meshLock.ts) is refused as `busy`.

import { randomBytes, randomUUID } from 'node:crypto';
import { toSavedRequestDto } from '../../shared/telemetry/dto';
import { bytesToHex, decodeLpp } from '../../shared/telemetry/lpp';
import { previousForRequest } from '../../shared/telemetry/previous';
import {
  type RequestDetailDto,
  type SavedRequest,
  type SavedRequestDto,
  type SelfLiveReadDto,
  TELEM_PERM_BASE,
  TELEM_PERM_ENVIRONMENT,
  TELEM_PERM_LOCATION,
  type TelemetryInFlight,
  type TelemetryOutcome,
  type TelemetryRoute,
  type TelemetrySource,
} from '../../shared/telemetry/types';
import type { Contact, RepeaterAclRole } from '../../shared/types';
import { adminSessions } from '../bridge/adminSession';
import { emit } from '../events/bus';
import { child } from '../log';
import { recordLiveRead } from '../node/nodeCache';
import { protocolSession } from '../protocol';
import { noteHeard } from '../state/contactSync';
import { stateHolder } from '../state/holder';
import { telemetryStore } from '../storage/telemetry';
import { transportManager } from '../transport/manager';
import { type MeshLockHolder, meshLockHolder, tryAcquireMeshLock } from './meshLock';
import { telemetryRetention } from './retention';

const log = child('telemetry');

/** Firmware REQ_TYPE_GET_TELEMETRY_DATA. */
const REQ_TYPE_GET_TELEMETRY = 0x03;
/** Deadline from the click while the radio hasn't reported RESP_SENT yet: a
 *  backstop, since RESP_SENT normally lands well inside it and replaces it
 *  with the radio's own estimate. The figure the mockups were drawn against. */
export const TELEMETRY_FALLBACK_DEADLINE_MS = 15_000;
/** Slack on top of the radio's own reply estimate once RESP_SENT reports it. */
export const TELEMETRY_SENT_MARGIN_MS = 2_000;
/** Self reads are a local command with no airtime; the library's default. */
export const TELEMETRY_SELF_TIMEOUT_MS = 5_000;
/** The library's own reply wait; we enforce the deadline by aborting. Only a
 *  backstop for an abort that never lands: long enough
 *  to outlast the slowest flood estimate firmware gives (~50 s on the slowest
 *  presets), short enough not to strand a reply tag for minutes. */
const LIB_REPLY_BACKSTOP_MS = 90_000;
const ALL_PERMS = TELEM_PERM_BASE | TELEM_PERM_LOCATION | TELEM_PERM_ENVIRONMENT;

export type TelemetryRequestResult =
  /** The request ran and was saved, whatever its outcome. */
  | { status: 'saved'; request: SavedRequestDto }
  /** No radio attached. Nothing was sent. */
  | { status: 'offline' }
  /** The radio doesn't store this contact (or has no full key for it). */
  | { status: 'notOnRadio' }
  /** Another mesh request holds the radio. */
  | { status: 'busy'; holder: MeshLockHolder }
  /** An internal failure before a result could be saved. */
  | { status: 'failed'; message: string };

interface InFlightEntry {
  info: TelemetryInFlight;
  promise: Promise<TelemetryRequestResult>;
}

const inFlight = new Map<string, InFlightEntry>();

/** Every pending request, oldest first. Also served in the app snapshot. */
export function telemetryInFlightSnapshot(): TelemetryInFlight[] {
  return [...inFlight.values()].map((e) => ({ ...e.info }));
}

function publishInFlight(): void {
  emit.telemetryInFlight({ inFlight: telemetryInFlightSnapshot() });
}

/** Test seam: forget every in-flight entry (their timers just run out). */
export function resetTelemetryState(): void {
  inFlight.clear();
}

function isConnected(): boolean {
  return transportManager.getState().state === 'connected';
}

/** The library's teardown reasons (MeshCoreSession.tearDownConnection/stop).
 *  Checked as well as the transport state, because the library can reject its
 *  awaiters a beat before server.ts applies the new transport state. */
function isDisconnectError(message: string): boolean {
  return message === 'transport disconnected' || message === 'session stopped';
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** A rejection meaning the request never left: the library's own contact
 *  lookup failed (the radio dropped the contact between our check and the
 *  send). */
function isPreSendError(message: string): boolean {
  return message.startsWith('unknown contact') || message.includes('no full 32B public key');
}

function isTimeoutError(err: unknown, message: string): boolean {
  return (err instanceof Error && err.name === 'ProtocolTimeoutError') || /timed? ?out/i.test(message);
}

/** Request bytes as firmware's own sender builds them (companion
 *  CMD_SEND_PATH_DISCOVERY_REQ): type, the INVERTED permission mask (0x00 =
 *  ask for everything), 3 reserved bytes, 4 random bytes so two requests
 *  never share a packet hash. */
export function buildTelemetryReqData(): Uint8Array {
  const out = new Uint8Array(9);
  out[0] = REQ_TYPE_GET_TELEMETRY;
  out[1] = 0x00;
  out.set(randomBytes(4), 5);
  return out;
}

function findContact(nodeKey: string): Contact | null {
  return (
    stateHolder()
      .getContacts()
      .find((c) => c.publicKeyHex.toLowerCase() === nodeKey) ?? null
  );
}

function sourceFor(contact: Contact | null): TelemetrySource {
  return contact?.kind === 'chat' || !contact ? 'contact' : 'repeater';
}

/** The login role at request time, from the admin session the login route
 *  mirrored. The ACL byte is authoritative; a reply without one (older
 *  firmware) still proves admin through isAdmin. */
function aclRoleFor(nodeKey: string): RepeaterAclRole | null {
  const s = adminSessions.getSession(`c:${nodeKey}`) ?? adminSessions.getSession(nodeKey);
  if (!s) return null;
  return s.aclRole ?? (s.role === 'admin' ? 'admin' : null);
}

/** B3: the reply carries no grant mask, so infer it. Repeaters and rooms
 *  answer guests with base only and every other role with everything; a
 *  sensor answers with everything; a chat contact's grants are unknowable. */
function permsFor(contact: Contact | null, aclRole: RepeaterAclRole | null): number | null {
  if (contact?.kind === 'sensor') return ALL_PERMS;
  if (contact?.kind !== 'repeater' && contact?.kind !== 'room') return null;
  if (aclRole === null) return null;
  return aclRole === 'guest' ? TELEM_PERM_BASE : ALL_PERMS;
}

/** Route and hops as the radio will use them, from the contact at click time:
 *  a stored out-path means direct, none means flood. */
function routeFor(contact: Contact | null): { route: TelemetryRoute | null; hops: number | null } {
  if (!contact) return { route: null, hops: null };
  if (contact.hops === undefined) return { route: 'flood', hops: null };
  return { route: 'direct', hops: contact.hops };
}

/**
 * Ask a node for telemetry, or read my own radio's when `nodeKey` is the
 * owner's key. `nodeKey` must already be normalised (bare lowercase 64-hex).
 * Resolves once the request finished and was saved, or with the reason
 * nothing was sent.
 */
export function requestTelemetry(nodeKey: string): Promise<TelemetryRequestResult> {
  const joined = inFlight.get(nodeKey);
  if (joined) return joined.promise;

  if (!isConnected()) return Promise.resolve({ status: 'offline' });
  const session = protocolSession();
  const ownerKey = stateHolder().getOwner()?.publicKeyHex.toLowerCase() ?? null;

  if (nodeKey === ownerKey) {
    // No mesh lock: a self read is a local command that never touches the
    // firmware's pending-request slot.
    const startedAt = Date.now();
    return track(
      { nodeKey, source: 'companion', startedAt, deadlineAt: startedAt + TELEMETRY_SELF_TIMEOUT_MS },
      null,
      (entry) => runSelf(entry),
    );
  }

  if (!session.hasRadioContact(`c:${nodeKey}`)) return Promise.resolve({ status: 'notOnRadio' });
  const release = tryAcquireMeshLock('telemetry', nodeKey);
  if (!release) return Promise.resolve({ status: 'busy', holder: meshLockHolder() as MeshLockHolder });
  const contact = findContact(nodeKey);
  const startedAt = Date.now();
  // The deadline is unknown (null) until RESP_SENT says how long the reply
  // should take.
  return track({ nodeKey, source: sourceFor(contact), startedAt, deadlineAt: null }, release, (entry) =>
    runRemote(entry, contact),
  );
}

/** Register an in-flight entry BEFORE the first await, so a second click in
 *  the same tick joins it; drop it, release the lock and re-publish once the
 *  run has saved and announced its result. */
function track(
  info: TelemetryInFlight,
  release: (() => void) | null,
  run: (entry: InFlightEntry) => Promise<TelemetryRequestResult>,
): Promise<TelemetryRequestResult> {
  const entry = { info } as InFlightEntry;
  inFlight.set(info.nodeKey, entry);
  publishInFlight();
  entry.promise = run(entry)
    .catch((err): TelemetryRequestResult => {
      // run() maps every library failure to an outcome; this is a bug guard so
      // a throw can't strand the lock or the in-flight entry.
      log.error(`telemetry request for ${info.nodeKey.slice(0, 12)} threw: ${errorMessage(err)}`);
      return { status: 'failed', message: errorMessage(err) };
    })
    .finally(() => {
      if (inFlight.get(info.nodeKey) === entry) inFlight.delete(info.nodeKey);
      release?.();
      publishInFlight();
    });
  return entry.promise;
}

/** The reply's round trip; for a timeout, how long it waited ("no reply in
 *  15 s"); null for any other failure. */
function roundTripFor(
  outcome: TelemetryOutcome,
  startedAt: number,
  repliedAt: number | null,
  settledAt: number,
): number | null {
  if (repliedAt !== null) return repliedAt - startedAt;
  return outcome === 'timeout' ? settledAt - startedAt : null;
}

type Settled = { kind: 'reply'; raw: Uint8Array; at: number } | { kind: 'deadline' } | { kind: 'rejected'; err: unknown };

async function runRemote(entry: InFlightEntry, contact: Contact | null): Promise<TelemetryRequestResult> {
  const { nodeKey, startedAt } = entry.info;
  const session = protocolSession();
  const aclRole = aclRoleFor(nodeKey);
  let { route, hops } = routeFor(contact);
  const ctrl = new AbortController();

  const settled = await new Promise<Settled>((resolve) => {
    let done = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (s: Settled) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(s);
    };
    // `publish` false arms the timer without announcing a deadline: the
    // fallback below, which stands in for a figure the radio hasn't given yet.
    const armDeadline = (at: number, publish = true) => {
      if (done) return;
      clearTimeout(timer);
      if (publish && entry.info.deadlineAt !== at) {
        entry.info.deadlineAt = at;
        publishInFlight();
      }
      timer = setTimeout(
        () => {
          // The library releases the reply tag on abort, so a late reply is dropped.
          ctrl.abort();
          finish({ kind: 'deadline' });
        },
        Math.max(0, at - Date.now()),
      );
    };
    // Armed unannounced (deadlineAt stays null) until onSent replaces it, so a
    // RESP_SENT that never comes can't hold the radio for the library's whole
    // backstop.
    armDeadline(startedAt + TELEMETRY_FALLBACK_DEADLINE_MS, false);
    session
      .sendBinaryRequest(`c:${nodeKey}`, buildTelemetryReqData(), {
        timeoutMs: LIB_REPLY_BACKSTOP_MS,
        signal: ctrl.signal,
        onSent: ({ flood, estTimeoutMs }) => {
          // The radio's own answer beats the click-time guess.
          route = flood ? 'flood' : 'direct';
          if (flood) hops = null;
          armDeadline(Date.now() + estTimeoutMs + TELEMETRY_SENT_MARGIN_MS);
        },
      })
      .then(
        (raw) => finish({ kind: 'reply', raw, at: Date.now() }),
        (err: unknown) => finish({ kind: 'rejected', err }),
      );
  });
  const settledAt = Date.now();

  let outcome: TelemetryOutcome;
  let error: string | undefined;
  if (settled.kind === 'reply') {
    outcome = 'ok';
    // A reply is a reception from this node — the last-heard bump the
    // retired repeaterTelemetry push used to provide.
    noteHeard(`c:${nodeKey}`);
  } else if (settled.kind === 'deadline') {
    if (isConnected()) {
      outcome = 'timeout';
    } else {
      outcome = 'error';
      error = 'disconnected';
    }
  } else {
    const message = errorMessage(settled.err);
    if (!isConnected() || isDisconnectError(message)) {
      outcome = 'error';
      error = 'disconnected';
    } else if (isPreSendError(message)) {
      return { status: 'notOnRadio' };
    } else if (isTimeoutError(settled.err, message)) {
      outcome = 'timeout';
      error = message;
    } else {
      // RESP_ERR (the library maps NOT_FOUND / TABLE_FULL to a rejection), a write
      // failure, or anything else the library reports.
      outcome = 'error';
      error = message;
    }
  }

  const repliedAt = settled.kind === 'reply' ? settled.at : null;
  return save({
    id: randomUUID(),
    nodeKey,
    source: entry.info.source,
    requestedAt: startedAt,
    repliedAt,
    outcome,
    ...(error !== undefined ? { error } : {}),
    roundTripMs: roundTripFor(outcome, startedAt, repliedAt, settledAt),
    hops,
    route,
    aclRole,
    permsGranted: permsFor(contact, aclRole),
    raw: settled.kind === 'reply' ? settled.raw : null,
  });
}

async function runSelf(entry: InFlightEntry): Promise<TelemetryRequestResult> {
  const { nodeKey, startedAt } = entry.info;
  let raw: Uint8Array | null = null;
  let outcome: TelemetryOutcome = 'ok';
  let error: string | undefined;
  try {
    raw = await protocolSession().requestSelfTelemetry({ timeoutMs: TELEMETRY_SELF_TIMEOUT_MS });
  } catch (err) {
    const message = errorMessage(err);
    if (!isConnected() || isDisconnectError(message)) {
      outcome = 'error';
      error = 'disconnected';
    } else if (isTimeoutError(err, message)) {
      outcome = 'timeout';
      error = message;
    } else {
      // Includes RESP_ERR from firmware without self telemetry ("unsupported").
      outcome = 'error';
      error = message;
    }
  }
  const settledAt = Date.now();
  const repliedAt = raw ? settledAt : null;
  return save({
    id: randomUUID(),
    nodeKey,
    source: 'companion',
    requestedAt: startedAt,
    repliedAt,
    outcome,
    ...(error !== undefined ? { error } : {}),
    roundTripMs: roundTripFor(outcome, startedAt, repliedAt, settledAt),
    hops: null,
    route: 'local',
    aclRole: null,
    permsGranted: ALL_PERMS,
    raw,
  });
}

/** Persist (best-effort, like the packet log: a bad write must not lose the
 *  result the user is waiting for) and announce. */
function save(req: SavedRequest): TelemetryRequestResult {
  let pruned: string[] = [];
  try {
    pruned = telemetryStore.insert(req, telemetryRetention(stateHolder().getAppSettings()));
  } catch (err) {
    log.warn(`telemetry persist failed: ${errorMessage(err)}`);
  }
  const request = toSavedRequestDto(req);
  emit.telemetrySaved({ request });
  if (pruned.length > 0) emit.telemetryDeleted({ nodeKey: req.nodeKey, ids: pruned });
  return { status: 'saved', request };
}

// ---- My Node live reads ------------------------------------------------------
//
// My Node polls the companion's own telemetry while its page is open. A poll
// is not a saved request: the history holds only what the user chose to keep.
// The latest read is held here so "Save snapshot" stores exactly the values
// on screen. It belongs to one radio and is only good while fresh: a read from
// a radio that has since disconnected, or one left over after polling paused
// (window hidden), is refused rather than saved under the wrong name or time.

/** A live read older than this can't be saved: two of My Node's 10 s polls. */
export const SELF_LIVE_MAX_AGE_MS = 20_000;

interface LiveRead {
  ownerKey: string;
  at: number;
  raw: Uint8Array;
  roundTripMs: number;
}

let lastLive: LiveRead | null = null;
let liveInFlight: Promise<SelfLiveResult> | null = null;

export type SelfLiveResult =
  | { status: 'ok'; read: SelfLiveReadDto }
  | { status: 'offline' }
  /** SELF_INFO hasn't named the radio yet. */
  | { status: 'noOwner' }
  /** Firmware without the self-telemetry branch (RESP_ERR UNSUPPORTED_CMD). */
  | { status: 'unsupported'; message: string }
  | { status: 'failed'; message: string };

function ownerKeyNow(): string | null {
  return stateHolder().getOwner()?.publicKeyHex.toLowerCase() ?? null;
}

/** Read the companion's own telemetry without saving it. A second call while
 *  one is pending joins it. Never rejects. */
export function readSelfLive(): Promise<SelfLiveResult> {
  if (liveInFlight) return liveInFlight;
  if (!isConnected()) return Promise.resolve({ status: 'offline' });
  const ownerKey = ownerKeyNow();
  if (!ownerKey) return Promise.resolve({ status: 'noOwner' });
  const startedAt = Date.now();
  liveInFlight = (async (): Promise<SelfLiveResult> => {
    try {
      const raw = await protocolSession().requestSelfTelemetry({ timeoutMs: TELEMETRY_SELF_TIMEOUT_MS });
      const at = Date.now();
      // Dropped if the link went down, or another radio came up, mid-read.
      if (!isConnected() || ownerKeyNow() !== ownerKey) return { status: 'offline' };
      lastLive = { ownerKey, at, raw, roundTripMs: at - startedAt };
      const rawHex = bytesToHex(raw);
      recordLiveRead(at, rawHex);
      return { status: 'ok', read: { at, rawHex, readings: decodeLpp(raw).readings } };
    } catch (err) {
      const message = errorMessage(err);
      if (!isConnected() || isDisconnectError(message)) return { status: 'offline' };
      if (/unsupported/i.test(message)) return { status: 'unsupported', message };
      return { status: 'failed', message };
    } finally {
      liveInFlight = null;
    }
  })();
  return liveInFlight;
}

/** Forget the held live read: the link dropped. */
export function clearSelfLiveRead(): void {
  lastLive = null;
}

export type SelfSnapshotResult =
  | { status: 'saved'; request: SavedRequestDto }
  /** Nothing read from the connected radio yet. */
  | { status: 'noLiveRead' }
  /** The held read is older than SELF_LIVE_MAX_AGE_MS. */
  | { status: 'stale'; ageMs: number };

/** Save the held live read as a companion request: the same history and
 *  format as every other saved telemetry request, holding exactly the values
 *  My Node showed. */
export function saveSelfSnapshot(now = Date.now()): SelfSnapshotResult {
  const live = lastLive;
  if (!live || !isConnected() || live.ownerKey !== ownerKeyNow()) return { status: 'noLiveRead' };
  const ageMs = now - live.at;
  if (ageMs > SELF_LIVE_MAX_AGE_MS) return { status: 'stale', ageMs };
  const result = save({
    id: randomUUID(),
    nodeKey: live.ownerKey,
    source: 'companion',
    requestedAt: live.at - live.roundTripMs,
    repliedAt: live.at,
    outcome: 'ok',
    roundTripMs: live.roundTripMs,
    hops: null,
    route: 'local',
    aclRole: null,
    permsGranted: ALL_PERMS,
    raw: live.raw,
  });
  if (result.status !== 'saved') return { status: 'noLiveRead' };
  return result;
}

/** Test seam. */
export function resetSelfLiveState(): void {
  lastLive = null;
  liveInFlight = null;
}

// ---- Reads and deletes ----------------------------------------------------

/** A node's saved requests, newest first, decoded. */
export function listTelemetry(nodeKey: string): SavedRequestDto[] {
  return telemetryStore.list(nodeKey).map(toSavedRequestDto);
}

/** One saved request plus, per reading, the most recent earlier `ok` request
 *  holding a reading with the same key (PLAN decision 5). */
export function getTelemetryDetail(id: string): RequestDetailDto | null {
  const req = telemetryStore.get(id);
  if (!req) return null;
  const dto = toSavedRequestDto(req);
  const history = telemetryStore.list(req.nodeKey).map(toSavedRequestDto);
  return { ...dto, previous: previousForRequest(history, dto) };
}

/** Delete one saved request. False when there was no such id. */
export function deleteTelemetryRequest(id: string): boolean {
  const removed = telemetryStore.delete(id);
  if (!removed) return false;
  emit.telemetryDeleted({ nodeKey: removed.nodeKey, ids: [id] });
  return true;
}

/** Delete every saved request for a node. */
export function clearTelemetry(nodeKey: string): void {
  telemetryStore.clear(nodeKey);
  emit.telemetryDeleted({ nodeKey, ids: 'all' });
}

/** Apply a retention change. Only a shrink does anything: every node is
 *  pruned at once rather than as each is next requested. */
export function applyTelemetryRetention(previous: number, next: number): void {
  if (next >= previous) return;
  for (const { nodeKey, ids } of telemetryStore.pruneAll(next)) emit.telemetryDeleted({ nodeKey, ids });
}
