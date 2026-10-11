// The radio is the source of truth for the companion telemetry policy (modes
// Base / Location / Environment, plus multi-acks, which shares the frame).
//
// coresense used to load the policy from telemetry-policy.json and never read
// it back from the radio, and every share-position or auto-add-mode save
// re-sent that JSON copy with CMD_SET_OTHER_PARAMS — quietly overwriting a
// policy set from another client or the firmware CLI. Now the holder is seeded
// from RESP_SELF_INFO on every connect, and a route that must re-send the
// policy asks radioTelemetryPolicy() first: it hands back the radio's value,
// reading it now if this connection hasn't yet, and null when it can't — the
// caller refuses rather than guess.
//
// meshcore-ts 0.8.1 parses the modes out of SELF_INFO but never folds them
// into its `telemetryPolicy` event (MESHCORE-TS-SPEC.md §3), hence the explicit
// getSelfInfo() read. Once 0.9 emits it, adapterEvents marks the policy known
// from the handshake's own SELF_INFO and radioTelemetryPolicy() skips the read.
//
// That read re-sends CMD_APP_START, and firmware's APP_START handler stops any
// contact walk in progress (`_iter_started = false`, companion_radio
// MyMesh.cpp): the remaining RESP_CONTACT frames and END_OF_CONTACTS never
// come, so the app keeps a truncated contact list and no reconcile runs. So the
// read is never issued while a walk streams (state/contactWalk.ts):
// radioTelemetryPolicy() refuses instead, and the connect-time seed waits for
// the walk's END_OF_CONTACTS.

import type { TelemetryPolicy } from '../../shared/types';
import { emit } from '../events/bus';
import { child } from '../log';
import { isContactWalkInFlight } from '../state/contactWalk';
import { stateHolder } from '../state/holder';

const log = child('telemetry');

/** The SELF_INFO fields carrying the policy (meshcore-ts `SelfInfo`). */
export interface SelfInfoPolicyFields {
  telemetryModeBase: number;
  telemetryModeLoc: number;
  telemetryModeEnv: number;
  multiAcks: number;
}

/** SELF_INFO byte 46's three 2-bit modes plus byte 44. CMD_SET_OTHER_PARAMS
 *  stores the raw 2 bits, so another client can leave a 3 there, and
 *  firmware's onContactRequest grants only for 2 (everyone) and 1 (per
 *  contact): 3 behaves as Deny, so it reads as Deny. Reading it as anything
 *  more permissive would also make the radio permissive on the next re-send. */
export function policyFromSelfInfo(info: SelfInfoPolicyFields): TelemetryPolicy {
  const mode = (m: number): 0 | 1 | 2 => (m === 1 ? 1 : m === 2 ? 2 : 0);
  return {
    base: mode(info.telemetryModeBase),
    loc: mode(info.telemetryModeLoc),
    env: mode(info.telemetryModeEnv),
    multiAcks: info.multiAcks,
  };
}

/** Validate a PUT /api/device/telemetry-policy body: any non-empty subset of
 *  the policy, each mode 0–2 and multi-acks a byte. Returns the error message
 *  for a 400 when it isn't one — anything else would go to the radio as-is
 *  (the library encodes a missing field as 0) and be trusted as its policy. */
export function parseTelemetryPolicyPatch(body: unknown): Partial<TelemetryPolicy> | string {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return 'invalid body';
  const b = body as Record<string, unknown>;
  const out: Partial<TelemetryPolicy> = {};
  for (const field of ['base', 'loc', 'env'] as const) {
    if (b[field] === undefined) continue;
    const v = b[field];
    if (v !== 0 && v !== 1 && v !== 2) return `${field} must be 0, 1 or 2`;
    out[field] = v;
  }
  if (b.multiAcks !== undefined) {
    const v = b.multiAcks;
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v > 255) return 'multiAcks must be an integer 0–255';
    out.multiAcks = v;
  }
  if (Object.keys(out).length === 0) return 'one of base, loc, env or multiAcks is required';
  return out;
}

/** True once this connection has a radio-confirmed policy. */
let known = false;
let seeding: Promise<TelemetryPolicy | null> | null = null;
/** Bumped by every forget, so a read that straddles a disconnect is dropped. */
let generation = 0;

export function isRadioTelemetryPolicyKnown(): boolean {
  return known;
}

/** Record that the holder now matches the radio — a value read back, or one
 *  the radio just accepted. */
export function markRadioTelemetryPolicyKnown(): void {
  known = true;
}

/** Forget it: the link dropped, and the next radio may hold anything. */
export function forgetRadioTelemetryPolicy(): void {
  known = false;
  seeding = null;
  generation++;
}

/** Read the policy off the radio and publish it (holder + WS). Concurrent
 *  callers share one read. Never rejects: null means the read failed, which is
 *  logged. */
export function seedTelemetryPolicyFromRadio(read: () => Promise<TelemetryPolicy>): Promise<TelemetryPolicy | null> {
  if (seeding) return seeding;
  const gen = generation;
  const run = (async (): Promise<TelemetryPolicy | null> => {
    try {
      const policy = await read();
      // A disconnect mid-read forgot the seed; don't let the stale answer
      // claim the next connection.
      if (gen !== generation) return null;
      stateHolder().setTelemetryPolicy(policy);
      emit.telemetryPolicy(policy);
      known = true;
      return policy;
    } catch (err) {
      log.warn(`telemetry policy read-back failed: ${(err as Error).message}`);
      return null;
    }
  })();
  const shared = run.finally(() => {
    if (seeding === shared) seeding = null;
  });
  seeding = shared;
  return shared;
}

/** The policy the radio holds, for a route about to re-send it (or the
 *  connect-time seed). Reads it now when this connection hasn't yet; null when
 *  that read fails, or when it would have to go out mid contact walk (see the
 *  header) — the caller refuses rather than guess. */
export async function radioTelemetryPolicy(read: () => Promise<TelemetryPolicy>): Promise<TelemetryPolicy | null> {
  if (known) return stateHolder().getTelemetryPolicy();
  if (isContactWalkInFlight()) return null;
  return seedTelemetryPolicyFromRadio(read);
}
