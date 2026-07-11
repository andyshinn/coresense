export type PacketInputKind = 'hex' | 'base64' | 'uri';

const isHexBody = (s: string) => s.length >= 2 && s.length % 2 === 0 && /^[0-9a-f]+$/i.test(s);

export function normalizeToHex(raw: string): { hex: string; kind: PacketInputKind } | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // meshcore://<hex>
  if (/^meshcore:\/\//i.test(trimmed)) {
    const body = trimmed.replace(/^meshcore:\/\//i, '').trim();
    return isHexBody(body) ? { hex: body.toLowerCase(), kind: 'uri' } : null;
  }

  // spaced / newlined hex
  const compact = trimmed.replace(/[\s:,-]/g, '');
  if (isHexBody(compact)) return { hex: compact.toLowerCase(), kind: 'hex' };

  // base64 → hex
  try {
    const bin = atob(trimmed.replace(/\s/g, ''));
    if (bin.length < 1) return null;
    let hex = '';
    for (let i = 0; i < bin.length; i++) hex += bin.charCodeAt(i).toString(16).padStart(2, '0');
    return { hex, kind: 'base64' };
  } catch {
    return null;
  }
}
