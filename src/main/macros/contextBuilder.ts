// src/main/macros/contextBuilder.ts
import type { MacroContext, MacroPath, MacroPathHop, MacroPosition } from '../../shared/macros/types';
import type { Contact, DeviceIdentity, DeviceInfo, Message, MessagePath, Owner } from '../../shared/types';

export interface SelfState {
  owner: Owner | null;
  deviceInfo: DeviceInfo;
  deviceIdentity: DeviceIdentity;
}

function pos(lat: number | null | undefined, lon: number | null | undefined): MacroPosition | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return { lat: lat as number, lon: lon as number };
}

function humanizeAgo(ms: number): string {
  if (ms < 60_000) return 'just now';
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h`;
  return `${Math.floor(ms / 86_400_000)}d`;
}

/** Resolve a relay hop's wire prefix against known repeaters. Demands exactly
 *  one match: at hash_mode 1 a prefix is two hex chars, so collisions are
 *  ordinary, and macro output is transmitted — a wrong operator name is worse
 *  than a blank. Mirrors candidatesFor() in the renderer's path viewer, which is
 *  likewise only ever fed contacts of kind 'repeater'. */
function resolveHop(shortId: string, repeaters: Contact[]): { name: string | null; pk: string | null } {
  if (shortId.length === 0) return { name: null, pk: null }; // startsWith('') matches everything
  const prefix = shortId.toLowerCase();
  // The kind guard is defence in depth — callers pass a pre-filtered list, but a
  // chat contact leaking in here would name someone's phone as a mesh relay.
  const matches = repeaters.filter((c) => c.kind === 'repeater' && c.publicKeyHex.toLowerCase().startsWith(prefix));
  if (matches.length !== 1) return { name: null, pk: null }; // unknown OR ambiguous
  return { name: matches[0].name, pk: matches[0].publicKeyHex };
}

function mapPaths(paths: MessagePath[] | undefined, repeaters: Contact[]): MacroPath[] {
  if (!paths) return [];
  return paths.map((p) => {
    const all: MacroPathHop[] = p.hops.map((h) =>
      h.kind === 'hop'
        ? { kind: h.kind, short_id: h.shortId, ...resolveHop(h.shortId, repeaters) }
        : { kind: h.kind, short_id: h.shortId, name: h.name ?? null, pk: null },
    );
    const relays = all.filter((h) => h.kind === 'hop');
    return {
      id: p.id,
      length: relays.length,
      hash_mode: p.hashMode,
      final_snr: p.finalSnr,
      hops: relays,
      all_hops: all,
    };
  });
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
  /** Contacts of kind 'repeater' only — see resolveHop. */
  repeaters: Contact[];
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
    paths: mapPaths(m.meta?.paths, args.repeaters),
  };
}
