import { createHash } from 'node:crypto';
import noble, { type Characteristic, type Peripheral } from '@stoprocent/noble';
import type { BleDevice } from '../../shared/types';
import { emit } from '../events/bus';
import { child } from '../log';
import { record as recordMeshObservation } from '../protocol/meshObservations';
import { PAYLOAD_TYPE, parseMeshPacket } from '../protocol/meshPacket';
import { attributeObservation as attributeOutgoingChannelRelay } from '../protocol/pendingChannelSends';
import { parseCompanionFrame } from './companionFrame';
import type { ITransport } from './types';

const logger = child('transport:ble');

// Intentional no-op for swallowed rejections and required-but-unused callbacks.
const noop = (): void => {
  /* no-op */
};

// MeshCore BLE UUIDs and known device-name prefixes.
// Source: https://github.com/zjs81/meshcore-open/blob/main/lib/connector/meshcore_uuids.dart
// Naming follows the device's perspective: the device's "TX" characteristic is
// where it transmits notifications to us; its "RX" is where we write commands.
export const MESHCORE_SERVICE_UUID = process.env.MESHCORE_SERVICE_UUID ?? '6e400001-b5a3-f393-e0a9-e50e24dcca9e';
export const MESHCORE_RX_CHAR_UUID = process.env.MESHCORE_RX_CHAR_UUID ?? '6e400002-b5a3-f393-e0a9-e50e24dcca9e';
export const MESHCORE_TX_CHAR_UUID = process.env.MESHCORE_TX_CHAR_UUID ?? '6e400003-b5a3-f393-e0a9-e50e24dcca9e';

export const MESHCORE_NAME_PREFIXES = ['MeshCore-', 'Whisper-', 'WisCore-', 'Seeed', 'Lilygo', 'HT-', 'LowMesh_MC_'];

const SCAN_TIMEOUT_MS = 10_000;
const SCAN_RESULTS_DEBOUNCE_MS = 200;
// noble's write callback can silently never fire if the peripheral has dropped
// the link without the OS noticing yet. Without a bound, the hub send-worker
// awaits forever and the per-client queue fills until everything is dropped.
// Erring on the patient side: a transient adapter/LL stall can briefly delay
// the callback even when the link is healthy. We do NOT auto-retry on timeout
// because rxChar.write(..., false, ...) is write-without-response — the
// callback fires when bytes are queued locally, not when the device acks,
// so a "timeout" can race a write that actually went through, and replaying
// non-idempotent commands like CMD_GET_NEXT_MSG would corrupt inbox state.
const WRITE_TIMEOUT_MS = 15_000;
// Reconnect backoff. Doubles after each failure, capped, with a small jitter
// so we don't sync up with other clients hammering the same peripheral.
const RECONNECT_BASE_DELAY_MS = 3_000;
const RECONNECT_MAX_DELAY_MS = 60_000;
// Per-step timeouts during connect(). noble's callbacks for connect() and
// discoverSomeServicesAndCharacteristics() can hang if the underlying GATT
// transaction wedges; bound them so the reconnect loop can retry.
const GATT_CONNECT_TIMEOUT_MS = 15_000;
const GATT_DISCOVER_TIMEOUT_MS = 15_000;
const GATT_SUBSCRIBE_TIMEOUT_MS = 10_000;

function waitForPoweredOn(): Promise<void> {
  if ((noble as unknown as { state: string }).state === 'poweredOn') return Promise.resolve();
  return new Promise((resolve, reject) => {
    const onState = (state: string) => {
      if (state === 'poweredOn') {
        noble.removeListener('stateChange', onState);
        resolve();
      } else if (state === 'unsupported' || state === 'unauthorized') {
        noble.removeListener('stateChange', onState);
        reject(new Error(`BLE adapter state: ${state}`));
      }
    };
    noble.on('stateChange', onState);
  });
}

function isMeshCoreDevice(p: Peripheral): boolean {
  const advertisedUuids = p.advertisement?.serviceUuids ?? [];
  if (advertisedUuids.some((u) => normalizeUuid(u) === normalizeUuid(MESHCORE_SERVICE_UUID))) {
    return true;
  }
  const name = p.advertisement?.localName ?? '';
  return MESHCORE_NAME_PREFIXES.some((prefix) => name.startsWith(prefix));
}

export class BleTransport implements ITransport {
  readonly type = 'ble' as const;

