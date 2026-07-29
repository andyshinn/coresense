import { fieldColorIdx, type InspectField } from './packetInspect';

interface Seg {
  key: string;
  name: string;
  len: number | 'rest';
  desc?: string;
}

// Companion-radio frame layouts. `codeName` values come from main's
// companionFrame.ts (PUSH_NAMES / RESP_NAMES); the byte offsets below are the
// frame body WITHOUT the leading 1-byte type code (main strips it into
// `payloadHex`), and were taken from the authoritative wire formats documented
// in @andyshinn/meshcore-ts. Frames not listed here fall back to a single raw
// "Body" field. Extend as new frames need breakdowns.
const LAYOUTS: Record<string, Seg[]> = {
  // [pubkey_prefix 6][path_len 1][txt_type 1][sender_ts 4 LE][text…]
  RESP_CONTACT_MSG_RECV: [
    { key: 'pk', name: 'Public Key Prefix', len: 6, desc: 'First 6 bytes of the sender public key.' },
    { key: 'plen', name: 'Path Length', len: 1, desc: 'Mesh path byte (hop count + hash size).' },
    { key: 'ttype', name: 'Text Type', len: 1, desc: '0 plain · 1 CLI-data · 2 signed.' },
    { key: 'ts', name: 'Sender Timestamp', len: 4, desc: 'Sender clock (unix, little-endian).' },
    { key: 'text', name: 'Text', len: 'rest', desc: 'UTF-8 message (signed messages prefix 4 signature bytes).' },
  ],
  // [channel_idx 1][path_len 1][txt_type 1][sender_ts 4 LE][text…]
  RESP_CHANNEL_MSG_RECV: [
    { key: 'ch', name: 'Channel Index', len: 1, desc: 'Which channel slot the message arrived on.' },
    { key: 'plen', name: 'Path Length', len: 1, desc: 'Mesh path byte (hop count + hash size).' },
    { key: 'ttype', name: 'Text Type', len: 1, desc: '0 plain · 1 CLI-data · 2 signed.' },
    { key: 'ts', name: 'Sender Timestamp', len: 4, desc: 'Sender clock (unix, little-endian).' },
    { key: 'text', name: 'Text', len: 'rest', desc: 'UTF-8 "sender: message".' },
  ],
  // [snr 1][rsv 2][pubkey_prefix 6][path_len 1][txt_type 1][sender_ts 4 LE][text…]
  RESP_CONTACT_MSG_RECV_V3: [
    { key: 'snr', name: 'SNR', len: 1, desc: 'Signed int8 ×4 (dB).' },
    { key: 'rsv', name: 'Reserved', len: 2 },
    { key: 'pk', name: 'Public Key Prefix', len: 6, desc: 'First 6 bytes of the sender public key.' },
    { key: 'plen', name: 'Path Length', len: 1, desc: 'Mesh path byte (hop count + hash size).' },
    { key: 'ttype', name: 'Text Type', len: 1, desc: '0 plain · 1 CLI-data · 2 signed.' },
    { key: 'ts', name: 'Sender Timestamp', len: 4, desc: 'Sender clock (unix, little-endian).' },
    { key: 'text', name: 'Text', len: 'rest', desc: 'UTF-8 message (signed messages prefix 4 signature bytes).' },
  ],
  // [snr 1][rsv 2][channel_idx 1][path_len 1][txt_type 1][sender_ts 4 LE][text…]
  RESP_CHANNEL_MSG_RECV_V3: [
    { key: 'snr', name: 'SNR', len: 1, desc: 'Signed int8 ×4 (dB).' },
    { key: 'rsv', name: 'Reserved', len: 2 },
    { key: 'ch', name: 'Channel Index', len: 1, desc: 'Which channel slot the message arrived on.' },
    { key: 'plen', name: 'Path Length', len: 1, desc: 'Mesh path byte (hop count + hash size).' },
    { key: 'ttype', name: 'Text Type', len: 1, desc: '0 plain · 1 CLI-data · 2 signed.' },
    { key: 'ts', name: 'Sender Timestamp', len: 4, desc: 'Sender clock (unix, little-endian).' },
    { key: 'text', name: 'Text', len: 'rest', desc: 'UTF-8 "sender: message".' },
  ],
  // [batt_mv 2 LE][storage_used_kb 4 LE][storage_total_kb 4 LE]
  RESP_BATT_AND_STORAGE: [
    { key: 'mv', name: 'Battery', len: 2, desc: 'Millivolts (uint16, little-endian).' },
    { key: 'used', name: 'Storage Used', len: 4, desc: 'Kilobytes (uint32, little-endian).' },
    { key: 'total', name: 'Storage Total', len: 4, desc: 'Kilobytes (uint32, little-endian).' },
  ],
  // [firmware_ver 1][max_contacts 1][max_channels 1][build/model/version + radio metadata…]
  RESP_DEVICE_INFO: [
    { key: 'fw', name: 'Firmware Version', len: 1, desc: 'Firmware version code.' },
    { key: 'mc', name: 'Max Contacts', len: 1, desc: 'Contact-store capacity ÷ 2.' },
    { key: 'mch', name: 'Max Channels', len: 1, desc: 'Channel-slot capacity.' },
    { key: 'meta', name: 'Metadata', len: 'rest', desc: 'Build / model / version strings and radio params.' },
  ],
  // [channel_idx 1][name 32, null-padded][secret 16]
  RESP_CHANNEL_INFO: [
    { key: 'idx', name: 'Channel Index', len: 1, desc: 'Channel slot.' },
    { key: 'name', name: 'Name', len: 32, desc: 'UTF-8, null-padded.' },
    { key: 'secret', name: 'Secret', len: 16, desc: 'Shared channel key (16 bytes).' },
  ],
  // [epoch 4 LE]
  RESP_CURR_TIME: [{ key: 'epoch', name: 'Device Clock', len: 4, desc: 'Unix epoch (uint32, little-endian).' }],
  // [route_flag 1][expected_ack 4][est_timeout_ms 4 LE]
  RESP_SENT: [
    { key: 'route', name: 'Route Flag', len: 1, desc: 'Non-zero = flood.' },
    { key: 'ack', name: 'Expected ACK', len: 4, desc: 'CRC the recipient will echo.' },
    { key: 'to', name: 'Est. Timeout', len: 4, desc: 'Milliseconds (uint32, little-endian).' },
  ],
  // [err_code 1]
  RESP_ERR: [{ key: 'err', name: 'Error Code', len: 1, desc: 'See companion protocol error table.' }],
  // [pubkey 32] — a known contact re-advertised.
  PUSH_ADVERT: [{ key: 'pk', name: 'Public Key', len: 32, desc: 'Advertising node public key (32 B).' }],
  // [pubkey 32]
  PUSH_PATH_UPDATED: [{ key: 'pk', name: 'Public Key', len: 32, desc: 'Contact whose route was updated.' }],
  // [ack 4][round_trip_ms 4 LE]
  PUSH_SEND_CONFIRMED: [
    { key: 'ack', name: 'ACK Code', len: 4, desc: 'CRC that was confirmed.' },
    { key: 'trip', name: 'Round-trip', len: 4, desc: 'Milliseconds (uint32, little-endian).' },
  ],
  // [snr 1][rssi 1][path_len 1][control data…]
  PUSH_CONTROL_DATA: [
    { key: 'snr', name: 'SNR', len: 1, desc: 'Signed int8 ×4 (dB).' },
    { key: 'rssi', name: 'RSSI', len: 1, desc: 'Signed int8 (dBm).' },
    { key: 'plen', name: 'Path Length', len: 1 },
    { key: 'data', name: 'Control Data', len: 'rest', desc: 'Zero-hop control datagram.' },
  ],
};

