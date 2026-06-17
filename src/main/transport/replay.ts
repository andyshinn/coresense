import { Buffer } from 'node:buffer';
import { readFileSync } from 'node:fs';
import { LoopbackTransport, type Transport } from '@andyshinn/meshcore-ts';
import { emit } from '../events/bus';
import { child } from '../log';
import { parseCompanionFrame } from './companionFrame';
import type { ITransport } from './types';

const log = child('replay');

/** A frame entry in a replay fixture: either a hex string or an object with a
 *  `hex` field (extra fields like `name`/`code` are ignored). */
type FixtureFrame = string | { hex: string };

function loadFrames(path: string): Buffer[] {
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as FixtureFrame[];
  if (!Array.isArray(parsed)) {
    throw new Error(`replay fixture ${path} must be a JSON array of frames`);
  }
  const frames: Buffer[] = [];
  for (const f of parsed) {
    const str = typeof f === 'string' ? f : f.hex;
    const buf = Buffer.from(str, 'hex');
    // Buffer.from(hex) silently yields a short/empty buffer on malformed hex;
    // surface and skip those rather than dispatching a bogus empty frame.
    if (str.length > 0 && buf.length === 0) {
      log.warn(`skipping malformed-hex replay frame: ${JSON.stringify(str)}`);
      continue;
    }
    frames.push(buf);
  }
  return frames;
}

/**
 * Production-resident, env-gated transport double for E2E. Reads a fixture of
 * captured companion frames and replays them onto the event bus exactly as a
 * real transport would after receiving bytes. Selected only when
 * CORESENSE_FAKE_TRANSPORT is set (see ./select). `sendBytes` is a recording
 * no-op: outbound byte layout is covered by the integration suite, and E2E
 * asserts UI behavior rather than wire bytes.
 */
export class FileReplayTransport implements ITransport {
  readonly type = 'ble' as const;
  readonly sent: Buffer[] = [];
  // Placeholder lib Transport satisfying ITransport. Phase G3 wires it to feed
  // replayed frames into the session; for now it is a plain LoopbackTransport.
  readonly libTransport: Transport = new LoopbackTransport();
  private readonly fixturePath: string;

  constructor(fixturePath: string) {
    this.fixturePath = fixturePath;
  }

  async connect(deviceId: string): Promise<void> {
    // Intentional for the test double: emit connected BEFORE loading the fixture
    // (unlike BleTransport, which only emits connected once the link is up), so
    // replay reports connected even when the fixture is empty or missing.
    emit.transportState('connected', deviceId);
    let frames: Buffer[];
    try {
      frames = loadFrames(this.fixturePath);
    } catch (err) {
      log.error(`failed to load replay fixture: ${(err as Error).message}`);
      return;
    }
    for (const frame of frames) this.dispatch(frame);
    log.info(`replayed ${frames.length} frame(s) from ${this.fixturePath}`);
  }

  async disconnect(): Promise<void> {
    emit.transportState('idle');
  }

  async sendBytes(bytes: Buffer): Promise<void> {
    this.sent.push(Buffer.from(bytes));
  }

  /** Mirror BleTransport.onData: parse the frame and emit the matching packet.
   *  The mesh-observation side-channel (path attribution) is intentionally
   *  omitted — it does not affect the E2E flows. */
  private dispatch(frame: Buffer): void {
    const parsed = parseCompanionFrame(frame);
    if (!parsed) return;
    const hex = frame.toString('hex');
    const bytes = [...frame];
    if (parsed.kind === 'mesh') {
      emit.packet({
        timestamp: 0,
        transportType: 'ble',
        kind: 'mesh',
        hex,
        bytes,
        payloadHex: parsed.meshHex,
        payloadBytes: [...parsed.meshBytes],
        snr: parsed.snr,
        rssi: parsed.rssi,
      });
    } else {
      emit.packet({
        timestamp: 0,
        transportType: 'ble',
        kind: 'companion',
        hex,
        bytes,
        payloadHex: parsed.payloadHex,
        payloadBytes: [...parsed.payloadBytes],
        code: parsed.code,
        codeName: parsed.codeName,
      });
    }
  }
}
