import type { DiscoveredContact } from '../../shared/contacts/discovered';
import type { Contact } from '../../shared/types';

/** A contact merged from both store slices for the detail panel. The discovered
 *  pool is the superset (everyone we've heard); the on-radio `Contact` overlays
 *  link metrics + path when present. Either source may be missing: a brand-new
 *  on-radio contact might not yet have a discovered row, and a discovered-only
 *  node has no on-radio row. */
export interface ResolvedContact {
  publicKeyHex: string;
  key: string; // `c:${publicKeyHex}`
  name: string;
  kind: DiscoveredContact['kind'];
  onRadio: boolean;
  favourite: boolean;
  blocked: boolean;
  hops?: number;
  gpsLat?: number;
  gpsLon?: number;
  firstHeardMs?: number;
  /** Node's own advert clock (unreliable). */
  lastAdvertMs?: number;
  /** Our clock — last reception of ANY kind (advert, DM, ack, path learn, admin
   *  reply), plus a range-checked radio-reported advert reception. Undefined
   *  until first reception. See shared/contacts/discovered.ts for the contract. */
  lastHeardMs?: number;
  /** Inbound hops from the radio's cached advert path. Never merged with
   *  `hops` above, which is the outbound route — and sourced only from the
   *  discovered row, because the on-radio `Contact` has no inbound field to fall
   *  back to. Undefined = not measured; 0 = heard direct. */
  observedHops?: number;
  /** The path bytes that advert arrived over, hex. Empty/undefined for a 0-hop
   *  reception, so `observedHops` — never this — is the presence test. */
  observedPathHex?: string;
  /** Radio-RTC reception time of that advert, ms. */
  observedAtMs?: number;
  contact: Contact | null;
  rssi?: number;
  snr?: number;
  lastSeenMs?: number;
  outPathHex?: string;
  outPathHashSize?: Contact['outPathHashSize'];
}

/** Merge the discovered-pool row and the on-radio Contact for one pubkey.
 *  Returns null only when the pubkey appears in neither list. */
export function resolveContact(
  publicKeyHex: string,
  discovered: DiscoveredContact[],
  contacts: Contact[],
): ResolvedContact | null {
  const pk = publicKeyHex.toLowerCase();
  const d = discovered.find((x) => x.publicKeyHex.toLowerCase() === pk) ?? null;
  const c = contacts.find((x) => x.publicKeyHex.toLowerCase() === pk) ?? null;
  if (!d && !c) return null;

  const name = d?.name ?? c?.name ?? '';
  const kind = d?.kind ?? c?.kind ?? 'chat';
  return {
    publicKeyHex: d?.publicKeyHex ?? c?.publicKeyHex ?? publicKeyHex,
    key: `c:${d?.publicKeyHex ?? c?.publicKeyHex ?? publicKeyHex}`,
    name,
    kind,
    onRadio: d?.onRadio ?? c != null,
    favourite: d?.favourite ?? false,
    blocked: d?.blocked ?? false,
    hops: d?.hops ?? c?.hops,
    gpsLat: d?.gpsLat ?? c?.gpsLat,
    gpsLon: d?.gpsLon ?? c?.gpsLon,
    firstHeardMs: d?.firstHeardMs,
    lastAdvertMs: d?.lastAdvertMs ?? c?.lastSeenMs,
    lastHeardMs: d?.lastHeardMs,
    observedHops: d?.observedHops,
    observedPathHex: d?.observedPathHex,
    observedAtMs: d?.observedAtMs,
    contact: c,
    rssi: c?.rssi,
    snr: c?.snr,
    lastSeenMs: c?.lastSeenMs,
    outPathHex: c?.outPathHex,
    outPathHashSize: c?.outPathHashSize,
  };
}

const EARTH_RADIUS_KM = 6371;

/** Great-circle distance between two WGS84 points, in kilometres. */
export function distanceKm(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLon = toRad(bLon - aLon);
  const lat1 = toRad(aLat);
  const lat2 = toRad(bLat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Render a distance for the detail panel: "12.3 km · 7.6 mi", switching to
 *  metres/feet under 1 km so nearby nodes don't all read "0.0 km". */
export function fmtDistance(km: number): string {
  if (km < 1) {
    const m = Math.round(km * 1000);
    const ft = Math.round(km * 3280.84);
    return `${m} m · ${ft} ft`;
  }
  const mi = km * 0.621371;
  return `${km.toFixed(1)} km · ${mi.toFixed(1)} mi`;
}
