import type { Models } from '@andyshinn/meshcore-ts';
import { advTypeToKind } from '../../shared/contacts/discovered';
import type { Contact } from '../../shared/types';
import { emit } from '../events/bus';
import { coalesce } from '../events/coalesce';
import { discoveredStore } from '../storage/discoveredContacts';
import { stateHolder } from './holder';

/** How long to collect contact/discovered changes before re-broadcasting. Long
 *  enough that a GET_CONTACTS sync (one lib event per contact) collapses into a
 *  handful of emits, short enough that a single live advert still lands
 *  visibly straight away — the leading edge fires immediately either way. */
const CONTACT_EMIT_INTERVAL_MS = 120;

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
  scheduleDiscoveredEmit();

  if (isNewDiscovery) {
    emit.contactDiscovered({
      key: `c:${record.publicKeyHex}`,
      name: record.name || record.publicKeyHex.slice(0, 12),
      kind: advTypeToKind(record.type),
    });
  }
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
