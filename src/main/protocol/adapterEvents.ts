import type { MeshCoreSession } from '@andyshinn/meshcore-ts';
import { emit, summarizeContactSync } from '../events/bus';
import { child } from '../log';
import { applyLibContacts, ingestObservedContact, scheduleDiscoveredEmit } from '../state/contactSync';
import { stateHolder } from '../state/holder';
import { discoveredStore } from '../storage/discoveredContacts';
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
    holder.setGpsConfig(g);
    emit.gpsConfig(g);
  });
  ev.on('telemetryPolicy', (t) => {
    holder.setTelemetryPolicy(t);
    emit.telemetryPolicy(t);
  });
  ev.on('autoAddConfig', (a) => {
    // The lib owns the radio-driven fields; coresense keeps two app-only UI
    // fields (pullToRefresh/showPublicKeys) the lib's type doesn't carry, so
    // preserve them from the current holder value rather than dropping them.
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
      pullToRefresh: prev.pullToRefresh,
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
  ev.on('syncProgress', (p) => {
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
  });
  ev.on('pathLearned', (e) => emit.pathLearned(e));
  ev.on('repeaterStatus', (s) => emit.repeaterStatus(s));
  ev.on('repeaterTelemetry', (s) => emit.repeaterTelemetry(s));
  ev.on('contactsFull', () => emit.error('radio contact store is full — remove or favourite contacts to make room'));

  wireContacts(session); // Task C2
  wireMessages(session); // Task C3
}

function wireContacts(session: MeshCoreSession): void {
  const ev = session.events;
  ev.on('contactObserved', (record, source) => ingestObservedContact(record, source));
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
    emit.messages(m.key, holder.getMessagesForKey(m.key));
  });
  ev.on('messageState', (id, state) => {
    holder.setMessageState(id, state);
    emit.messageState(id, state);
  });
  // The lib emits only { id, path } (it doesn't track this message's state —
  // we do); coresense owns the 'sent' → 'heard' transition.
  ev.on('messagePathHeard', ({ id, path }) => {
    const state = holder.appendMessagePath(id, path);
    if (state) emit.messagePathHeard({ id, path, state });
  });
  // Note: the lib also emits the full-list `messages` event; coresense relies on
  // `messageUpserted` for surgical persistence + emits the holder-annotated full
  // list, so we deliberately do NOT subscribe to `messages` (would double-emit).
}
