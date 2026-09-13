export type PacketInputKind = 'hex' | 'base64' | 'uri';

const isHexBody = (s: string) => s.length >= 2 && s.length % 2 === 0 && /^[0-9a-f]+$/i.test(s);

// Sane upper bound on decoded packet size — nothing on the wire is remotely
// this large, and it protects the dialog (and the decoder libs it feeds) from
// pathological pastes. Checked on the input string length (cheap, no
// allocation) rather than after atob/hex expansion.
const MAX_PACKET_BYTES = 64 * 1024;
const MAX_HEX_CHARS = MAX_PACKET_BYTES * 2; // 2 hex chars per byte
const MAX_BASE64_CHARS = Math.ceil(MAX_PACKET_BYTES / 3) * 4; // base64 expands 3 bytes -> 4 chars

export function normalizeToHex(raw: string): { hex: string; kind: PacketInputKind } | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // meshcore://<hex>
  if (/^meshcore:\/\//i.test(trimmed)) {
    const body = trimmed.replace(/^meshcore:\/\//i, '').trim();
    if (body.length > MAX_HEX_CHARS) return null;
    return isHexBody(body) ? { hex: body.toLowerCase(), kind: 'uri' } : null;
  }

  // spaced / newlined hex
  const compact = trimmed.replace(/[\s:,-]/g, '');
  if (compact.length > MAX_HEX_CHARS) return null;
  if (isHexBody(compact)) return { hex: compact.toLowerCase(), kind: 'hex' };

  // An all-hex-alphabet string that failed the even-length hex check above is a
  // truncated/garbled hex paste, not base64 — don't silently reinterpret it.
  if (/^[0-9a-fA-F]+$/.test(compact)) return null;

  // base64 → hex
  const b64 = trimmed.replace(/\s/g, '');
  if (b64.length > MAX_BASE64_CHARS) return null;
  try {
    const bin = atob(b64);
    if (bin.length < 1) return null;
    let hex = '';
    for (let i = 0; i < bin.length; i++) hex += bin.charCodeAt(i).toString(16).padStart(2, '0');
    return { hex, kind: 'base64' };
  } catch {
    return null;
  }
}
