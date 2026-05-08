import { EventEmitter } from 'node:events';
import type { BleDevice, RawPacket, TransportState } from '../../shared/types';

export const bus = new EventEmitter();

export const emit = {
  packet: (p: RawPacket) => bus.emit('packet', p),
  transportState: (s: TransportState, id?: string) => bus.emit('transportState', s, id),
  scanResults: (devices: BleDevice[]) => bus.emit('scanResults', devices),
  error: (message: string) => bus.emit('error', message),
};

export type BusEvents = {
  packet: (p: RawPacket) => void;
  transportState: (s: TransportState, id?: string) => void;
  scanResults: (devices: BleDevice[]) => void;
  error: (message: string) => void;
};