// One-line "what is this frame" note for the details rail. Keyed by codeName.
const FRAME_PURPOSE: Record<string, string> = {
  RESP_OK: 'Command acknowledged by the radio.',
  RESP_ERR: 'The radio rejected the last command.',
  RESP_CONTACT: 'One entry from the radio’s contact store.',
  RESP_CONTACTS_START: 'Start of a contact-list dump.',
  RESP_END_OF_CONTACTS: 'End of the contact-list dump.',
  RESP_SELF_INFO: 'This radio’s own identity and radio settings.',
  RESP_SENT: 'A message was queued for transmission.',
  RESP_CONTACT_MSG_RECV: 'A direct message received from a contact.',
  RESP_CONTACT_MSG_RECV_V3: 'A direct message received from a contact (v3, carries SNR).',
  RESP_CHANNEL_MSG_RECV: 'A message received on a group channel.',
  RESP_CHANNEL_MSG_RECV_V3: 'A message received on a group channel (v3, carries SNR).',
  RESP_CURR_TIME: 'The radio’s current clock.',
  RESP_NO_MORE_MESSAGES: 'The inbound message queue is empty.',
  RESP_BATT_AND_STORAGE: 'Battery voltage and flash-storage usage.',
  RESP_DEVICE_INFO: 'Firmware version, model, and capabilities.',
  RESP_CHANNEL_INFO: 'A configured group channel (name + secret).',
  PUSH_ADVERT: 'A known contact re-advertised itself.',
  PUSH_NEW_ADVERT: 'A new node advertised itself on the mesh.',
  PUSH_PATH_UPDATED: 'The radio updated its route to a contact.',
  PUSH_SEND_CONFIRMED: 'A sent message was acknowledged by the recipient.',
  PUSH_MSG_WAITING: 'Messages are waiting — poll with Get Message.',
  PUSH_CONTROL_DATA: 'A live inbound control datagram.',
};