  private discovered = new Map<string, BleDevice>();
  private scanTimer: NodeJS.Timeout | null = null;
  private emitTimer: NodeJS.Timeout | null = null;
  private peripheral: Peripheral | null = null;
  private txChar: Characteristic | null = null;
  private userDisconnected = false;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private abortInFlightWrite: ((err: Error) => void) | null = null;
  // Serializes every rxChar.write across all callers (renderer protocol session,
  // inbox drain, bridge clients). noble's onceExclusive('write') means a second
  // write issued before the first's callback fires queues its callback; if the
  // first stalls, both end up timing out and we force-disconnect a healthy link.
  private writeChain: Promise<void> = Promise.resolve();
  private reconnectAttempts = 0;
  // Gate so onPeripheralDisconnect can run idempotently even if both noble's
  // 'disconnect' event and our forceLinkDead() invoke it for the same session.
  private disconnectHandled = false;

  constructor() {
    noble.on('discover', this.onDiscover);
  }

  async scan(): Promise<void> {
    await waitForPoweredOn();
    this.discovered.clear();
    emit.scanResults([]);
    emit.transportState('scanning');
    // Pass the service UUID as a hint to the OS (some platforms honour this to
    // pre-filter results). We additionally filter in onDiscover by name prefix
    // for devices that don't advertise the service UUID in their packet.
    await new Promise<void>((resolve, reject) => {
      noble.startScanning([normalizeUuid(MESHCORE_SERVICE_UUID)], false, (err) => (err ? reject(err) : resolve()));
    });
    if (this.scanTimer) clearTimeout(this.scanTimer);
    this.scanTimer = setTimeout(() => void this.stopScan(), SCAN_TIMEOUT_MS);
  }

  async stopScan(): Promise<void> {
    if (this.scanTimer) {
      clearTimeout(this.scanTimer);
      this.scanTimer = null;
    }
    await new Promise<void>((resolve) => noble.stopScanning(() => resolve()));
    if (!this.peripheral) emit.transportState('idle');
  }

  async connect(deviceId: string): Promise<void> {
    this.userDisconnected = false;
    this.disconnectHandled = false;
    await this.stopScan();
    logger.info(`connecting to ${deviceId}`);
    emit.transportState('connecting', deviceId);

    try {
      const peripheral = await this.findPeripheral(deviceId);
      this.peripheral = peripheral;

      await withTimeout(
        new Promise<void>((resolve, reject) => {
          peripheral.connect((err) => (err ? reject(err) : resolve()));
        }),
        GATT_CONNECT_TIMEOUT_MS,
        'peripheral.connect',
      );
      logger.debug(`gatt connected to ${deviceId}; discovering services`);

      const { characteristics } = await withTimeout(
        new Promise<{ characteristics: Characteristic[] }>((resolve, reject) => {
          peripheral.discoverSomeServicesAndCharacteristics(
            [normalizeUuid(MESHCORE_SERVICE_UUID)],
            [normalizeUuid(MESHCORE_RX_CHAR_UUID), normalizeUuid(MESHCORE_TX_CHAR_UUID)],
            (err, _services, chars) => (err ? reject(err) : resolve({ characteristics: chars })),
          );
        }),
        GATT_DISCOVER_TIMEOUT_MS,
        'discoverSomeServicesAndCharacteristics',
      );

      // The device's TX characteristic is what we subscribe to for incoming data.
      const tx = characteristics.find((c) => c.uuid === normalizeUuid(MESHCORE_TX_CHAR_UUID));
      if (!tx) throw new Error(`MeshCore TX characteristic ${MESHCORE_TX_CHAR_UUID} not found`);
      this.txChar = tx;

      tx.on('data', this.onData);
      await withTimeout(
        new Promise<void>((resolve, reject) => tx.subscribe((err) => (err ? reject(err) : resolve()))),
        GATT_SUBSCRIBE_TIMEOUT_MS,
        'characteristic.subscribe',
      );

      peripheral.once('disconnect', () => this.onPeripheralDisconnect(deviceId));
      this.reconnectAttempts = 0;
      logger.info(`connected ${deviceId}; notifications subscribed`);
      emit.transportState('connected', deviceId);
    } catch (err) {
      // Connect failed mid-way: tear down any partial state and release the
      // 'connecting' UI state so the user can pick a device and try again.
      if (this.txChar) {
        this.txChar.removeListener('data', this.onData);
        this.txChar = null;
      }
      if (this.peripheral) {
        const p = this.peripheral;
        this.peripheral = null;
        try {
          await new Promise<void>((resolve) => p.disconnect(() => resolve()));
        } catch {
          // best-effort cleanup
        }
      }
      emit.transportState('idle');
      throw err;
    }
  }

  async disconnect(): Promise<void> {
    this.userDisconnected = true;
    this.disconnectHandled = true;
    this.reconnectAttempts = 0;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.abortInFlightWrite?.(new Error('Disconnected'));
    if (this.txChar) {
      this.txChar.removeListener('data', this.onData);
      this.txChar = null;
    }
    if (this.peripheral) {
      const p = this.peripheral;
      this.peripheral = null;
      await new Promise<void>((resolve) => p.disconnect(() => resolve()));
    }
    emit.transportState('idle');
  }

