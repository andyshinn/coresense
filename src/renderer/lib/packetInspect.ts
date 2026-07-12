import type { AdvertPayload, GroupTextPayload } from '@michaelhart/meshcore-decoder';
import {
  type CryptoKeyStore,
  MeshCoreDecoder,
  type PacketStructure,
  PayloadType,
  type RouteType,
  Utils,
} from '@michaelhart/meshcore-decoder';

export interface BitRow {
  range: string;
  field: string;
  value: string;
  binary: string;
}

export interface InspectField {
  key: string;
  name: string;
  start: number; // byte index within this strip (0-based, inclusive)
  end: number;
  colorIdx: number; // 0..6 → --cs-field0..6
  value: string;
  desc?: string;
  bits?: BitRow[];
}

export type Secondary =
  | { kind: 'decrypted'; available: true; bytes: number[]; fields: InspectField[] }
  | { kind: 'appdata'; available: true; title: string; bytes: number[]; fields: InspectField[] }
  | { kind: 'encrypted'; available: false; note: string };

export interface PacketInspection {
  ok: boolean;
  size: number;
  bytes: number[];
  routeName: string;
  payloadTypeName: string;
  hashFull: string;
  hops: number;
  pathArrows: string | null;
  fields: InspectField[];
  payload: { typeName: string; bytes: number[]; fields: InspectField[]; secondary: Secondary | null } | null;
  lowConfidence?: string;
  error?: string;
}

const NUM_FIELD_COLORS = 7;
export const fieldColorIdx = (i: number) => ((i % NUM_FIELD_COLORS) + NUM_FIELD_COLORS) % NUM_FIELD_COLORS;

const hexToBytes = (hex: string): number[] => {
  const clean = hex.replace(/[^0-9a-fA-F]/g, '');
  const out: number[] = [];
  for (let i = 0; i + 1 < clean.length; i += 2) out.push(parseInt(clean.slice(i, i + 2), 16));
  return out;
};
const bin = (v: number, w: number) => (v >>> 0).toString(2).padStart(w, '0');

// Utils.getPayloadTypeName returns compact PascalCase ("GroupText", "TextMessage",
// "AnonRequest"); the UI convention is word-spaced ("Group Text", "Text Message",
// "Anon Request"). Space it here so every consumer of this adapter gets the
// display-ready form. Exported so PacketLog.tsx's list row can apply the same
// spacing to decodePacket.ts's summarizePacket().typeName, keeping the list and
// the right-rail detail (which uses this module) in agreement.
export const spaceWords = (s: string) => s.replace(/([a-z0-9])([A-Z])/g, '$1 $2');

// path_len byte → hop-count + hash-size bit rows (fallback for decoder versions that
// don't already bit-break the path-length byte themselves).
function pathLenBits(byte: number): BitRow[] {
  const hop = byte & 0b111111;
  const hashSel = (byte >> 6) & 0b11;
  return [
    { range: '6-7', field: 'Hash Size', value: `${hashSel + 1} byte(s)/hop`, binary: bin(hashSel, 2) },
    { range: '0-5', field: 'Hop Count', value: `${hop} hop${hop === 1 ? '' : 's'}`, binary: bin(hop, 6) },
  ];
}

export function buildPlaintextFields(
  timestamp: number,
  flags: number,
  message: string,
): { bytes: number[]; fields: InspectField[] } {
  const ts: number[] = [];
  let t = timestamp >>> 0;
  for (let i = 0; i < 4; i++) {
    ts.push(t & 0xff);
    t = Math.floor(t / 256);
  }
  const msg = Array.from(new TextEncoder().encode(message));
  const bytes = [...ts, flags & 0xff, ...msg];
  const fields: InspectField[] = [
    {
      key: 'pts',
      name: 'Timestamp',
      start: 0,
      end: 3,
      colorIdx: 0,
      value: bytesHex(ts, 0, 3),
      desc: 'Sender clock (unix, little-endian).',
    },
    {
      key: 'pfl',
      name: 'Flags',
      start: 4,
      end: 4,
      colorIdx: 1,
      value: bytesHex([flags & 0xff], 0, 0),
      desc: `0x${(flags & 0xff).toString(16).padStart(2, '0')}`,
    },
  ];
  if (msg.length)
    fields.push({
      key: 'ptx',
      name: 'Message',
      start: 5,
      end: bytes.length - 1,
      colorIdx: 2,
      value: message,
      desc: 'Decoded UTF-8 text.',
    });
  return { bytes, fields };
}

const bytesHex = (b: number[], a: number, z: number) => {
  let s = '';
  for (let i = a; i <= z && i < b.length; i++) s += b[i].toString(16).padStart(2, '0');
  return s.toUpperCase();
};

// Payload segment offsets from analyzeStructure() are payload-relative in every
// @michaelhart/meshcore-decoder payload branch (each calls its sub-decoder with
// `segmentOffset: 0`), but we don't trust that as an invariant across decoder versions.
// A relative index is always < payloadLen; an absolute (whole-packet) index would
// spill past it and needs re-basing against payloadStart. Note this is NOT a plain
// `start >= payloadStart` check — that comparison misfires whenever a legitimately
// relative offset happens to numerically equal or exceed payloadStart (e.g. a payload
// whose 4th field starts at relative byte 3 in a packet where the payload itself begins
// at absolute byte 3).
function normalize(index: number, payloadStart: number, payloadLen: number): number {
  return index < payloadLen ? index : index - payloadStart;
}

