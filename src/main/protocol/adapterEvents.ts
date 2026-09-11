import type { MeshCoreSession } from '@andyshinn/meshcore-ts';
import { emit, summarizeContactSync } from '../events/bus';
import { child } from '../log';
import { sampleAdvertPathAfterAdvert } from '../state/advertPath';
import { applyLibContacts, ingestObservedContact, noteHeard, scheduleDiscoveredEmit } from '../state/contactSync';
import { endContactWalk, noteContactWalkStreaming } from '../state/contactWalk';
import { stateHolder } from '../state/holder';
import { discoveredStore } from '../storage/discoveredContacts';
import { messagesStore } from '../storage/messages';
import { mergeSyncedChannels } from './mergeChannels';

const log = child('contacts');

/** Subscribe to every session event and write through to coresense's stores
 *  + bus. */
export function wireSessionEvents(session: MeshCoreSession): void {
  const ev = session.events;
  const holder = stateHolder();

  ev.on('transportState', (s) => emit.transportState(s));
  ev.on('owner', (o) => {
    holder.setOwner(o);
    emit.owner(o);
  });
  ev.on('deviceInfo', (info) => {
    holder.setDeviceInfo(info);
    emit.deviceInfo(info);
  });
  ev.on('deviceCapabilities', (caps) => {
    holder.setDeviceCapabilities(caps);
    emit.deviceCapabilities(caps);
  });
  ev.on('deviceIdentity', (id) => {
    holder.setDeviceIdentity(id);
    emit.deviceIdentity(id);
  });
  ev.on('radioSettings', (r) => {
    holder.setRadioSettings(r);
    emit.radioSettings(r);
  });
  ev.on('gpsConfig', (g) => {
    holder.setGpsConfig(g);
    emit.gpsConfig(g);
  });
  ev.on('telemetryPolicy', (t) => {
    holder.setTelemetryPolicy(t);
    emit.telemetryPolicy(t);
  });
  ev.on('autoAddConfig', (a) => {
    // The lib owns the radio-driven fields; coresense keeps two app-only UI
    // fields (autoRefreshContacts/showPublicKeys) the lib's type doesn't carry,
    // so preserve them from the current holder value rather than dropping them.
    const prev = holder.getAutoAddConfig();
    const next = {
      mode: a.mode,
      chat: a.chat,
      repeater: a.repeater,
      room: a.room,
      sensor: a.sensor,
      overwriteOldest: a.overwriteOldest,
      maxHops: a.maxHops,
      autoRefreshContacts: prev.autoRefreshContacts,
      showPublicKeys: prev.showPublicKeys,
    };
    holder.setAutoAddConfig(next);
    emit.autoAddConfig(next);
  });
  ev.on('channels', (chs) => {
    // The lib owns radio fields (name/kind/secretHex/idx) but never carries
    // coresense's app-only fields (order/muted/pinned), so a wholesale replace
    // would wipe a user's drag-reorder and mute state on every sync. Merge to
    // preserve them, seeding `order` from the radio slot `idx` on first sight.
    const merged = mergeSyncedChannels(holder.getChannels(), chs);
    holder.setChannels(merged);
    emit.channels(merged);
  });
  ev.on('channelPresence', (keys) => emit.channelPresence(keys));
  ev.on('syncProgress', (p) => {
    // `contacts.done < total` means RESP_CONTACT frames are still arriving, i.e.
    // the radio is mid-walk RIGHT NOW. That is the only reliable signal we get:
    // `phase` is set by the handshake and nothing else, and the lib's
    // END_OF_CONTACTS waiter resolves on a 10s timeout, so both the handshake's
    // walk and a getContacts() walk can still be streaming long after `phase`
    // says 'done'. Starting a second walk on top of one of those makes the lib
    // delete contacts (see state/contactWalk.ts).
    if (p.contacts.total > 0 && p.contacts.done < p.contacts.total) noteContactWalkStreaming();
    emit.syncProgress(p);
  });
  // The three identity-bearing pushes below are all receptions FROM the named
  // contact, so each one is a last-heard signal (#45 item 9). A path learn in
  // particular means a send to that node completed a round trip.
  ev.on('pathLearned', (e) => {
    noteHeard(e.contactKey);
    emit.pathLearned(e);
  });
  ev.on('repeaterStatus', (s) => {
    noteHeard(s.contactKey);
    emit.repeaterStatus(s);
  });
  ev.on('repeaterTelemetry', (s) => {
    noteHeard(s.contactKey);
    emit.repeaterTelemetry(s);
  });
  ev.on('contactsFull', () => emit.error('radio contact store is full — remove or favourite contacts to make room'));

  wireContacts(session); // Task C2
  wireMessages(session); // Task C3
}

