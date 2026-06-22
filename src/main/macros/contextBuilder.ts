// src/main/macros/contextBuilder.ts
import type { MacroContext, MacroPath, MacroPosition } from '../../shared/macros/types';
import type { Contact, DeviceIdentity, DeviceInfo, Message, MessagePath, Owner } from '../../shared/types';

export interface SelfState {
  owner: Owner | null;
  deviceInfo: DeviceInfo;
  deviceIdentity: DeviceIdentity;
}

function pos(lat: number | null | undefined, lon: number | null | undefined): MacroPosition | null {
  if (typeof lat !== 'number' || typeof lon !== 'number') return null;
  return { lat, lon };
}

function humanizeAgo(ms: number): string {
  if (ms < 60_000) return 'just now';
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h`;
  return `${Math.floor(ms / 86_400_000)}d`;
}

function mapPaths(paths: MessagePath[] | undefined): MacroPath[] {
  if (!paths) return [];
  return paths.map((p) => ({
    id: p.id,
    length: p.hops.length,
    hash_mode: p.hashMode,
    final_snr: p.finalSnr,
    hops: p.hops.map((h) => ({ kind: h.kind, short_id: h.shortId, name: h.name ?? null, pk: h.pk ?? null })),
  }));
}

function selfFields(self: SelfState) {
  const name = self.owner?.name ?? null;
  const mv = typeof self.deviceInfo?.batteryMv === 'number' ? self.deviceInfo.batteryMv : null;
  return {
    my_name: name,
    my_callsign: name,
    my_id: self.owner?.publicKeyShort ?? null,
    my_pubkey: self.owner?.publicKeyHex ?? null,
    my_pos: pos(self.deviceIdentity?.lat ?? null, self.deviceIdentity?.lon ?? null),
    my_battery_mv: mv,
    my_battery_v: mv == null ? null : mv / 1000,
  };
}

function peerFields(contact: Contact | null) {
  return {
    peer_name: contact?.name ?? null,
    peer_id: contact?.publicKeyHex ?? null,
    peer_pos: pos(contact?.gpsLat, contact?.gpsLon),
    peer_last_seen: contact?.lastSeenMs ?? null,
    peer_rssi: contact?.rssi ?? null,
    peer_snr: contact?.snr ?? null,
    peer_hops: contact?.hops ?? null,
  };
}

function emptyReplyFields() {
  return {
    message_body: null,
    msg_time: null,
    received_ago: null,
    sender_name: null,
    sender_id: null,
    sender_pos: null,
    rssi: null,
    snr: null,
    hops: null,
    times_heard: null,
    paths: [] as MacroPath[],
  };
}

export function buildSendContext(args: {
  self: SelfState;
  peerContact: Contact | null;
  channelName: string | null;
}): MacroContext {
  return {
    ...selfFields(args.self),
    channel: args.channelName,
    ...peerFields(args.peerContact),
    ...emptyReplyFields(),
  };
}

export function buildReplyContext(args: {
  self: SelfState;
  message: Message;
  senderContact: Contact | null;
  channelName: string | null;
  now?: number;
}): MacroContext {
  const now = args.now ?? Date.now();
  const m = args.message;
  return {
    ...selfFields(args.self),
    channel: args.channelName,
    ...peerFields(args.senderContact),
    message_body: m.body,
    msg_time: m.ts,
    received_ago: humanizeAgo(Math.max(0, now - m.ts)),
    sender_name: args.senderContact?.name ?? null,
    sender_id: m.fromPublicKeyHex ?? null,
    sender_pos: pos(args.senderContact?.gpsLat, args.senderContact?.gpsLon),
    rssi: m.meta?.rssi ?? null,
    snr: m.meta?.snr ?? null,
    hops: m.meta?.hops ?? null,
    times_heard: m.meta?.timesHeard ?? null,
    paths: mapPaths(m.meta?.paths),
  };
}
