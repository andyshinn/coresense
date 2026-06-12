import { Buffer } from 'node:buffer';
import { CMD } from '../codes';

// CMD_SET_ADVERT_NAME: [0x08][utf8 name]. Firmware truncates beyond 31B; we
// truncate client-side too so the wire format matches the official client.
export function encodeSetAdvertName(name: string): Buffer {
  const nameBuf = Buffer.from(name, 'utf8').subarray(0, 31);
  const out = Buffer.alloc(1 + nameBuf.length);
  out[0] = CMD.SET_ADVERT_NAME;
  nameBuf.copy(out, 1);
  return out;
}

// CMD_SET_ADVERT_LATLON: lat/lon as signed micro-degrees.
export function encodeSetAdvertLatLon(lat: number, lon: number): Buffer {
  const out = Buffer.alloc(1 + 4 + 4);
  out[0] = CMD.SET_ADVERT_LATLON;
  out.writeInt32LE(Math.round(lat * 1_000_000) | 0, 1);
  out.writeInt32LE(Math.round(lon * 1_000_000) | 0, 5);
  return out;
}

// CMD_SET_OTHER_PARAMS: telemetry policy + advert-location-policy + multi-acks.
// Layout: [0x26][reserved 0][telemetry_flags u8][advert_loc_policy u8][multi_acks u8].
export interface OtherParamsInput {
  telemetryBase: 0 | 1 | 2;
  telemetryLoc: 0 | 1 | 2;
  telemetryEnv: 0 | 1 | 2;
  /** 1 = share GPS in self-adverts, 0 = withhold. */
  advertLocationPolicy: 0 | 1;
  /** Number of duplicate ACKs to emit per inbound DM (0..2 typical). */
  multiAcks: number;
}
export function encodeSetOtherParams(input: OtherParamsInput): Buffer {
  const out = Buffer.alloc(5);
  out[0] = CMD.SET_OTHER_PARAMS;
  out[1] = 0; // reserved
  out[2] =
    ((input.telemetryEnv & 0x03) << 4) |
    ((input.telemetryLoc & 0x03) << 2) |
    (input.telemetryBase & 0x03);
  out[3] = input.advertLocationPolicy & 0x01;
  out[4] = input.multiAcks & 0xff;
  return out;
}
