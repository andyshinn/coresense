import type { Models } from '@andyshinn/meshcore-ts';
import { advTypeToKind } from '../../shared/contacts/discovered';
import type { Contact } from '../../shared/types';
import { emit } from '../events/bus';
import { coalesce } from '../events/coalesce';
import { child } from '../log';
import { discoveredStore } from '../storage/discoveredContacts';
import { stateHolder } from './holder';

const log = child('contacts');

/** How long to collect contact/discovered changes before re-broadcasting.
 *
 *  A coalescer runs once per interval for as long as signals keep arriving, so
 *  the broadcast count is `burst_duration / interval` — it does NOT shrink as
 *  the interval work gets cheaper, and it grows with how slowly the radio
 *  feeds us. A real 300-contact sync over BLE takes ~15s (one RESP_CONTACT
 *  every ~50ms), so at 120ms that was still ~128 full-pool projections and
 *  ~5.8MB of JSON; at 1s it is ~16 and ~0.7MB.
 *
 *  A single live advert is unaffected either way: the leading edge fires
 *  immediately, so only a *second* change within the same second waits. */
const CONTACT_EMIT_INTERVAL_MS = 1000;

// Projecting the pool is a full table scan plus a per-row block-rule match, and
// the payload is then JSON-serialised to every websocket client. The lib emits
// its whole discovered pool once per contact frame, so doing this per event is
// quadratic in a sync; coalescing makes the cost proportional to how long the
// burst lasts instead of how many events it contained.
const discoveredEmitter = coalesce(() => {
  emit.discovered(discoveredStore.list(stateHolder().getBlockRules()));
}, CONTACT_EMIT_INTERVAL_MS);

// Same story for the contact list, and it's the one the renderer feels most:
// every broadcast replaces the store array, which changes its identity and
// re-renders every component subscribed to `contacts`. N+1 full-array
// broadcasts during a sync is what pegs the renderer process.
const contactsEmitter = coalesce(() => {
  emit.contacts(stateHolder().getContacts());
}, CONTACT_EMIT_INTERVAL_MS);

/** Re-broadcast the discovered pool, coalescing bursts. */
export function scheduleDiscoveredEmit(): void {
  discoveredEmitter.schedule();
}

/** Re-broadcast the contact list, coalescing bursts. */
export function scheduleContactsEmit(): void {
  contactsEmitter.schedule();
}

/** Settle any pending coalesced contact/discovered emit. Tests await this after
 *  driving a sync; production relies on the timer. */
export async function flushContactSyncEmits(): Promise<void> {
  await Promise.all([discoveredEmitter.flush(), contactsEmitter.flush()]);
}

/** Feed a raw observed contact record into the sqlite discovered pool and emit
 *  the refreshed discovered list. Mirrors the old features/contacts ingestContact
 *  discovery path. `source` is 'sync' (on-radio handshake) or 'advert' (heard live). */
export function ingestObservedContact(record: Models.ContactRecord, source: Models.ContactSource): void {
  // A brand-new advert (no existing row) is heard-live but NOT on the radio yet,
  // so default to false when get() is null — only an existing row with on_radio=1
  // counts as on-radio. (`?.on_radio !== 0` would wrongly treat null as on-radio.)
  const onRadio = source === 'sync' ? true : discoveredStore.get(record.publicKeyHex)?.on_radio === 1;
  const isNewDiscovery = source === 'advert' && discoveredStore.get(record.publicKeyHex) === null;

  discoveredStore.upsert(record, { onRadio, nowMs: Date.now(), heardLive: source === 'advert' });
  // One line per ingested contact. Below the default level (debug) on purpose:
  // a 300-contact sync would otherwise bury everything else. Turn it on with
  // CORESENSE_LOG_LEVEL=trace to literally count what the radio sent.
  log.trace(`ingest [${source}] ${record.publicKeyHex.slice(0, 12)} "${record.name}" onRadio=${onRadio}`);
  scheduleDiscoveredEmit();

  if (isNewDiscovery) {
    emit.contactDiscovered({
      key: `c:${record.publicKeyHex}`,
      name: record.name || record.publicKeyHex.slice(0, 12),
      kind: advTypeToKind(record.type),
    });
  }
}

/** A full 32-byte pubkey in hex. Anything shorter or differently shaped is not
 *  an identity we can attribute a reception to: channel posts name their sender
 *  as `name:<n>` (or `unknown`), a DM from a contact the radio doesn't store
 *  resolves only to a 6-byte prefix, and our own outbound messages carry no
 *  sender at all. */
const FULL_PUBKEY_HEX = /^[0-9a-f]{64}$/i;

/** Bump a contact's last-heard from any genuine reception that carries an
 *  identity: an inbound DM, an ack for a DM we sent, a learned path, a repeater
 *  status/telemetry push, a CLI reply, a trace that came back.
 *
 *  Accepts either a bare pubkey or a `c:<pubkey>` contact key, and silently
 *  ignores anything that isn't a full pubkey (see FULL_PUBKEY_HEX) — that check
 *  is what keeps channel traffic and our own sends out of a column labelled
 *  "Last heard". The store is UPDATE-only, so an unknown pubkey is a no-op
 *  rather than a synthesised row.
 *
 *  Broadcasts only when a row actually moved, through the same 1s coalescer the
 *  advert path uses, so a burst of inbound traffic collapses to one push. */
export function noteHeard(keyOrPubkey: string | undefined): void {
  if (!keyOrPubkey) return;
  const pubkey = keyOrPubkey.startsWith('c:') ? keyOrPubkey.slice(2) : keyOrPubkey;
  if (!FULL_PUBKEY_HEX.test(pubkey)) return;
  if (discoveredStore.markHeard(pubkey, Date.now())) scheduleDiscoveredEmit();
}

/** Merge coresense-only fields (pinned/muted) from current holder contacts into
 *  the lib's authoritative contact list, persist, and emit. The lib owns
 *  favourite/outPath/preferDirect/pathManual/pathLearnedAt. */
export function applyLibContacts(libContacts: Models.Contact[]): void {
  const holder = stateHolder();
  const prev = new Map(holder.getContacts().map((c) => [c.key, c]));
  const merged: Contact[] = libContacts.map((c) => {
    const old = prev.get(c.key);
    return old ? { ...c, pinned: old.pinned, muted: old.muted } : c;
  });
  holder.setContacts(merged);
  // The holder is updated synchronously above; only the broadcast is coalesced,
  // so anything reading state via the holder still sees the latest list.
  scheduleContactsEmit();
}
