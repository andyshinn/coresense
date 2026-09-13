// Names for MeshCore companion-radio frame codes (the first byte of every frame over
// BLE/serial). Shared so main's frame parser and the renderer's standalone decoder,
// which is handed a whole frame, name frames identically.

const PUSH_NAMES: Record<number, string> = {
  128: 'PUSH_ADVERT',
  129: 'PUSH_PATH_UPDATED',
  130: 'PUSH_SEND_CONFIRMED',
  131: 'PUSH_MSG_WAITING',
  132: 'PUSH_RAW_DATA',
  133: 'PUSH_LOGIN_SUCCESS',
  134: 'PUSH_LOGIN_FAIL',
  135: 'PUSH_STATUS_RESPONSE',
  136: 'PUSH_LOG_RX_DATA',
  137: 'PUSH_TRACE_DATA',
  138: 'PUSH_NEW_ADVERT',
  139: 'PUSH_TELEMETRY_RESPONSE',
  140: 'PUSH_BINARY_RESPONSE',
  141: 'PUSH_PATH_DISCOVERY_RESPONSE',
  142: 'PUSH_CONTROL_DATA',
  143: 'PUSH_CONTACT_DELETED',
  144: 'PUSH_CONTACTS_FULL',
};

const RESP_NAMES: Record<number, string> = {
  0: 'RESP_OK',
  1: 'RESP_ERR',
  2: 'RESP_CONTACTS_START',
  3: 'RESP_CONTACT',
  4: 'RESP_END_OF_CONTACTS',
  5: 'RESP_SELF_INFO',
  6: 'RESP_SENT',
  7: 'RESP_CONTACT_MSG_RECV',
  8: 'RESP_CHANNEL_MSG_RECV',
  9: 'RESP_CURR_TIME',
  10: 'RESP_NO_MORE_MESSAGES',
  11: 'RESP_EXPORT_CONTACT',
  12: 'RESP_BATT_AND_STORAGE',
  13: 'RESP_DEVICE_INFO',
  14: 'RESP_PRIVATE_KEY',
  15: 'RESP_DISABLED',
  16: 'RESP_CONTACT_MSG_RECV_V3',
  17: 'RESP_CHANNEL_MSG_RECV_V3',
  18: 'RESP_CHANNEL_INFO',
  19: 'RESP_SIGN_START',
  20: 'RESP_SIGNATURE',
  21: 'RESP_CUSTOM_VARS',
  22: 'RESP_ADVERT_PATH',
  23: 'RESP_TUNING_PARAMS',
  24: 'RESP_STATS',
  25: 'RESP_AUTOADD_CONFIG',
  27: 'RESP_CHANNEL_DATA_RECV',
  28: 'RESP_DEFAULT_FLOOD_SCOPE',
};

/** A frame code's name, e.g. `RESP_SELF_INFO`, or `frame 0xNN` for one we don't know. */
export function companionFrameName(code: number): string {
  return PUSH_NAMES[code] ?? RESP_NAMES[code] ?? `frame 0x${code.toString(16).padStart(2, '0')}`;
}

/** RESP_PRIVATE_KEY carries the radio's private key in the clear. */
export const RESP_PRIVATE_KEY = 14;
