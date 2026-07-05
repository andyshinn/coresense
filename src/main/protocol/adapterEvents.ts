import type { MeshCoreSession } from '@andyshinn/meshcore-ts';
import { emit } from '../events/bus';
import { applyLibContacts, ingestObservedContact } from '../state/contactSync';
import { stateHolder } from '../state/holder';
import { discoveredStore } from '../storage/discoveredContacts';
import { mergeSyncedChannels } from './mergeChannels';

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
    // fields (pullToRefresh/showPublicKeys) the lib's type doesn't carry, so
    // preserve them from the current holder value rather than dropping them.
    const prev = holder.getAutoAddConfig();
    const next = {
      mode: a.mode,
      chat: a.chat,
      repeater: a.repeater,
      room: a.room,
      sensor: a.sensor,
      overwriteOldest: a.overwriteOldest,
      maxHops: a.maxHops,
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
  ev.on('syncProgress', (p) => emit.syncProgress(p));
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
    // miss them. Per-row setX (not reconcileOnRadio) so contacts the lib hasn't
    // re-synced this session keep their persisted flags.
    for (const r of libRows) {
      discoveredStore.setOnRadio(r.publicKeyHex, r.onRadio);
      discoveredStore.setFavourite(r.publicKeyHex, r.favourite);
    }
    const holder = stateHolder();
    emit.discovered(discoveredStore.list(holder.getRadioSettings().pathHashMode, holder.getBlockRules()));
  });
  // Note: contactDiscovered is emitted by ingestObservedContact for genuinely-new
  // discoveries (with blocking-aware naming). The lib's contactDiscovered fires
  // for the same observations contactObserved does, so re-emitting it here would
  // double-fire — we deliberately do NOT subscribe to it.
  ev.on('contactEvicted', (name) => emit.contactEvicted(name));
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
