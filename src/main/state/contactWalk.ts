/** Tracking for a CMD_GET_CONTACTS *walk* — the radio streaming its entire
 *  contact store at us, one RESP_CONTACT frame at a time.
 *
 *  Two walks must never overlap. meshcore-ts keeps ONE global contacts iterator:
 *  RESP_CONTACTS_START clears its `syncSeen` list, and RESP_END_OF_CONTACTS
 *  reconciles the radio's contents against whatever is in that list, calling
 *  `removeContact()` for every contact missing from it. So if walk #2 starts
 *  before walk #1 ends, walk #1's END_OF_CONTACTS deletes every contact walk #2
 *  hasn't reached yet — and coresense then persists that truncated list
 *  (applyLibContacts → holder.setContacts) and flips on_radio off for the rest
 *  of the pool on the next `contactsSynced`.
 *
 *  `getContacts()` RESOLVING is not proof that the walk finished. The library
 *  arms its END_OF_CONTACTS waiter with a 10s timeout that RESOLVES rather than
 *  rejects, so on any radio whose walk runs longer than that (~200+ contacts at
 *  the ~50ms/frame we measured) the call returns mid-stream with the previous
 *  list. The only honest "it finished" signal is RESP_END_OF_CONTACTS, which
 *  reaches us as the lib's `contactsSynced` event.
 *
 *  This lives in its own dependency-free module because both ends need it: the
 *  refresh entry point (state/contactRefresh.ts) reads it to refuse a second
 *  walk, and the session wiring (protocol/adapterEvents.ts) writes it from the
 *  frames themselves. Putting it in either would close an import cycle.
 */

/** Longest we hold the guard without hearing END_OF_CONTACTS. A 500-contact
 *  radio walks in ~25s, so this is far past any plausible real walk; it exists
 *  only so a radio that stops streaming mid-list can't wedge the refresh button
 *  into "already syncing" for the rest of the session. */
export const CONTACT_WALK_STALE_MS = 120_000;

let inFlight = false;
/** Have we seen an actual contact frame since this walk began? Distinguishes
 *  "the radio is streaming and just hasn't finished" from "the request went
 *  nowhere" (a dead link resolves the lib's waiters by timeout too). */
let streaming = false;
let staleTimer: ReturnType<typeof setTimeout> | null = null;

function armStaleTimer(): void {
  if (staleTimer) clearTimeout(staleTimer);
  staleTimer = setTimeout(endContactWalk, CONTACT_WALK_STALE_MS);
  staleTimer.unref?.();
}

/** We have just asked the radio for its contact list. */
export function beginContactWalk(): void {
  inFlight = true;
  streaming = false;
  armStaleTimer();
}

/** A RESP_CONTACT frame arrived — the radio is mid-walk right now. Also covers
 *  a walk we did NOT start (the handshake's), whose own END_OF_CONTACTS waiter
 *  can time out and flip syncProgress.phase to 'done' while frames keep coming. */
export function noteContactWalkStreaming(): void {
  inFlight = true;
  streaming = true;
  armStaleTimer();
}

/** The walk is over: RESP_END_OF_CONTACTS, a failed request, or a dropped link. */
export function endContactWalk(): void {
  inFlight = false;
  streaming = false;
  if (staleTimer) {
    clearTimeout(staleTimer);
    staleTimer = null;
  }
}

/** Release the guard only if not one contact frame ever arrived. Called when
 *  `getContacts()` settles: if frames are flowing, its resolution was the 10s
 *  waiter timeout and the walk is still running, so the guard has to stay up
 *  until END_OF_CONTACTS. If none arrived, nothing is streaming and holding the
 *  guard would just lock the user out of retrying. */
export function endContactWalkIfSilent(): void {
  if (!streaming) endContactWalk();
}

export function isContactWalkInFlight(): boolean {
  return inFlight;
}
