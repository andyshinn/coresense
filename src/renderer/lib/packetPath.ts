// The Packet Log's "Heard via" paths: the same MessagePath shape the channel
// pane's PathViewer renders for a message, built from raw on-air packets.
//
// Pure and DOM-free so the route parsing and the grouping of repeat receptions
// are unit-testable in Node.

import { PayloadType, RouteType } from '@michaelhart/meshcore-decoder';
import type { Contact, MessageHop, MessagePath } from '../../shared/types';
import { splitHopsHex } from '../components/path/resolveRepeater';
import type { PacketSender } from './packetInspect';
import type { LivePacket } from './store';

/** The parts of a raw mesh packet that identify one reception's route. */
export interface OnAirRoute {
  routeType: RouteType;
  payloadType: PayloadType;
  /** Bytes per path hash: 1, 2 or 3. */
  hashSize: 1 | 2 | 3;
  pathHex: string;
  /** Everything after the path. Identical across every reception of one packet. */
  payloadHex: string;
}

/**
 * Split a raw mesh packet (header onward) at its path. Null when truncated or
 * malformed.
 *
 * Layout: header (route type bits 1-0, payload type bits 5-2) · 4 transport-code
 * bytes for the two transport route types · packed path-length byte (hop count
 * bits 5-0, hashSize-1 bits 7-6, see shared/contacts/discovered.ts) · path
 * (hops × hashSize bytes) · payload.
 */
export function parseOnAirRoute(hex: string): OnAirRoute | null {
  const header = Number.parseInt(hex.slice(0, 2), 16);
  if (Number.isNaN(header)) return null;
  const routeType = (header & 0x03) as RouteType;
  const payloadType = ((header >> 2) & 0x0f) as PayloadType;
  let at = 2;
  if (routeType === RouteType.TransportFlood || routeType === RouteType.TransportDirect) at += 8;
  const pathLen = Number.parseInt(hex.slice(at, at + 2), 16);
  if (hex.length < at + 2 || Number.isNaN(pathLen)) return null;
  at += 2;
  const hashSize = (pathLen >> 6) + 1;
  // 0b11 in the size bits is reserved; the firmware never emits it.
  if (hashSize !== 1 && hashSize !== 2 && hashSize !== 3) return null;
  const pathEnd = at + (pathLen & 0x3f) * hashSize * 2;
  if (hex.length < pathEnd) return null;
  return { routeType, payloadType, hashSize, pathHex: hex.slice(at, pathEnd), payloadHex: hex.slice(pathEnd) };
}

/** Whether a route's path records where the packet has BEEN. Each repeater appends
 *  its hash to a flood packet as it relays it. A direct packet's path is the route
 *  still AHEAD, and repeaters remove themselves as they forward. Trace packets
 *  reuse the path bytes for per-hop SNR. */
function pathIsHistory(route: OnAirRoute): boolean {
  const flood = route.routeType === RouteType.Flood || route.routeType === RouteType.TransportFlood;
  return flood && route.payloadType !== PayloadType.Trace;
}

/** The origin pseudo-hop, resolved against contacts where the payload gives us
 *  something to match. Mirrors meshcore-ts buildPath's name-derived shortId. */
export function originHop(sender: PacketSender | null, contacts: Contact[]): MessageHop {
  const byKey = sender?.publicKeyHex
    ? contacts.find((c) => c.publicKeyHex.toLowerCase() === sender.publicKeyHex?.toLowerCase())
    : undefined;
  // A source hash is only a 1-byte prefix; name it only when exactly one contact fits.
  const hashMatches = sender?.hashHex
    ? contacts.filter((c) => c.publicKeyHex.toLowerCase().startsWith(sender.hashHex?.toLowerCase() ?? ''))
    : [];
  const contact = byKey ?? (hashMatches.length === 1 ? hashMatches[0] : undefined);
  const name = sender?.name ?? contact?.name ?? null;
  const pk = sender?.publicKeyHex ?? contact?.publicKeyHex ?? null;
  return {
    kind: 'origin',
    shortId: name ? name.slice(0, 2).toLowerCase() : (sender?.hashHex ?? pk?.slice(0, 2) ?? '??'),
    name,
    pk,
    unnamed: name == null,
  };
}

export interface PacketHeardVia {
  /** One path per distinct route, in the order first heard. */
  paths: MessagePath[];
  /** Receptions of this packet in the log, across every route. */
  timesHeard: number;
}

/**
 * Every route the selected packet reached this radio by, gathered from the packets
 * in the log. Flood copies of one packet share their payload bytes and differ only
 * in the path, so the payload identifies them. That's the same identity the
 * firmware's packet hash uses to drop duplicates.
 *
 * Null for packets whose path isn't a record of where they've been (direct routes,
 * trace), for companion frames, and for anything that doesn't parse.
 */
export function packetHeardVia(
  selected: LivePacket,
  packets: LivePacket[],
  ends: { origin: MessageHop; ownerName: string | null },
): PacketHeardVia | null {
  if (selected.kind !== 'mesh') return null;
  const route = parseOnAirRoute(selected.payloadHex);
  if (!route || !pathIsHistory(route)) return null;

  const pathId = (r: OnAirRoute) => `${r.hashSize}:${r.pathHex}`;
  const sink: MessageHop = {
    kind: 'sink',
    shortId: ends.ownerName ? ends.ownerName.slice(0, 2).toLowerCase() : 'me',
    name: ends.ownerName ?? 'My radio',
    pk: null,
  };

  const byId = new Map<string, MessagePath>();
  let timesHeard = 0;
  for (const p of packets) {
    // endsWith is a cheap pre-filter before parsing; the buffer can hold 20,000 packets.
    if (p.kind !== 'mesh' || !p.payloadHex.endsWith(route.payloadHex)) continue;
    const r = p === selected ? route : parseOnAirRoute(p.payloadHex);
    if (!r || r.payloadType !== route.payloadType || r.payloadHex !== route.payloadHex || !pathIsHistory(r)) continue;
    timesHeard++;
    const id = pathId(r);
    // A route heard more than once shows the selected reception's SNR when it's one of them.
    if (byId.has(id) && p !== selected) continue;
    byId.set(id, {
      id,
      hops: [
        ends.origin,
        ...splitHopsHex(r.pathHex, r.hashSize).map(
          (shortId): MessageHop => ({ kind: 'hop', shortId, name: null, pk: null, unnamed: true }),
        ),
        sink,
      ],
      hashMode: r.hashSize,
      // Mesh receptions always carry link metrics; 0 matches HeardVia's fallback.
      finalSnr: p.snr ?? 0,
    });
  }

  return { paths: [...byId.values()], timesHeard };
}