function wireContacts(session: MeshCoreSession): void {
  const ev = session.events;
  ev.on('contactObserved', (record, source) => {
    ingestObservedContact(record, source);
    // A live advert is the one moment the radio's 16-slot advert-path ring is
    // guaranteed to hold this node, so it is the only trigger that makes the
    // inbound hop count fill in on its own (#45 item 7). A 'sync' record is the
    // radio listing what it stores, not a reception — sampling on that would be
    // one command per contact for an answer that is almost always a miss.
    if (source === 'advert') sampleAdvertPathAfterAdvert(record.publicKeyHex);
  });
  ev.on('contacts', (contacts) => applyLibContacts(contacts));
  ev.on('discovered', (libRows) => {
    // The lib owns the authoritative discovered pool. Write its on_radio/favourite
    // through to coresense's sqlite mirror — remove/favourite commands emit
    // `discovered` but never `contactObserved`, so re-reading our own store would
    // miss them. Per-row (not reconcileOnRadio) so contacts the lib hasn't
    // re-synced this session keep their persisted flags: the lib's pool is
    // in-memory and per-session while ours is persistent, so a blanket
    // reconcile here would clear on_radio for every row the lib simply hasn't
    // mentioned yet. Rows the lib no longer knows about are cleared once per
    // sync by the `contactsSynced` handler below.
    //
    // The lib re-sends the WHOLE pool on every contact frame, so this must stay
    // cheap to repeat: applyRadioFlags batches the writes into one transaction
    // and skips rows whose flags already match. The write-through stays
    // synchronous (a removal must be durable immediately); only the projection
    // and broadcast are coalesced.
    discoveredStore.applyRadioFlags(libRows);
    scheduleDiscoveredEmit();
  });
  // Note: contactDiscovered is emitted by ingestObservedContact for genuinely-new
  // discoveries (with blocking-aware naming). The lib's contactDiscovered fires
  // for the same observations contactObserved does, so re-emitting it here would
  // double-fire — we deliberately do NOT subscribe to it.
  ev.on('contactEvicted', (name) => emit.contactEvicted(name));
  // Fires after the lib has flushed its coalesced `contacts`/`discovered`
  // snapshots, so the holder and the sqlite mirror are both current here.
  // Because coresense coalesces its own broadcasts too, no per-contact signal
  // reaches the renderer any more — this summary is what makes a sync
  // verifiable, and the log line is the answer to "did it load them all?".
  ev.on('contactsSynced', ({ count }) => {
    // RESP_END_OF_CONTACTS — the one honest "the walk is over" signal, and so
    // the one place the refresh guard may be released.
    endContactWalk();
    const holder = stateHolder();
    // Reconcile the mirror's on_radio flags against the radio's contents (#30).
    // The per-row write-through above only ever SETS on_radio; nothing clears it
    // for a row the lib stopped reporting, so a contact removed from the radio
    // stays on_radio=1 forever and the Contact Manager's "On radio" count drifts
    // upward without bound. This is the only place we know the radio's COMPLETE
    // contents: the lib emits `contactsSynced` solely on a genuine
    // RESP_END_OF_CONTACTS, so an iteration abandoned by a disconnect or a
    // stalled radio never reaches here and can't clear flags for contacts it
    // never got to. Reconciling before the list() below also keeps the summary's
    // on-radio number (and the log line) honest rather than reporting the drift.
    //
    // The flag is global, not per-device: on_radio means "on the CURRENTLY
    // CONNECTED radio". Nothing in storage is device-scoped, so for a user who
    // alternates radios the previous radio's contacts move back to Discovered on
    // the next connect — correct under that reading, and per-device flags would
    // mean a schema migration plus every read path and the Contact Manager UI.
    discoveredStore.reconcileOnRadio(holder.getContacts().map((c) => c.publicKeyHex));
    // The lib flushed its `discovered` snapshot before emitting this, so nothing
    // else is going to re-broadcast the pool; without an explicit schedule the
    // renderer keeps showing the pre-reconcile flags until the next contact event.
    scheduleDiscoveredEmit();

    const stored = holder.getContacts().length;
    const onRadio = discoveredStore.list(holder.getBlockRules()).filter((r) => r.onRadio).length;
    const summary = summarizeContactSync(count, stored, onRadio);
    emit.contactSyncSummary(summary);
    if (summary.complete) {
      log.info(`contact sync complete: radio delivered ${count}, stored ${stored} (${onRadio} on-radio)`);
    } else {
      log.warn(`contact sync INCOMPLETE: radio delivered ${count} but only ${stored} stored`);
    }
  });
}

function wireMessages(session: MeshCoreSession): void {
  const ev = session.events;
  const holder = stateHolder();
  ev.on('messageUpserted', (m) => {
    holder.recordLibMessage(m);
    // An inbound DM is a reception from its sender. `noteHeard` filters the
    // cases that aren't: a channel post carries `name:<n>` rather than a pubkey,
    // and coresense's own outbound messages never come through here at all (the
    // sender writes them straight to the holder) — but an unresolved DM sender
    // arrives as a 6-byte prefix, which must not be treated as a pubkey.
    noteHeard(m.fromPublicKeyHex);
    emit.messages(m.key, holder.getMessagesForKey(m.key));
  });
  ev.on('messageState', (id, state) => {
    holder.setMessageState(id, state);
    // An ack is the one send-side transition that is a genuine RECEPTION: the
    // peer's ACK packet reached our radio. The holder's setter returns void, so
    // read the message back for its conversation key (`c:<pubkey>` for a DM;
    // a channel key can't pass noteHeard's pubkey check, and never acks anyway).
    if (state === 'ack') noteHeard(messagesStore.findById(id)?.key);
    emit.messageState(id, state);
  });
  // The lib emits only { id, path } (it doesn't track this message's state —
  // we do); coresense owns the 'sent' → 'heard' transition.
  //
  // Deliberately NOT a last-heard signal: MessagePath.hops are per-hop path
  // HASHES, not identities, so there is no pubkey to attribute the reception to.
  ev.on('messagePathHeard', ({ id, path }) => {
    const state = holder.appendMessagePath(id, path);
    if (state) emit.messagePathHeard({ id, path, state });
  });
  // Note: the lib also emits the full-list `messages` event; coresense relies on
  // `messageUpserted` for surgical persistence + emits the holder-annotated full
  // list, so we deliberately do NOT subscribe to `messages` (would double-emit).
}
