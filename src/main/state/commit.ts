import type {
  AppSettings,
  AutoAddConfig,
  DeviceCapabilities,
  DeviceIdentity,
  DeviceInfo,
  GpsConfig,
  MapSettings,
  Owner,
  RadioLimits,
  RadioSettings,
  TelemetryPolicy,
  UiState,
} from '../../shared/types';
import { emit } from '../events/bus';
import { noteIdentity, noteOwner, noteRadioSlice } from '../node/nodeCache';
import { stateHolder } from './holder';

/** Write a state slice and broadcast it, the pairing every writer of these
 *  slices needs. The radio's own slices also land in the connected radio's
 *  last-known entry (node/nodeCache.ts). Only for the plain slices, whose broadcast is exactly the
 *  value written. Contacts and discovered coalesce their emits, channels
 *  broadcast the merged list, and drafts never broadcast, so those stay with
 *  their callers. */
export const commit = {
  owner(next: Owner | null): void {
    stateHolder().setOwner(next);
    emit.owner(next);
    noteOwner(next);
  },
  appSettings(next: AppSettings): void {
    stateHolder().setAppSettings(next);
    emit.appSettings(next);
  },
  radioSettings(next: RadioSettings): void {
    stateHolder().setRadioSettings(next);
    emit.radioSettings(next);
    noteRadioSlice({ radioSettings: next });
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
    noteIdentity(next);
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
    noteRadioSlice({ gpsConfig: next });
  },
  deviceInfo(next: DeviceInfo): void {
    stateHolder().setDeviceInfo(next);
    emit.deviceInfo(next);
    noteRadioSlice({ deviceInfo: next });
  },
  deviceCapabilities(next: DeviceCapabilities): void {
    stateHolder().setDeviceCapabilities(next);
    emit.deviceCapabilities(next);
  },
  radioLimits(next: RadioLimits): void {
    stateHolder().setRadioLimits(next);
    emit.radioLimits(next);
    noteRadioSlice({ radioLimits: next });
  },
};
