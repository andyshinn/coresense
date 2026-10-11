import type { MeshCoreSession } from '@andyshinn/meshcore-ts';
import { emit, summarizeContactSync } from '../events/bus';
import { child } from '../log';
import { sampleAdvertPathAfterAdvert } from '../state/advertPath';
import { applyLibContacts, ingestObservedContact, noteHeard, scheduleDiscoveredEmit } from '../state/contactSync';
import { endContactWalk, isContactWalkInFlight, noteContactWalkStreaming } from '../state/contactWalk';
import { stateHolder } from '../state/holder';
import { discoveredStore } from '../storage/discoveredContacts';
import { messagesStore } from '../storage/messages';
import {
  forgetRadioTelemetryPolicy,
  markRadioTelemetryPolicyKnown,
  policyFromSelfInfo,
  radioTelemetryPolicy,
} from '../telemetry/policy';
import { mergeSyncedChannels } from './mergeChannels';

const log = child('contacts');

/** Subscribe to every session event and write through to coresense's stores
 *  + bus. */
export function wireSessionEvents(session: MeshCoreSession): void {
  const ev = session.events;
  const holder = stateHolder();

  // Deliberately NOT subscribed: `transportState`.
  //
  // coresense's own transports own that bus event, and they emit it themselves
  // alongside every push into the library transport (transport/ble.ts:195-196,
  // 235-236, 395-396; transport/replay.ts:63, 82) — plus the states the library
  // has no concept of at all ('scanning', 'connecting'). Crucially they emit it
  // WITH the device id, which the library's event cannot carry: the port's
  // signature is `(s: TransportState) => void`.
  //
  // Re-emitting the library's copy therefore announced every transition twice,
  // the second time with `deviceId` undefined — and the last writer wins.
  // server.ts's subscriber feeds `transportManager.setState(state, deviceId)`,
  // which /api/snapshot serves as `transport.deviceId` and the renderer stores
  // as `connectedDeviceId`: the id the BLE panel's "Live link" card prints, and
  // the value its remember-this-radio effect refuses to save without. So the
  // duplicate silently blanked the connected radio's identity on every connect.
  //
  // This was dormant until meshcore-ts 0.8.1. Through v0.8.0 the library
  // declared `transportState` in its events port and emitted it from nowhere
  // (`git grep transportState v0.8.0 -- src` finds only ports/events.ts); 0.8.1
  // added the emit at the tail of the session's own onTransportState, which
  // made this line live for the first time since it was written.
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
    // `intervalSec` is never the radio's: firmware's gps_interval is write-only
    // (CMD_GET_CUSTOM_VARS never reports it), so the library fills it from its
    // own unseeded mirror (default 300) on every custom-vars reply carrying
    // `gps`. Keep the holder's value — the one last set from CoreSense, which
    // every route that writes it stores first.
    const next = { ...g, intervalSec: holder.getGpsConfig().intervalSec };
    holder.setGpsConfig(next);
    emit.gpsConfig(next);
  });
  // 0.8.1 emits this only after a setOtherParams the radio accepted; 0.9 also
  // folds every RESP_SELF_INFO into it. Either way it is the radio's value.
  ev.on('telemetryPolicy', (t) => {
    holder.setTelemetryPolicy(t);
    emit.telemetryPolicy(t);
    markRadioTelemetryPolicyKnown();
  });
  ev.on('autoAddConfig', (a) => {
    // The lib owns the radio-driven fields; coresense keeps two app-only UI
    // fields (autoRefreshContacts/showPublicKeys) the lib's type doesn't carry,
    // so preserve them from the current holder value rather than dropping them.
    //
    // The payload is the library's WHOLE mirror, not a delta — one emit per
    // change, carrying every other field as it stood. SessionAdapter.start()
    // seeds that mirror from this holder precisely so the untouched fields
    // round-trip our own values back to us instead of library defaults.
    const prev = holder.getAutoAddConfig();
    const next = {
      // Derived, never copied: the library's own `mode` is app-side state it
      // never writes, so reading it back pins us to its default ('all') and
      // silently discards the user's choice. Bit 0 of manual_add_contacts is
      // the radio's actual answer to the same question.
      mode: (a.manualAddContacts & 1) !== 0 ? ('selected' as const) : ('all' as const),
      chat: a.chat,
      repeater: a.repeater,
      room: a.room,
      sensor: a.sensor,
      overwriteOldest: a.overwriteOldest,
      radioMaxHops: a.radioMaxHops,
      manualAddContacts: a.manualAddContacts,
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
  // `phase` is 'idle' until a connect starts the handshake, 'syncing' while it
  // runs, 'done' when it finishes, and back to 'idle' on disconnect — nothing
  // else moves it, so an idle/syncing → done edge is exactly "one handshake
  // completed", once per connect.
  let syncPhase: 'idle' | 'syncing' | 'done' = 'idle';
  let policySeedPending = false;
  // A no-op once the policy is known (0.9's handshake `telemetryPolicy` event).
  // Only ever called with no walk streaming; a route that needs the policy
  // before the seed lands waits for the walk to end and shares this read
  // (radioTelemetryPolicy).
  const seedPolicy = () => {
    policySeedPending = false;
    void radioTelemetryPolicy(async () => policyFromSelfInfo(await session.getSelfInfo()));
  };
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
    const finished = p.phase === 'done' && syncPhase !== 'done';
    syncPhase = p.phase;
    // The library's handshake asks for device info, contacts, channels and
    // battery — never CMD_GET_AUTO_ADD_CONFIG. Without this the per-kind flags
    // and `autoadd_max_hops` the Contacts panel presents as the RADIO's prefs
    // are only ever whatever coresense last wrote locally, and a limit set from
    // the repeater CLI or another client is reported as "no limit" until the
    // user happens to press Refresh in Device Info. Issued after the handshake
    // rather than on 'connected' so it can't race CMD_APP_START — the radio has
    // to have a session before it will answer anything else.
    if (finished) void session.requestAutoAddConfig();
    // Same gap for the telemetry policy: the handshake's RESP_SELF_INFO carries
    // it, but meshcore-ts 0.8.1 never emits it, so the holder would keep
    // whatever telemetry-policy.json last held. The radio is the source of
    // truth (see telemetry/policy.ts); read it back once per connect. The read
    // re-sends APP_START, which stops a contact walk dead — and 'done' can
    // arrive mid-walk (the 10s END_OF_CONTACTS waiter) — so a walk still
    // streaming defers the read to its END_OF_CONTACTS (`contactsSynced`).
    if (finished) {
      if (isContactWalkInFlight()) policySeedPending = true;
      else seedPolicy();
    }
    // 'idle' after a handshake is the disconnect edge: the next radio may hold
    // a different policy, and nothing may re-send ours until it is read again.
    if (p.phase === 'idle') {
      policySeedPending = false;
      forgetRadioTelemetryPolicy();
    }
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
  // A PUSH_TELEMETRY_RESPONSE (0x8B) the library resolved to a contact. Still
  // a reception for last-heard purposes, but no longer broadcast: telemetry is
  // requested and saved through telemetry/service.ts, which awaits the reply
  // itself, and an unsolicited push (another client on the same radio, the
  // legacy CMD_SEND_TELEMETRY_REQ) has nothing in the app to land in.
  ev.on('repeaterTelemetry', (s) => noteHeard(s.contactKey));
  ev.on('contactsFull', () => emit.error('radio contact store is full — remove or favourite contacts to make room'));

  wireContacts(session); // Task C2
  wireMessages(session); // Task C3

  // The deferred policy seed (see syncProgress above). Registered AFTER
  // wireContacts so its contactsSynced handler has already released the walk
  // guard by the time this one runs.
  ev.on('contactsSynced', () => {
    if (policySeedPending) seedPolicy();
  });
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
