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

/** RESP_CODE_OK: a bare one-byte "done" from the radio. */
const RESP_OK = 0x00;

/**
 * A replay fixture: a JSON array of frames, or `{ frames, autoOkOpcodes }`.
 * `autoOkOpcodes` lists command codes the double answers with RESP_OK, so an
 * E2E flow can save a setting and see it succeed (e.g. 14,
 * CMD_SET_ADVERT_LATLON). Any other command still goes unanswered.
 */
interface Fixture {
  frames: Buffer[];
  autoOk: ReadonlySet<number>;
}

function loadFixture(path: string): Fixture {
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as
    | FixtureFrame[]
    | { frames?: FixtureFrame[]; autoOkOpcodes?: number[] };
  const list = Array.isArray(parsed) ? parsed : parsed?.frames;
  if (!Array.isArray(list)) {
    throw new Error(`replay fixture ${path} must be a JSON array of frames, or { frames, autoOkOpcodes }`);
  }
  const autoOk = new Set(
    (Array.isArray(parsed) ? [] : (parsed.autoOkOpcodes ?? [])).filter(
      (n): n is number => Number.isInteger(n) && n >= 0 && n <= 0xff,
    ),
  );
  return { frames: parseFrames(list), autoOk };
}

function parseFrames(list: FixtureFrame[]): Buffer[] {
  const frames: Buffer[] = [];
  for (const f of list) {
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
 * CORESENSE_FAKE_TRANSPORT is set (see ./select). Outbound frames are
 * recorded, not interpreted: byte layout is covered by the integration suite,
 * and E2E asserts UI behavior rather than wire bytes. The one exception is the
 * fixture's `autoOkOpcodes`, which get a RESP_OK back (see loadFixture).
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
  // The loopback, with sends passed through answerIfAutoOk.
  readonly libTransport: Ports.Transport = {
    send: async (bytes) => {
      await this.loopback.send(bytes);
      this.answerIfAutoOk(bytes);
    },
    onData: (cb) => this.loopback.onData(cb),
    onStateChange: (cb) => this.loopback.onStateChange(cb),
    getState: () => this.loopback.getState(),
  };
  private readonly fixturePath: string;
  private autoOk: ReadonlySet<number> = new Set();
  // Pending auto-OK replies, cancelled on disconnect so none lands after it.
  private readonly pendingOk = new Set<ReturnType<typeof setTimeout>>();

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
    let fixture: Fixture;
    try {
      fixture = loadFixture(this.fixturePath);
    } catch (err) {
      log.error(`failed to load replay fixture: ${errorMessage(err)}`);
      return;
    }
    this.autoOk = fixture.autoOk;
    const { frames } = fixture;
    for (const frame of frames) {
      // Tap the packet bus (kept for any inspector/observation consumers) AND
      // feed the session through its lib Transport so the adapter ingests it.
      this.dispatch(frame);
      this.loopback.receive(Uint8Array.from(frame));
    }
    log.info(`replayed ${frames.length} frame(s) from ${this.fixturePath}`);
  }

  async disconnect(): Promise<void> {
    for (const timer of this.pendingOk) clearTimeout(timer);
    this.pendingOk.clear();
    emit.transportState('idle');
    this.loopback.setState('idle');
  }

  async sendBytes(bytes: Buffer): Promise<void> {
    this.sent.push(Buffer.from(bytes));
  }

  /** Answer a fixture-listed command with RESP_OK, as the radio would once
   *  it applied it. Deferred, so the session has registered its waiter. */
  private answerIfAutoOk(bytes: Uint8Array): void {
    if (bytes.length === 0 || !this.autoOk.has(bytes[0])) return;
    const timer = setTimeout(() => {
      this.pendingOk.delete(timer);
      if (this.loopback.getState() !== 'connected') return;
      const ok = Buffer.of(RESP_OK);
      // Both paths, as for fixture frames in connect(): the packet bus tap
      // (Packet Log, inspectors) and the session's own ingest, which resolves
      // the command's ack waiter.
      this.dispatch(ok);
      this.loopback.receive(Uint8Array.from(ok));
    }, 0);
    this.pendingOk.add(timer);
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
