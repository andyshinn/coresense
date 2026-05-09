import noble, { type Characteristic, type Peripheral } from '@stoprocent/noble';
import type { BleDevice } from '../../shared/types';
import { emit } from '../events/bus';
import { child } from '../log';
import { parseCompanionFrame } from './companionFrame';
import type { ITransport } from './types';

const logger = child('transport:ble');

// MeshCore BLE UUIDs and known device-name prefixes.
// Source: https://github.com/zjs81/meshcore-open/blob/main/lib/connector/meshcore_uuids.dart
// Naming follows the device's perspective: the device's "TX" characteristic is
// where it transmits notifications to us; its "RX" is where we write commands.
export const MESHCORE_SERVICE_UUID =
  process.env.MESHCORE_SERVICE_UUID ?? '6e400001-b5a3-f393-e0a9-e50e24dcca9e';
export const MESHCORE_RX_CHAR_UUID =
  process.env.MESHCORE_RX_CHAR_UUID ?? '6e400002-b5a3-f393-e0a9-e50e24dcca9e';
export const MESHCORE_TX_CHAR_UUID =
  process.env.MESHCORE_TX_CHAR_UUID ?? '6e400003-b5a3-f393-e0a9-e50e24dcca9e';

export const MESHCORE_NAME_PREFIXES = [
  'MeshCore-',
  'Whisper-',
  'WisCore-',
  'Seeed',
  'Lilygo',
  'HT-',
  'LowMesh_MC_',
];

const SCAN_TIMEOUT_MS = 10_000;
const RECONNECT_DELAY_MS = 3_000;
const SCAN_RESULTS_DEBOUNCE_MS = 200;

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
      noble.startScanning([normalizeUuid(MESHCORE_SERVICE_UUID)], false, (err) =>
        err ? reject(err) : resolve(),
      );
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
    await this.stopScan();
    logger.info(`connecting to ${deviceId}`);
    emit.transportState('connecting', deviceId);

    const peripheral = await this.findPeripheral(deviceId);
    this.peripheral = peripheral;

    await new Promise<void>((resolve, reject) => {
      peripheral.connect((err) => (err ? reject(err) : resolve()));
    });
    logger.debug(`gatt connected to ${deviceId}; discovering services`);

    const { characteristics } = await new Promise<{
      characteristics: Characteristic[];
    }>((resolve, reject) => {
      peripheral.discoverSomeServicesAndCharacteristics(
        [normalizeUuid(MESHCORE_SERVICE_UUID)],
        [normalizeUuid(MESHCORE_RX_CHAR_UUID), normalizeUuid(MESHCORE_TX_CHAR_UUID)],
        (err, _services, chars) =>
          err ? reject(err) : resolve({ characteristics: chars }),
      );
    });

    // The device's TX characteristic is what we subscribe to for incoming data.
    const tx = characteristics.find((c) => c.uuid === normalizeUuid(MESHCORE_TX_CHAR_UUID));
    if (!tx) throw new Error(`MeshCore TX characteristic ${MESHCORE_TX_CHAR_UUID} not found`);
    this.txChar = tx;

    tx.on('data', this.onData);
    await new Promise<void>((resolve, reject) =>
      tx.subscribe((err) => (err ? reject(err) : resolve())),
    );

    peripheral.once('disconnect', () => this.onPeripheralDisconnect(deviceId));
    logger.info(`connected ${deviceId}; notifications subscribed`);
    emit.transportState('connected', deviceId);
  }

  async disconnect(): Promise<void> {
    this.userDisconnected = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
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
    if (!this.peripheral) throw new Error('Not connected');
    // The device's RX characteristic is where we write commands.
    const rxChar = this.peripheral.services
      .flatMap((s) => s.characteristics)
      .find((c) => c.uuid === normalizeUuid(MESHCORE_RX_CHAR_UUID));
    if (!rxChar) throw new Error('RX characteristic not found');
    logger.trace(
      `BLE_TX ${bytes.length}B cmd=0x${(bytes[0] ?? 0).toString(16).padStart(2, '0')} hex=${bytes.toString('hex')}`,
    );
    await new Promise<void>((resolve, reject) =>
      rxChar.write(bytes, false, (err) => (err ? reject(err) : resolve())),
    );
  }

  private findPeripheral(deviceId: string): Promise<Peripheral> {
    // If we already saw this device in the most recent scan, use it directly.
    const existing = this.discovered.get(deviceId);
    if (existing) {
      const peripheral = (noble as unknown as { _peripherals?: Map<string, Peripheral> })
        ._peripherals?.get(deviceId);
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
          noble.startScanning(
            [normalizeUuid(MESHCORE_SERVICE_UUID)],
            false,
            (err) => err && reject(err),
          );
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
    logger.warn(`peripheral disconnected ${deviceId} userInitiated=${this.userDisconnected}`);
    if (this.txChar) {
      this.txChar.removeListener('data', this.onData);
      this.txChar = null;
    }
    this.peripheral = null;
    emit.transportState('idle', deviceId);
    if (this.userDisconnected) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect(deviceId).catch((err) => {
        logger.warn(`reconnect to ${deviceId} failed: ${(err as Error).message}`);
        emit.error(`Reconnect to ${deviceId} failed: ${(err as Error).message}`);
      });
    }, RECONNECT_DELAY_MS);
  };
}

function normalizeUuid(uuid: string): string {
  // noble normalises UUIDs to lowercase no-dashes.
  return uuid.toLowerCase().replace(/-/g, '');
}
