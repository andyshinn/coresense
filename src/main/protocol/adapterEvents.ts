import type { MeshCoreSession } from '@andyshinn/meshcore-ts';
import { emit } from '../events/bus';
import { stateHolder } from '../state/holder';

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

// --- Task C2 (contacts + discovered) fills this in. ---
function wireContacts(_session: MeshCoreSession): void {}

// --- Task C3 (messages) fills this in. ---
function wireMessages(_session: MeshCoreSession): void {}
