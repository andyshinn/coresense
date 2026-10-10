// Turns a received companion frame into the RawPacket the packet bus carries.
// Frame parsing itself is the library's (Protocol.parseCompanionFrame); this
// only shapes the result, so BleTransport and FileReplayTransport stamp
// identical packets.

import type { Protocol } from '@andyshinn/meshcore-ts';
import type { RawPacket } from '../../shared/types';

/** Build the packet-bus entry for `frame`. `hex`/`bytes` are the verbatim frame
 *  (what the bridge fans out); the payload fields are the mesh packet for a
 *  0x84/0x88 push, or the bytes after the type code for anything else. */
export function toRawPacket(
  frame: Buffer,
  parsed: Protocol.ParsedFrame,
  opts: { timestamp: number; transportType: RawPacket['transportType'] },
): RawPacket {
  const { timestamp, transportType } = opts;
  const hex = frame.toString('hex');
  const bytes = [...frame];
  if (parsed.kind === 'mesh') {
    return {
      timestamp,
      transportType,
      kind: 'mesh',
      hex,
      bytes,
      payloadHex: parsed.meshHex,
      payloadBytes: [...parsed.meshBytes],
      snr: parsed.snr,
      rssi: parsed.rssi,
    };
  }
  return {
    timestamp,
    transportType,
    kind: 'companion',
    hex,
    bytes,
    payloadHex: parsed.payloadHex,
    payloadBytes: [...parsed.payloadBytes],
    code: parsed.code,
    codeName: parsed.codeName,
  };
}