/** Human-readable purpose of a companion frame, or '' if we have no note for it. */
export const bleFramePurpose = (codeName?: string): string => (codeName ? (FRAME_PURPOSE[codeName] ?? '') : '');

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

export function inspectBleFrame(
  payloadHex: string,
  codeName?: string,
): { codeName: string; fields: InspectField[]; bytes: number[] } {
  const bytes = hexToBytes(payloadHex);
  const last = bytes.length - 1;
  const layout = codeName ? LAYOUTS[codeName] : undefined;
  if (!layout) {
    return {
      codeName: codeName || 'frame',
      bytes,
      fields: bytes.length
        ? [
            {
              key: 'body',
              name: 'Body',
              start: 0,
              end: last,
              colorIdx: 0,
              value: hx(bytes, 0, last),
              desc: 'Raw frame body.',
            },
          ]
        : [],
    };
  }
  const fields: InspectField[] = [];
  let cursor = 0;
  layout.forEach((seg, i) => {
    if (cursor > last) return;
    const len = seg.len === 'rest' ? last - cursor + 1 : seg.len;
    const end = Math.min(cursor + len - 1, last);
    fields.push({
      key: seg.key,
      name: seg.name,
      start: cursor,
      end,
      colorIdx: fieldColorIdx(i),
      value: hx(bytes, cursor, end),
      desc: seg.desc,
    });
    cursor = end + 1;
  });
  return { codeName: codeName || 'frame', bytes, fields };
}

// ---- List DETAILS summary -------------------------------------------------
// A concise one-line summary of a companion frame for the packet-log DETAILS
// column (companion frames carry no mesh-decodable payload, so summarizePacket
// can't help). Offsets mirror the LAYOUTS above (payload = frame minus code byte).

const u16 = (b: number[], o: number) => (b[o] ?? 0) | ((b[o + 1] ?? 0) << 8);
const u32 = (b: number[], o: number) =>
  ((b[o] ?? 0) | ((b[o + 1] ?? 0) << 8) | ((b[o + 2] ?? 0) << 16) | ((b[o + 3] ?? 0) << 24)) >>> 0;

