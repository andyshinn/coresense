import { type InspectField, fieldColorIdx } from './packetInspect';

interface Seg {
  key: string;
  name: string;
  len: number | 'rest';
  desc?: string;
}

// Firmware-version-specific. codeName values come from main's companionFrame.ts
// (PUSH_NAMES / RESP_NAMES). Extend as new frames need breakdowns.
const LAYOUTS: Record<string, Seg[]> = {
  RESP_CHANNEL_MSG_RECV: [
    { key: 'chash', name: 'Channel Hash', len: 1, desc: 'Which channel the message arrived on.' },
    { key: 'ptype', name: 'Path Type', len: 1, desc: 'How it was routed.' },
    { key: 'txts', name: 'Sender Timestamp', len: 4, desc: 'Sender clock (unix, little-endian).' },
    { key: 'text', name: 'Text', len: 'rest', desc: 'UTF-8 "sender: message".' },
  ],
  RESP_CONTACT_MSG_RECV: [
    { key: 'pk', name: 'Public Key Prefix', len: 6, desc: 'First 6 bytes of the sender public key.' },
    { key: 'ptype', name: 'Path Type', len: 1, desc: 'Routing type.' },
    { key: 'txt', name: 'Text Type', len: 1, desc: 'Plain / CLI-data / signed.' },
    { key: 'txts', name: 'Sender Timestamp', len: 4, desc: 'Sender clock (unix, little-endian).' },
    { key: 'text', name: 'Text', len: 'rest', desc: 'UTF-8 message body.' },
  ],
  PUSH_ADVERT: [
    { key: 'pk', name: 'Public Key', len: 32, desc: 'Advertising node public key (32 B).' },
    { key: 'ts', name: 'Timestamp', len: 4, desc: 'Advert time (unix, little-endian).' },
    { key: 'rest', name: 'App Data', len: 'rest', desc: 'Flags, location, and name.' },
  ],
};

const hexToBytes = (hex: string): number[] => {
  const clean = hex.replace(/[^0-9a-fA-F]/g, '');
  const out: number[] = [];
  for (let i = 0; i + 1 < clean.length; i += 2) out.push(parseInt(clean.slice(i, i + 2), 16));
  return out;
};
const hx = (b: number[], a: number, z: number) => {
  let s = '';
  for (let i = a; i <= z && i < b.length; i++) s += b[i].toString(16).padStart(2, '0');
  return s.toUpperCase();
};

export function inspectBleFrame(payloadHex: string, codeName?: string): { codeName: string; fields: InspectField[]; bytes: number[] } {
  const bytes = hexToBytes(payloadHex);
  const last = bytes.length - 1;
  const layout = codeName ? LAYOUTS[codeName] : undefined;
  if (!layout) {
    return {
      codeName: codeName || 'frame',
      bytes,
      fields: bytes.length ? [{ key: 'body', name: 'Body', start: 0, end: last, colorIdx: 0, value: hx(bytes, 0, last), desc: 'Raw frame body.' }] : [],
    };
  }
  const fields: InspectField[] = [];
  let cursor = 0;
  layout.forEach((seg, i) => {
    if (cursor > last) return;
    const len = seg.len === 'rest' ? last - cursor + 1 : seg.len;
    const end = Math.min(cursor + len - 1, last);
    fields.push({ key: seg.key, name: seg.name, start: cursor, end, colorIdx: fieldColorIdx(i), value: hx(bytes, cursor, end), desc: seg.desc });
    cursor = end + 1;
  });
  return { codeName: codeName || 'frame', bytes, fields };
}
