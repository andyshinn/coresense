import { Buffer } from 'node:buffer';
import { type Models, type Ports, Transports } from '@andyshinn/meshcore-ts';
import noble, { type Characteristic, type Peripheral } from '@stoprocent/noble';
import type { BleDevice } from '../../shared/types';
import { emit } from '../events/bus';
import { child } from '../log';
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

  private libStateCb: ((s: Models.TransportState) => void) | null = null;
  private libDataCb: ((bytes: Uint8Array) => void) | null = null;

  /** The lib Transport the MeshCoreSession consumes. Bridges noble I/O:
   *  write→rxChar, TX notifications→onBytes, connect/disconnect→state. */
  readonly libTransport: Ports.Transport = Transports.createBle({
    write: (bytes) => this.sendBytes(Buffer.from(bytes)),
    subscribe: (onBytes) => {
      this.libDataCb = onBytes;
    },
    watchState: (onState) => {
      this.libStateCb = onState;
    },
  });

  constructor() {
    noble.on('discover', this.onDiscover);
    // Transports.createBle seeds its internal state to 'connected' (correct for
    // the react-native pattern, where the transport is built only once a link
    // exists). We build this transport once at app launch, long before any
    // link, so we must report the truth — disconnected — until connect() fires
    // 'connected'. Otherwise MeshCoreSession.start() sees getState() ===
    // 'connected', runs a doomed handshake against a dead link, and then skips
    // the handshake on the first real connect (the !wasConnected→connected
    // transition never fires), so the first BLE session never syncs.
    this.libStateCb?.('idle');
  }

  async scan(): Promise<void> {
    // Refuse while a link is up rather than lying about the transport state for
    // the rest of the session. emit.transportState('scanning') below carries no
    // deviceId, so applying it blanks the connected radio's id, and stopScan()
    // used to restore 'idle' only when no peripheral was held — so a scan
    // started while connected left transportManager latched at 'scanning' with
    // the GATT link still alive and frames still flowing. Everything gated on
    // that value then misbehaves for the rest of the session: contact refresh
    // and advert-path measurement report 'offline', the auto-add write silently
    // no-ops, the 15-minute auto-refresh timer is never re-armed, and four
    // settings routes take their "app-only, no radio attached" branch and
    // return ok without ever writing to the wire. It also wipes `discovered`,
    // which findPeripheral's fast path reads. The panel's ScanButton is only
    // rendered when the state isn't 'connected', but the command palette's
    // "Scan for radios" was reachable at any time, so this was a live path.
    if (this.peripheral) {
      throw new Error(`Already connected to ${this.peripheral.id} — disconnect before scanning`);
    }
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
    // Only scan() arms this timer, so it is also the answer to "was a scan
    // actually running" — which is what decides whether this call owes the app
    // a state to replace the 'scanning' with.
    const wasScanning = this.scanTimer !== null;
    if (this.scanTimer) {
      clearTimeout(this.scanTimer);
      this.scanTimer = null;
    }
    await new Promise<void>((resolve) => noble.stopScanning(() => resolve()));
    // Restore the truth, not just the disconnected case. scan() refuses while a
    // peripheral is held, so the connected branch is belt-and-braces for a link
    // that came up while a scan window was still open — without it the
    // 'scanning' would stick for the life of the link, because connect() holds
    // the only other emit of 'connected'. Gated on wasScanning so that
    // connect()'s own opening stopScan() doesn't announce a stale 'connected'
    // one line before it announces 'connecting'.
    if (!this.peripheral) emit.transportState('idle');
    else if (wasScanning) emit.transportState('connected', this.peripheral.id);
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
      this.libStateCb?.('connected');
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
    this.libStateCb?.('idle');
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
      let timer: NodeJS.Timeout | null = null;
      const onDiscover = (p: Peripheral) => {
        if (p.id === deviceId) {
          // Ends the scan window on the success path too, which clears the
          // timer that otherwise survives a successful connect and later
          // rejects an already-settled promise.
          endScanWindow();
          resolve(p);
        }
      };
      const endScanWindow = () => {
        if (timer) clearTimeout(timer);
        timer = null;
        noble.removeListener('discover', onDiscover);
        noble.stopScanning();
      };
      void waitForPoweredOn()
        .then(() => {
          noble.on('discover', onDiscover);
          noble.startScanning([normalizeUuid(MESHCORE_SERVICE_UUID)], false, (err) => err && reject(err));
          // Stop scanning before rejecting. Nothing on connect()'s failure path
          // calls stopScan(), so a timeout that only dropped the listener left
          // noble scanning for the rest of the process: the constructor's own
          // 'discover' listener kept refilling `discovered` and re-arming
          // emitTimer, so emit.scanResults fired every 200ms — a WS broadcast
          // to every client and a permanently powered BLE radio — while the UI
          // reported 'idle'. Reconnecting to a radio that is switched off is
          // the everyday way in.
          timer = setTimeout(() => {
            endScanWindow();
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
    this.libDataCb?.(Uint8Array.from(data));
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
    this.libStateCb?.('idle');
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
