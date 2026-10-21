import { bytesToHex, decodeLpp } from './lpp';
import type { SavedRequest, SavedRequestDto } from './types';

const KEY_RE = /^[0-9a-f]{64}$/;

/**
 * Normalise a node key to the stored form: bare lowercase 64-hex. Accepts the
 * app's contact key (`c:<hex>`) or a bare public key in either case. Returns
 * null for anything else (a prefix, a channel key, junk).
 */
export function normalizeNodeKey(key: string): string | null {
  const bare = (key.startsWith('c:') ? key.slice(2) : key).toLowerCase();
  return KEY_RE.test(bare) ? bare : null;
}

/** Wire form of a stored request: raw bytes as hex plus the decode (raw stays the source of truth). */
export function toSavedRequestDto(req: SavedRequest): SavedRequestDto {
  const { raw, ...rest } = req;
  if (!raw) return { ...rest, rawHex: null, readings: [], restHex: '' };
  const decoded = decodeLpp(raw);
  return { ...rest, rawHex: bytesToHex(raw), readings: decoded.readings, restHex: bytesToHex(decoded.rest) };
}
