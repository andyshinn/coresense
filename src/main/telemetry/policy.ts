// The radio is the source of truth for the companion telemetry policy (modes
// Base / Location / Environment, plus multi-acks, which shares the frame).
//
// coresense used to load the policy from telemetry-policy.json and never read
// it back from the radio, and every share-position or auto-add-mode save
// re-sent that JSON copy with CMD_SET_OTHER_PARAMS — quietly overwriting a
// policy set from another client or the firmware CLI. Now the library folds
// every RESP_SELF_INFO into its `telemetryPolicy` event, which adapterEvents
// commits and marks known, so the handshake's own SELF_INFO seeds the holder on
// every connect. A route that must re-send the policy asks
// radioTelemetryPolicy() first: it hands back the radio's value, reading it
// with getSelfInfo() if this connection somehow hasn't yet, and null when it
// can't — the caller refuses rather than guess.
//
// That fallback read re-sends CMD_APP_START, and firmware's APP_START handler
// stops any contact walk in progress (`_iter_started = false`, companion_radio
// MyMesh.cpp): the remaining RESP_CONTACT frames and END_OF_CONTACTS never
// come, so the app keeps a truncated contact list and no reconcile runs. So the
// read is never issued while a walk streams (state/contactWalk.ts): a route
// that needs it mid walk waits for the walk's END_OF_CONTACTS first.

import type { TelemetryPolicy } from '../../shared/types';
import { emit } from '../events/bus';
import { child } from '../log';
import { contactWalkEnded, isContactWalkInFlight } from '../state/contactWalk';
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

/** The policy the radio holds, for a route about to re-send it. Reads it now
 *  when this connection hasn't yet — first waiting out a contact walk in
 *  flight (see the header). Null when that read fails or the link drops while
 *  waiting — the caller refuses rather than guess. */
export async function radioTelemetryPolicy(read: () => Promise<TelemetryPolicy>): Promise<TelemetryPolicy | null> {
  const gen = generation;
  while (!known && isContactWalkInFlight()) {
    await contactWalkEnded();
    if (gen !== generation) return null;
  }
  if (known) return stateHolder().getTelemetryPolicy();
  return seedTelemetryPolicyFromRadio(read);
}
