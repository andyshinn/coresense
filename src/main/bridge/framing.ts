// MeshCore SerialWifiInterface TCP framing.
// Frame layout: [direction:1] [length:2 LE] [payload:length]
// Direction 0x3C ('<') = client→radio, 0x3E ('>') = radio→client.
// Confirmed against rgregg/meshcore-proxy and meshcore-dev/meshcore.js.

export const DIR_CLIENT_TO_RADIO = 0x3c;
export const DIR_RADIO_TO_CLIENT = 0x3e;
export const HEADER_LEN = 3;
export const MAX_FRAME_LEN = 65535;

type State = 'WANT_DIRECTION' | 'WANT_LEN_LO' | 'WANT_LEN_HI' | 'WANT_PAYLOAD';

export class FrameDecoder {
  private state: State = 'WANT_DIRECTION';
  private payloadLen = 0;
  private payload: Buffer = Buffer.alloc(0);
  private payloadFilled = 0;

  push(chunk: Buffer, onFrame: (payload: Buffer) => void): void {
    for (let i = 0; i < chunk.length; i++) {
      const byte = chunk[i];
      switch (this.state) {
        case 'WANT_DIRECTION':
          // Silently skip any non-client direction byte; treat next byte as
          // a fresh direction. Matches meshcore-proxy's resync behavior.
          if (byte === DIR_CLIENT_TO_RADIO) {
            this.state = 'WANT_LEN_LO';
          }
          break;
        case 'WANT_LEN_LO':
          this.payloadLen = byte;
          this.state = 'WANT_LEN_HI';
          break;
        case 'WANT_LEN_HI':
          this.payloadLen |= byte << 8;
          if (this.payloadLen === 0) {
            // Zero-length is treated as garbage by the official meshcore.js
            // TCP decoder; reset and resync.
            this.state = 'WANT_DIRECTION';
          } else {
            this.payload = Buffer.allocUnsafe(this.payloadLen);
            this.payloadFilled = 0;
            this.state = 'WANT_PAYLOAD';
          }
          break;
        case 'WANT_PAYLOAD': {
          const remaining = chunk.length - i;
          const need = this.payloadLen - this.payloadFilled;
          const take = remaining < need ? remaining : need;
          chunk.copy(this.payload, this.payloadFilled, i, i + take);
          this.payloadFilled += take;
          i += take - 1; // -1 because the for-loop will i++
          if (this.payloadFilled === this.payloadLen) {
            onFrame(this.payload);
            this.payload = Buffer.alloc(0);
            this.payloadFilled = 0;
            this.payloadLen = 0;
            this.state = 'WANT_DIRECTION';
          }
          break;
        }
      }
    }
  }

  reset(): void {
    this.state = 'WANT_DIRECTION';
    this.payloadLen = 0;
    this.payload = Buffer.alloc(0);
    this.payloadFilled = 0;
  }
}

export function encodeFrame(direction: number, payload: Buffer): Buffer {
  if (payload.length > MAX_FRAME_LEN) {
    throw new Error(`Frame payload ${payload.length} exceeds MAX_FRAME_LEN ${MAX_FRAME_LEN}`);
  }
  const out = Buffer.allocUnsafe(HEADER_LEN + payload.length);
  out[0] = direction;
  out.writeUInt16LE(payload.length, 1);
  payload.copy(out, HEADER_LEN);
  return out;
}
