import { decodeDeviceInfo } from '@andyshinn/meshcore-ts';
import { emit } from '../../events/bus';
import { stateHolder } from '../../state/holder';
import { BufferWriter } from '../buffer';
import { APP_PROTOCOL_VERSION, CMD, RESP } from '../codes';
import type { Feature } from '../feature';
import { pathHashModeToSize } from './pathHash';

// CMD_DEVICE_QUERY: [0x16][app_protocol_version u8]. Firmware reads byte [1]
// into app_target_ver, which gates V3-style response frames. Reply is
// RESP_DEVICE_INFO (0x0d) with firmware version + capacity counts.
export function encodeDeviceQuery(version = APP_PROTOCOL_VERSION): Buffer {
  return new BufferWriter()
    .writeByte(CMD.DEVICE_QUERY)
    .writeByte(version & 0xff)
    .toBuffer();
}

// RESP/PUSH handler: fold firmware version + capacity counts into device info,
// derive capability flags, and sync the radio's path-hash mode into RadioSettings.
export const deviceInfoFeature: Feature = {
  handles: [RESP.DEVICE_INFO],
  handle: (_code, frame) => {
    const parsed = decodeDeviceInfo(frame);
    if (!parsed) return;
    const holder = stateHolder();
    const prev = holder.getDeviceInfo();
    const next = {
      ...prev,
      firmwareVerCode: parsed.firmwareVerCode,
      maxContacts: parsed.maxContacts,
      maxChannels: parsed.maxChannels,
      // Empty / undefined means a short frame didn't carry the field — keep what
      // we already knew rather than clobbering it.
      deviceModel: parsed.deviceModel || prev.deviceModel,
      firmwareVersion: parsed.firmwareVersion || prev.firmwareVersion,
      firmwareBuildDate: parsed.firmwareBuildDate || prev.firmwareBuildDate,
    };
    holder.setDeviceInfo(next);
    emit.deviceInfo(next);
    const caps = {
      repeatMode: parsed.firmwareVerCode >= 9,
      identityKeyIO: parsed.firmwareVerCode >= 25,
    };
    holder.setDeviceCapabilities(caps);
    emit.deviceCapabilities(caps);
    if (parsed.pathHashMode !== undefined) {
      const radioSize = pathHashModeToSize(parsed.pathHashMode);
      const currentRadio = holder.getRadioSettings();
      if (currentRadio.pathHashMode !== radioSize) {
        const nextRadio = { ...currentRadio, pathHashMode: radioSize };
        holder.setRadioSettings(nextRadio);
        emit.radioSettings(nextRadio);
      }
    }
  },
};
