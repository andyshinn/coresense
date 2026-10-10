import { Buffer } from 'node:buffer';
import { readFileSync } from 'node:fs';
import { type Ports, Protocol, Transports } from '@andyshinn/meshcore-ts';
import { errorMessage } from '../../shared/errors';
import { emit } from '../events/bus';
import { child } from '../log';
import { toRawPacket } from './rawPacket';
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
  // Deliberately impersonates BLE (and stamps packets transportType 'ble'): a
  // 'replay' member would leak this test double into the renderer-facing
  // RawPacket.transportType union.
  readonly type = 'ble' as const;
  readonly sent: Buffer[] = [];
  // The lib Transport the SessionAdapter's MeshCoreSession ingests. A
  // Transports.Loopback lets us push state transitions (drives the handshake) and
  // deliver each recorded frame into the session via receive().
  private readonly loopback = new Transports.Loopback();
  readonly libTransport: Ports.Transport = this.loopback;
  private readonly fixturePath: string;

  constructor(fixturePath: string) {
    this.fixturePath = fixturePath;
  }

  async connect(deviceId: string): Promise<void> {
    // Intentional for the test double: signal connected BEFORE loading the
    // fixture (unlike BleTransport, which only connects once the link is up), so
    // replay reports connected even when the fixture is empty or missing.
    // emit.transportState feeds the renderer's connection UI; loopback.setState
    // drives the MeshCoreSession's post-connect handshake.
    emit.transportState('connected', deviceId);
    this.loopback.setState('connected');
    let frames: Buffer[];
    try {
      frames = loadFrames(this.fixturePath);
    } catch (err) {
      log.error(`failed to load replay fixture: ${errorMessage(err)}`);
      return;
    }
    for (const frame of frames) {
      // Tap the packet bus (kept for any inspector/observation consumers) AND
      // feed the session through its lib Transport so the adapter ingests it.
      this.dispatch(frame);
      this.loopback.receive(Uint8Array.from(frame));
    }
    log.info(`replayed ${frames.length} frame(s) from ${this.fixturePath}`);
  }

  async disconnect(): Promise<void> {
    emit.transportState('idle');
    this.loopback.setState('idle');
  }

  async sendBytes(bytes: Buffer): Promise<void> {
    this.sent.push(Buffer.from(bytes));
  }

  /** Mirror BleTransport.onData: parse the frame and emit the matching packet.
   *  The mesh-observation side-channel (path attribution) is intentionally
   *  omitted — it does not affect the E2E flows. */
  private dispatch(frame: Buffer): void {
    const parsed = Protocol.parseCompanionFrame(frame);
    if (!parsed) return;
    emit.packet(toRawPacket(frame, parsed, { timestamp: 0, transportType: 'ble' }));
  }
}
