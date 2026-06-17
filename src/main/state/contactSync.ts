import type { ContactRecord, ContactSource, Contact as LibContact } from '@andyshinn/meshcore-ts';
import { advTypeToKind } from '../../shared/contacts/discovered';
import type { Contact } from '../../shared/types';
import { emit } from '../events/bus';
import { discoveredStore } from '../storage/discoveredContacts';
import { stateHolder } from './holder';

/** Feed a raw observed contact record into the sqlite discovered pool and emit
 *  the refreshed discovered list. Mirrors the old features/contacts ingestContact
 *  discovery path. `source` is 'sync' (on-radio handshake) or 'advert' (heard live). */
export function ingestObservedContact(record: ContactRecord, source: ContactSource): void {
  const holder = stateHolder();
  const onRadio = source === 'sync' ? true : discoveredStore.get(record.publicKeyHex)?.on_radio !== 0;
  const isNewDiscovery = source === 'advert' && discoveredStore.get(record.publicKeyHex) === null;

  discoveredStore.upsert(record, { onRadio, nowMs: Date.now(), heardLive: source === 'advert' });
  emit.discovered(discoveredStore.list(holder.getRadioSettings().pathHashMode, holder.getBlockRules()));

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
export function applyLibContacts(libContacts: LibContact[]): void {
  const holder = stateHolder();
  const prev = new Map(holder.getContacts().map((c) => [c.key, c]));
  const merged: Contact[] = libContacts.map((c) => {
    const old = prev.get(c.key);
    return old ? { ...c, pinned: old.pinned, muted: old.muted } : c;
  });
  holder.setContacts(merged);
  emit.contacts(merged);
}
