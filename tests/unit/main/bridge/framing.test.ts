import { Buffer } from 'node:buffer';
import { describe, expect, it } from 'vitest';
import {
  DIR_CLIENT_TO_RADIO,
  encodeFrame,
  FrameDecoder,
  MAX_FRAME_LEN,
} from '../../../../src/main/bridge/framing';

function collect(decoder: FrameDecoder, chunks: Buffer[]): string[] {
  const out: string[] = [];
  for (const c of chunks) decoder.push(c, (p) => out.push(p.toString('hex')));
  return out;
}

describe('encodeFrame', () => {
  it('prepends [direction][len u16 LE] to the payload', () => {
    const out = encodeFrame(DIR_CLIENT_TO_RADIO, Buffer.from([0x16, 0x03]));
    expect(out.toString('hex')).toBe('3c020016 03'.replace(/\s/g, ''));
  });

  it('throws when the payload exceeds MAX_FRAME_LEN', () => {
    const tooBig = Buffer.alloc(MAX_FRAME_LEN + 1);
    expect(() => encodeFrame(DIR_CLIENT_TO_RADIO, tooBig)).toThrow(/exceeds MAX_FRAME_LEN/);
  });
});

describe('FrameDecoder', () => {
  it('decodes a single whole frame', () => {
    const d = new FrameDecoder();
    const frame = encodeFrame(DIR_CLIENT_TO_RADIO, Buffer.from([0xde, 0xad]));
    expect(collect(d, [frame])).toEqual(['dead']);
  });

  it('reassembles a frame split across chunk boundaries', () => {
    const d = new FrameDecoder();
    const frame = encodeFrame(DIR_CLIENT_TO_RADIO, Buffer.from([0x01, 0x02, 0x03, 0x04]));
    // Split mid-header and again mid-payload.
    const chunks = [frame.subarray(0, 1), frame.subarray(1, 4), frame.subarray(4)];
    expect(collect(d, chunks)).toEqual(['01020304']);
  });

  it('decodes two frames delivered in one chunk', () => {
    const d = new FrameDecoder();
    const a = encodeFrame(DIR_CLIENT_TO_RADIO, Buffer.from([0xaa]));
    const b = encodeFrame(DIR_CLIENT_TO_RADIO, Buffer.from([0xbb, 0xcc]));
    expect(collect(d, [Buffer.concat([a, b])])).toEqual(['aa', 'bbcc']);
  });

  it('resyncs past leading garbage before a valid direction byte', () => {
    const d = new FrameDecoder();
    const frame = encodeFrame(DIR_CLIENT_TO_RADIO, Buffer.from([0x42]));
    const noisy = Buffer.concat([Buffer.from([0x00, 0xff, 0x3e]), frame]);
    expect(collect(d, [noisy])).toEqual(['42']);
  });

  it('drops a zero-length frame and resyncs', () => {
    const d = new FrameDecoder();
    // [0x3c][00 00] is treated as garbage; a real frame after it still decodes.
    const zero = Buffer.from([DIR_CLIENT_TO_RADIO, 0x00, 0x00]);
    const real = encodeFrame(DIR_CLIENT_TO_RADIO, Buffer.from([0x99]));
    expect(collect(d, [Buffer.concat([zero, real])])).toEqual(['99']);
  });

  it('reset() clears partial state', () => {
    const d = new FrameDecoder();
    const frame = encodeFrame(DIR_CLIENT_TO_RADIO, Buffer.from([0x01, 0x02]));
    d.push(frame.subarray(0, 3), () => {}); // header only, payload pending
    d.reset();
    // After reset, a fresh whole frame decodes cleanly with no leftover bytes.
    expect(collect(d, [encodeFrame(DIR_CLIENT_TO_RADIO, Buffer.from([0x07]))])).toEqual(['07']);
  });
});