  // Releases noble's native CBCentralManager so the Electron process can exit
  // on macOS. Only safe at app shutdown — noble cannot be re-initialized in
  // the same process after stop().
  async shutdown(): Promise<void> {
    await this.disconnect();
    try {
      noble.stop();
    } catch (err) {
      logger.warn(`noble.stop() threw: ${(err as Error).message}`);
    }
  }

  async sendBytes(bytes: Buffer): Promise<void> {
    // Chain onto writeChain so concurrent callers (renderer, inbox drain,
    // bridge clients) issue rxChar.write one at a time. A failed write does
    // not break the chain — we swallow the prior error here so the next
    // caller still runs; their own awaiter already saw the rejection.
    const prev = this.writeChain;
    const run = prev.catch(noop).then(() => this.doWrite(bytes));
    this.writeChain = run.catch(noop);
    return run;
  }

  private async doWrite(bytes: Buffer): Promise<void> {
    if (!this.peripheral) throw new Error('Not connected');
    // The device's RX characteristic is where we write commands.
    const rxChar = this.peripheral.services
      .flatMap((s) => s.characteristics)
      .find((c) => c.uuid === normalizeUuid(MESHCORE_RX_CHAR_UUID));
    if (!rxChar) throw new Error('RX characteristic not found');
    logger.trace(
      `BLE_TX ${bytes.length}B cmd=0x${(bytes[0] ?? 0).toString(16).padStart(2, '0')} hex=${bytes.toString('hex')}`,
    );
    // Bound this write so the hub send-worker can't hang on a callback that
    // never fires. abortInFlightWrite lets a peripheral 'disconnect' reject
    // it immediately instead of waiting for the timeout.
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const settle = (err?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.abortInFlightWrite = null;
        if (err) reject(err);
        else resolve();
      };
      const timer = setTimeout(() => {
        logger.warn(`BLE write timed out after ${WRITE_TIMEOUT_MS}ms; assuming link is dead`);
        settle(new Error(`BLE write timeout after ${WRITE_TIMEOUT_MS}ms`));
        this.forceLinkDead('write-timeout');
      }, WRITE_TIMEOUT_MS);
      this.abortInFlightWrite = (err) => settle(err);
      rxChar.write(bytes, false, (err) => settle(err ?? undefined));
    });
  }

  private findPeripheral(deviceId: string): Promise<Peripheral> {
    // If we already saw this device in the most recent scan, use it directly.
    const existing = this.discovered.get(deviceId);
    if (existing) {
      const peripheral = (noble as unknown as { _peripherals?: Map<string, Peripheral> })._peripherals?.get(deviceId);
      if (peripheral) return Promise.resolve(peripheral);
    }
    return new Promise((resolve, reject) => {
      const onDiscover = (p: Peripheral) => {
        if (p.id === deviceId) {
          noble.removeListener('discover', onDiscover);
          noble.stopScanning();
          resolve(p);
        }
      };
      void waitForPoweredOn()
        .then(() => {
          noble.on('discover', onDiscover);
          noble.startScanning([normalizeUuid(MESHCORE_SERVICE_UUID)], false, (err) => err && reject(err));
          setTimeout(() => {
            noble.removeListener('discover', onDiscover);
            reject(new Error(`Device ${deviceId} not found within scan window`));
          }, SCAN_TIMEOUT_MS);
        })
        .catch(reject);
    });
  }

  private onDiscover = (p: Peripheral) => {
    if (!isMeshCoreDevice(p)) return;
    this.discovered.set(p.id, {
      id: p.id,
      name: p.advertisement?.localName ?? null,
      rssi: p.rssi,
    });
    if (this.emitTimer) return;
    this.emitTimer = setTimeout(() => {
      this.emitTimer = null;
      emit.scanResults([...this.discovered.values()]);
    }, SCAN_RESULTS_DEBOUNCE_MS);
  };

  private onData = (data: Buffer, _isNotification: boolean) => {
    const parsed = parseCompanionFrame(data);
    const fullHex = data.toString('hex');
    if (!parsed) {
      logger.trace(`BLE_RX ${data.length}B (unparsed) hex=${fullHex}`);
      return;
    }
    if (parsed.kind === 'companion') {
      logger.trace(
        `BLE_RX ${data.length}B ${parsed.codeName} (0x${parsed.code.toString(16).padStart(2, '0')}) payload=${parsed.payloadBytes.length}B hex=${fullHex}`,
      );
    } else {
      logger.trace(
        `BLE_RX ${data.length}B mesh snr=${parsed.snr} rssi=${parsed.rssi} bytes=${parsed.meshBytes.length} hex=${fullHex}`,
      );
    }
    const fullBytes = [...data];
    if (parsed.kind === 'mesh') {
      // PUSH_CODE_LOG_RX_DATA (0x88) carries the raw on-air mesh packet,
      // including the per-hop path bytes our PathViewer renders. Decode it
      // here and tee the observation into the side-channel buffer so the
      // later RESP_CHANNEL_MSG_RECV_V3 can correlate.
      if (parsed.source === 'log_rx') {
        const mesh = parseMeshPacket(parsed.meshBytes);
        if (mesh && mesh.payloadType === PAYLOAD_TYPE.GRP_TXT && mesh.payload.length >= 1) {
          const channelHash = mesh.payload[0];
          const encrypted = mesh.payload.subarray(1);
          const payloadFingerprint = createHash('sha1').update(encrypted).digest('hex').slice(0, 16);
          const observation = {
            recordedAt: Date.now(),
            channelHash,
            hashSize: mesh.hashSize,
            hashCount: mesh.hashCount,
            pathHex: mesh.pathHex,
            finalSnr: parsed.snr,
            payloadFingerprint,
          };
          recordMeshObservation(observation);
          // If this observation is a repeater relaying one of our recent
          // outgoing channel sends, attribute it back to that message — the
          // helper appends a MessagePath and broadcasts messagePathHeard.
          attributeOutgoingChannelRelay(observation);
        }
      }
      emit.packet({
        timestamp: Date.now(),
        transportType: 'ble',
        kind: 'mesh',
        hex: fullHex,
        bytes: fullBytes,
        payloadHex: parsed.meshHex,
        payloadBytes: [...parsed.meshBytes],
        snr: parsed.snr,
        rssi: parsed.rssi,
      });
    } else {
      emit.packet({
        timestamp: Date.now(),
        transportType: 'ble',
        kind: 'companion',
        hex: fullHex,
        bytes: fullBytes,
        payloadHex: parsed.payloadHex,
        payloadBytes: [...parsed.payloadBytes],
        code: parsed.code,
        codeName: parsed.codeName,
      });
    }
  };

  private onPeripheralDisconnect = (deviceId: string) => {
    // Both forceLinkDead() and noble's 'disconnect' event can land here for
    // the same session; the second invocation must be a no-op so we don't
    // schedule overlapping reconnects.
    if (this.disconnectHandled) return;
    this.disconnectHandled = true;
    logger.warn(`peripheral disconnected ${deviceId} userInitiated=${this.userDisconnected}`);
    this.abortInFlightWrite?.(new Error('Peripheral disconnected'));
    if (this.txChar) {
      this.txChar.removeListener('data', this.onData);
      this.txChar = null;
    }
    this.peripheral = null;
    emit.transportState('idle', deviceId);
    if (this.userDisconnected) return;
    this.scheduleReconnect(deviceId);
  };

  private scheduleReconnect(deviceId: string): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    const attempt = this.reconnectAttempts;
    const exp = Math.min(RECONNECT_BASE_DELAY_MS * 2 ** attempt, RECONNECT_MAX_DELAY_MS);
    const jitter = Math.floor(Math.random() * 1000);
    const delay = exp + jitter;
    this.reconnectAttempts = attempt + 1;
    logger.info(`reconnect to ${deviceId} scheduled in ${delay}ms (attempt ${attempt + 1})`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.userDisconnected) return;
      this.connect(deviceId).catch((err) => {
        logger.warn(`reconnect to ${deviceId} failed: ${(err as Error).message}`);
        emit.error(`Reconnect to ${deviceId} failed: ${(err as Error).message}`);
        // connect() may have left peripheral set if it failed mid-way; clean
        // up so the next attempt starts fresh.
        this.peripheral = null;
        if (this.txChar) {
          this.txChar.removeListener('data', this.onData);
          this.txChar = null;
        }
        if (!this.userDisconnected) this.scheduleReconnect(deviceId);
      });
    }, delay);
  }

  // noble's 'disconnect' event isn't reliable when the link dies silently
  // (BLE supervision timeout, adapter sleep). When we notice another way —
  // a write timeout, or no rx traffic for too long — force the disconnect
  // path so the reconnect timer kicks in.
  private forceLinkDead(reason: string): void {
    const p = this.peripheral;
    if (!p) return;
    const deviceId = p.id;
    logger.warn(`forcing disconnect for ${deviceId} (${reason})`);
    try {
      p.disconnect(noop);
    } catch (err) {
      logger.warn(`forced disconnect threw: ${(err as Error).message}`);
    }
    // Drive the disconnect path synchronously in case noble's callback
    // doesn't fire either.
    this.onPeripheralDisconnect(deviceId);
  }
}

function normalizeUuid(uuid: string): string {
  // noble normalises UUIDs to lowercase no-dashes.
  return uuid.toLowerCase().replace(/-/g, '');
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${ms}ms`));
    }, ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}