const utf8 = (b: number[], a: number, z: number): string => {
  if (a > z || a >= b.length) return '';
  const decoded = new TextDecoder().decode(Uint8Array.from(b.slice(a, z + 1)));
  // Collapse control chars (a mis-parse or binary tail shouldn't smear the row).
  let out = '';
  for (const ch of decoded) {
    const c = ch.codePointAt(0) ?? 0;
    out += c < 0x20 || c === 0x7f ? ' ' : ch;
  }
  return out.replace(/\s+/g, ' ').trim();
};

const clip = (s: string, n = 44) => (s.length > n ? `${s.slice(0, n)}…` : s);

const ERR_NAMES: Record<number, string> = {
  1: 'unsupported cmd',
  2: 'not found',
  3: 'table full',
  4: 'bad state',
  5: 'file I/O',
  6: 'illegal arg',
};

function contactMsgSummary(b: number[], v3: boolean): string {
  const pkOff = v3 ? 3 : 0;
  const txtTypeOff = v3 ? 10 : 7;
  const bodyBase = v3 ? 15 : 12;
  const bodyStart = b[txtTypeOff] === 2 ? bodyBase + 4 : bodyBase;
  const prefix = hx(b, pkOff, pkOff + 5);
  const text = utf8(b, bodyStart, b.length - 1);
  return text ? `${prefix} · “${clip(text)}”` : prefix;
}

function channelMsgSummary(b: number[], v3: boolean): string {
  const chOff = v3 ? 3 : 0;
  const bodyStart = v3 ? 10 : 7;
  const text = utf8(b, bodyStart, b.length - 1);
  const ch = `#${b[chOff] ?? 0}`;
  return text ? `${ch} ${clip(text)}` : ch;
}

/** Concise one-line summary for the DETAILS column, or '' when nothing useful. */
export function summarizeBleFrame(payloadHex: string, codeName?: string): string {
  const b = hexToBytes(payloadHex);
  switch (codeName) {
    case 'RESP_CONTACT_MSG_RECV':
      return contactMsgSummary(b, false);
    case 'RESP_CONTACT_MSG_RECV_V3':
      return contactMsgSummary(b, true);
    case 'RESP_CHANNEL_MSG_RECV':
      return channelMsgSummary(b, false);
    case 'RESP_CHANNEL_MSG_RECV_V3':
      return channelMsgSummary(b, true);
    case 'RESP_BATT_AND_STORAGE':
      return `${(u16(b, 0) / 1000).toFixed(2)} V · ${(u32(b, 2) / 1024).toFixed(1)}/${(u32(b, 6) / 1024).toFixed(1)} MB`;
    case 'RESP_DEVICE_INFO':
      return `firmware v${b[0] ?? '?'}${b.length > 2 ? ` · ${b[2]} channels` : ''}`;
    case 'RESP_CHANNEL_INFO': {
      const name = utf8(b, 1, 32);
      return name ? `#${b[0] ?? 0} “${name}”` : `#${b[0] ?? 0}`;
    }
    case 'RESP_CURR_TIME':
      return `unix ${u32(b, 0)}`;
    case 'RESP_OK':
      return b.length >= 4 ? `ok (${u32(b, 0)})` : 'ok';
    case 'RESP_ERR':
      return `error: ${ERR_NAMES[b[0] ?? -1] ?? b[0] ?? '?'}`;
    case 'RESP_NO_MORE_MESSAGES':
      return 'queue empty';
    case 'PUSH_MSG_WAITING':
      return 'messages waiting';
    case 'RESP_SENT':
      return `ack ${hx(b, 1, 4)}`;
    case 'PUSH_SEND_CONFIRMED':
      return `confirmed ${hx(b, 0, 3)} · ${u32(b, 4)} ms`;
    case 'PUSH_ADVERT':
    case 'PUSH_PATH_UPDATED':
      return b.length ? `key ${hx(b, 0, 5)}…` : '';
    default:
      return b.length ? `${b.length} B` : '';
  }
}
