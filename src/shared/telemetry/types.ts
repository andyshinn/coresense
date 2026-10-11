import type { RepeaterAclRole } from '../types/repeater';
import type { Reading } from './lpp';

/** Who the request went to. Only TelemetryPanel cares; groups, tiles and rows don't. */
export type TelemetrySource = 'repeater' | 'contact' | 'companion';

/**
 * `ok` includes guest (base-only) replies: the UI derives "base only" from
 * `aclRole === 'guest'`. Timeouts, disconnects and RESP_ERR are saved;
 * failures before anything was sent are not.
 */
export type TelemetryOutcome = 'ok' | 'timeout' | 'error';

/** `local` = companion self read over BLE/USB/TCP (no airtime). */
export type TelemetryRoute = 'direct' | 'flood' | 'local';

/** TELEM_PERM_* bits (MeshCore src/helpers/SensorManager.h). */
export const TELEM_PERM_BASE = 0x01;
export const TELEM_PERM_LOCATION = 0x02;
export const TELEM_PERM_ENVIRONMENT = 0x04;

/** Retention: one global per-node count in AppSettings. */
export const TELEMETRY_RETENTION_DEFAULT = 50;
export const TELEMETRY_RETENTION_BOUNDS = { min: 1, max: 500 } as const;

/**
 * One saved telemetry request, as main stores it. `raw` is the LPP payload
 * exactly as received (padding included) and is the source of truth: the
 * decoded readings are derived, so saved requests re-decode if the decoder
 * improves. Over HTTP/WS this travels as {@link SavedRequestDto}.
 */
export interface SavedRequest {
  id: string;
  /** Bare lowercase 64-hex public key; the owner's own key for companion reads. */
  nodeKey: string;
  source: TelemetrySource;
  /** Epoch ms, when the user clicked. */
  requestedAt: number;
  repliedAt: number | null;
  outcome: TelemetryOutcome;
  error?: string;
  roundTripMs: number | null;
  /** Path length used; null for companion reads. */
  hops: number | null;
  route: TelemetryRoute | null;
  /** Login role at request time (repeaters/rooms); null when unknown or not applicable. */
  aclRole: RepeaterAclRole | null;
  /** Inferred TELEM_PERM_* mask (the reply carries none); null when unknown. */
  permsGranted: number | null;
  /** LPP payload; null when no reply. */
  raw: Uint8Array | null;
}

/** JSON-safe wire form of a SavedRequest, with the decode attached. */
export interface SavedRequestDto extends Omit<SavedRequest, 'raw'> {
  /** Lowercase hex of `raw`; null when no reply. */
  rawHex: string | null;
  /** decodeLpp(raw).readings; empty when no reply. */
  readings: Reading[];
  /** Lowercase hex of the undecoded tail; '' when fully decoded (padding is not rest). */
  restHex: string;
}

/** The most recent earlier `ok` request that held a reading with the same key. */
export interface PreviousReading {
  reading: Reading;
  requestedAt: number;
  requestId: string;
}

/** GET /api/telemetry/request/:id. `previous[i]` belongs to `readings[i]`. */
export interface RequestDetailDto extends SavedRequestDto {
  previous: Array<PreviousReading | null>;
}

/** One pending request; `deadlineAt` is null until the radio's estimate is known. */
export interface TelemetryInFlight {
  nodeKey: string;
  source: TelemetrySource;
  startedAt: number;
  deadlineAt: number | null;
}

export interface TelemetrySavedPayload {
  request: SavedRequestDto;
}

export interface TelemetryDeletedPayload {
  nodeKey: string;
  ids: string[] | 'all';
}

/** Full snapshot every time, never a delta. */
export interface TelemetryInFlightPayload {
  inFlight: TelemetryInFlight[];
}
