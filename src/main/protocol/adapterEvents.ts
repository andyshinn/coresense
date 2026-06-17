import type { MeshCoreSession } from '@andyshinn/meshcore-ts';
import { emit } from '../events/bus';
import { applyLibContacts, ingestObservedContact } from '../state/contactSync';
import { stateHolder } from '../state/holder';
import { discoveredStore } from '../storage/discoveredContacts';

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
    holder.setChannels(chs);
    emit.channels(holder.getChannels());
  });
  ev.on('channelPresence', (keys) => emit.channelPresence(keys));
  ev.on('syncProgress', (p) => emit.syncProgress(p));
  ev.on('pathLearned', (e) => emit.pathLearned(e));
  ev.on('repeaterStatus', (s) => emit.repeaterStatus(s));
  ev.on('repeaterTelemetry', (s) => emit.repeaterTelemetry(s));

  wireContacts(session); // Task C2
  wireMessages(session); // Task C3
}

function wireContacts(session: MeshCoreSession): void {
  const ev = session.events;
  ev.on('contactObserved', (record, source) => ingestObservedContact(record, source));
  ev.on('contacts', (contacts) => applyLibContacts(contacts));
  ev.on('discovered', () => {
    // The lib also emits cooked 'discovered'; coresense's sqlite pool is the
    // authority (fed by contactObserved), so re-emit from the store for blocking.
    const holder = stateHolder();
    emit.discovered(discoveredStore.list(holder.getRadioSettings().pathHashMode, holder.getBlockRules()));
  });
  // Note: contactDiscovered is emitted by ingestObservedContact for genuinely-new
  // discoveries (with blocking-aware naming). The lib's contactDiscovered fires
  // for the same observations contactObserved does, so re-emitting it here would
  // double-fire — we deliberately do NOT subscribe to it.
  ev.on('contactEvicted', (name) => emit.contactEvicted(name));
}

// --- Task C3 (messages) fills this in. ---
function wireMessages(_session: MeshCoreSession): void {}