export function inspectPacket(hex: string, opts?: { keyStore?: CryptoKeyStore }): PacketInspection {
  const options = opts?.keyStore
    ? { keyStore: opts.keyStore, attemptDecryption: true, includeRawCiphertext: true }
    : undefined;
  try {
    const struct: PacketStructure = MeshCoreDecoder.analyzeStructure(hex, options);
    const decoded = MeshCoreDecoder.decode(hex, options);
    const bytes = hexToBytes(struct.rawHex);

    const fields: InspectField[] = struct.segments.map((seg, i) => {
      const bits = seg.headerBreakdown
        ? seg.headerBreakdown.fields.map((f) => ({
            range: f.bits,
            field: f.field,
            value: f.field === 'Payload Type' ? spaceWords(f.value) : f.value,
            binary: f.binary,
          }))
        : seg.startByte === 1 && seg.endByte === 1
          ? pathLenBits(bytes[1] ?? 0)
          : undefined;
      return {
        key: `pk${i}`,
        name: seg.name,
        start: seg.startByte,
        end: seg.endByte,
        colorIdx: fieldColorIdx(i),
        value: seg.value,
        desc: seg.description || undefined,
        bits,
      };
    });

    const pStart = struct.payload.startByte;
    const payloadBytes = hexToBytes(struct.payload.hex);
    const payloadFields: InspectField[] = struct.payload.segments.map((seg, i) => ({
      key: `pl${i}`,
      name: seg.name,
      start: normalize(seg.startByte, pStart, payloadBytes.length),
      end: normalize(seg.endByte, pStart, payloadBytes.length),
      colorIdx: fieldColorIdx(i),
      value: seg.value,
      desc: seg.description || undefined,
    }));

    const payloadTypeName = spaceWords(Utils.getPayloadTypeName(decoded.payloadType as PayloadType));

    return {
      ok: decoded.isValid,
      size: struct.totalBytes,
      bytes,
      routeName: spaceWords(Utils.getRouteTypeName(decoded.routeType as RouteType)),
      payloadTypeName,
      hashFull: struct.messageHash,
      hops: decoded.pathLength,
      pathArrows: decoded.path?.length ? decoded.path.join(' → ') : null,
      fields,
      payload: payloadBytes.length
        ? {
            typeName: payloadTypeName,
            bytes: payloadBytes,
            fields: payloadFields,
            secondary: secondaryFor(decoded, payloadBytes),
          }
        : null,
      ...(decoded.isValid ? {} : { lowConfidence: decoded.errors?.[0] ?? 'Decoder reported an invalid packet.' }),
    };
  } catch (err) {
    return {
      ok: false,
      size: 0,
      bytes: [],
      routeName: '?',
      payloadTypeName: 'invalid',
      hashFull: '',
      hops: 0,
      pathArrows: null,
      fields: [],
      payload: null,
      error: (err as Error).message,
    };
  }
}

const CHANNEL_LOCK = "No key for this channel — can't decrypt. Add the channel (with its secret) to decode the message.";
const DM_LOCK = "This message isn't addressed to us — no shared secret to decrypt.";

function secondaryFor(decoded: ReturnType<typeof MeshCoreDecoder.decode>, payloadBytes: number[]): Secondary | null {
  const d = decoded.payload.decoded;
  switch (decoded.payloadType as PayloadType) {
    case PayloadType.GroupText:
    case PayloadType.GroupData: {
      const g = d as GroupTextPayload | null;
      if (g?.decrypted) {
        const { bytes, fields } = buildPlaintextFields(g.decrypted.timestamp, g.decrypted.flags, g.decrypted.message);
        return { kind: 'decrypted', available: true, bytes, fields };
      }
      return { kind: 'encrypted', available: false, note: CHANNEL_LOCK };
    }
    case PayloadType.TextMessage:
    case PayloadType.Request:
    case PayloadType.Response:
    case PayloadType.AnonRequest:
      return { kind: 'encrypted', available: false, note: DM_LOCK };
    case PayloadType.Advert:
      return advertAppData(d as AdvertPayload | null, payloadBytes);
    default:
      return null;
  }
}

// Advert payload layout: publicKey(32) · timestamp(4) · signature(64) · appData(rest).
// App-data starts at absolute payload offset 100; slicing there gives the REAL bytes so
// the byte strip (hover) always matches the decoded decimal values shown alongside it.
function advertAppData(a: AdvertPayload | null, payloadBytes: number[]): Secondary | null {
  if (!a) return null;
  const app = payloadBytes.slice(100);
  if (app.length === 0) return null;
  const hasLoc = a.appData.hasLocation && a.appData.location;
  const fields: InspectField[] = [
    {
      key: 'aflags',
      name: 'Flags',
      start: 0,
      end: 0,
      colorIdx: 0,
      value: (app[0] ?? 0).toString(16).padStart(2, '0').toUpperCase(),
      desc: `${hasLoc ? 'has location' : 'no location'}${a.appData.hasName ? ' · has name' : ''}`,
    },
  ];
  let nameStart = 1;
  if (hasLoc && a.appData.location) {
    fields.push({
      key: 'alat',
      name: 'Latitude',
      start: 1,
      end: 4,
      colorIdx: 1,
      value: `${a.appData.location.latitude}`,
      desc: 'int32 / 1e6',
    });
    fields.push({
      key: 'alon',
      name: 'Longitude',
      start: 5,
      end: 8,
      colorIdx: 2,
      value: `${a.appData.location.longitude}`,
      desc: 'int32 / 1e6',
    });
    nameStart = 9;
  }
  if (a.appData.name) {
    fields.push({
      key: 'aname',
      name: 'Node Name',
      start: nameStart,
      end: app.length - 1,
      colorIdx: 3,
      value: a.appData.name,
      desc: 'UTF-8',
    });
  }
  return { kind: 'appdata', available: true, title: 'Advert App-Data', bytes: app, fields };
}
