import type {
  AppSettings,
  AutoAddConfig,
  DeviceCapabilities,
  DeviceIdentity,
  DeviceInfo,
  GpsConfig,
  MapSettings,
  Owner,
  RadioSettings,
  TelemetryPolicy,
  UiState,
} from '../../shared/types';
import { emit } from '../events/bus';
import { stateHolder } from './holder';

/** Write a state slice and broadcast it, the pairing every writer of these
 *  slices needs. Only for the plain slices, whose broadcast is exactly the
 *  value written. Contacts and discovered coalesce their emits, channels
 *  broadcast the merged list, and drafts never broadcast, so those stay with
 *  their callers. */
export const commit = {
  owner(next: Owner | null): void {
    stateHolder().setOwner(next);
    emit.owner(next);
  },
  appSettings(next: AppSettings): void {
    stateHolder().setAppSettings(next);
    emit.appSettings(next);
  },
  radioSettings(next: RadioSettings): void {
    stateHolder().setRadioSettings(next);
    emit.radioSettings(next);
  },
  mapSettings(next: MapSettings): void {
    stateHolder().setMapSettings(next);
    emit.mapSettings(next);
  },
  uiState(next: UiState): void {
    stateHolder().setUiState(next);
    emit.uiState(next);
  },
  deviceIdentity(next: DeviceIdentity): void {
    stateHolder().setDeviceIdentity(next);
    emit.deviceIdentity(next);
  },
  autoAddConfig(next: AutoAddConfig): void {
    stateHolder().setAutoAddConfig(next);
    emit.autoAddConfig(next);
  },
  telemetryPolicy(next: TelemetryPolicy): void {
    stateHolder().setTelemetryPolicy(next);
    emit.telemetryPolicy(next);
  },
  gpsConfig(next: GpsConfig): void {
    stateHolder().setGpsConfig(next);
    emit.gpsConfig(next);
  },
  deviceInfo(next: DeviceInfo): void {
    stateHolder().setDeviceInfo(next);
    emit.deviceInfo(next);
  },
  deviceCapabilities(next: DeviceCapabilities): void {
    stateHolder().setDeviceCapabilities(next);
    emit.deviceCapabilities(next);
  },
};
