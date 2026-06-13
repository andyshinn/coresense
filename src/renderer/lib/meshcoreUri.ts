import { type AdvertPayload, type DeviceRole, MeshCoreDecoder, PayloadType, Utils } from '@michaelhart/meshcore-decoder';

/**
 * A MeshCore node advertisement decoded from a `meshcore://` contact-share
 * link. The official apps emit these so a contact can be added by tapping a
 * link instead of waiting for an over-the-air advert.
 */
export interface MeshcoreAdvert {
  /** 32-byte Ed25519 public key, lowercase hex. */
  publicKeyHex: string;
  /** Advertised node name, or null when the advert carries none. */
  name: string | null;
  /** Node role: chat node, repeater, room server or sensor. */
  role: DeviceRole;
  /** Human-readable role name, e.g. "Chat Node". */
  roleName: string;
  /** Advertised location, when the node shares one. */
  location: { lat: number; lon: number } | null;
  /** When the advert was signed (unix epoch milliseconds). */
  advertisedAt: number;
  /** Ed25519 signature check: true/false when run, null when not verified. */
  signatureValid: boolean | null;
}

const PREFIX = 'meshcore://';

/**
 * Decodes a `meshcore://<hex>` contact-share link. The hex payload is a raw
 * MeshCore packet carrying a flood-routed ADVERT — the same bytes a node puts
 * on the air. Returns null for anything that isn't a well-formed advert, so
 * callers can fall back to rendering the link as plain text.
 */
export function decodeMeshcoreUri(raw: string): MeshcoreAdvert | null {
  if (!raw.toLowerCase().startsWith(PREFIX)) return null;
  const hex = raw.slice(PREFIX.length).trim();
  if (hex.length < 2 || hex.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(hex)) return null;

  let advert: AdvertPayload | null;
  try {
    const packet = MeshCoreDecoder.decode(hex);
    if (!packet.isValid || packet.payloadType !== PayloadType.Advert) return null;
    advert = packet.payload.decoded as AdvertPayload | null;
  } catch {
    return null;
  }
  if (!advert?.isValid) return null;

  return {
    publicKeyHex: advert.publicKey.toLowerCase(),
    name: advert.appData.name ?? null,
    role: advert.appData.deviceRole,
    roleName: Utils.getDeviceRoleName(advert.appData.deviceRole),
    location: advert.appData.location
      ? { lat: advert.appData.location.latitude, lon: advert.appData.location.longitude }
      : null,
    // The advert timestamp is unix seconds; the app's time helpers want millis.
    advertisedAt: advert.timestamp * 1000,
    signatureValid: advert.signatureValid ?? null,
  };
}
