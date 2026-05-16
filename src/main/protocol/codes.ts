// MeshCore companion-protocol command and response codes.
//
// Authoritative sources:
//   - src/main/transport/companionFrame.ts (RESP_* / PUSH_* names + meanings)
//   - src/main/bridge/drain.ts (CMD_* derived from in-flight bridge work)
//   - src/main/bridge/identity.ts (APP_START / SELF_INFO layouts)
//
// Phase 6b uses a deliberately small subset: APP_START handshake, channel
// enumeration, channel send/receive, and the inbox-pump (GET_NEXT_MSG / NO_MORE
// / PUSH_MSG_WAITING). DM, repeater admin, telemetry, etc. land in later phases.

export const CMD = {
  APP_START: 0x01,
  SEND_TXT_MSG: 0x02,
  SEND_CHAN_TXT_MSG: 0x03,
  GET_CONTACTS: 0x04,
  SEND_SELF_ADVERT: 0x07,
  // CMD_ADD_UPDATE_CONTACT: [0x09][32B pubkey][type u8][flags u8][path_len u8]
  //   [path 64B fixed][name 32B fixed][timestamp u32 LE][lat? i32 LE][lon? i32 LE]
  //   [last_advert? u32 LE]. Min 136 bytes; the trailing 12 bytes (gps + last
  //   advert) are optional and must be all-present or all-absent — sending only
  //   GPS will make the firmware mis-parse the next field as last_advert (see
  //   issue #427 in zjs81/meshcore-open). Replies RESP_OK / RESP_ERR.
  ADD_UPDATE_CONTACT: 0x09,
  GET_NEXT_MSG: 0x0a,
  // CMD_RESET_PATH: [0x0d][32B pubkey]. Clears the contact's out_path on the
  //   radio (equivalent to ADD_UPDATE_CONTACT with path_len=0). Replies RESP_OK.
  RESET_PATH: 0x0d,
  // CMD_DEVICE_QUERY (firmware misspells it CMD_DEVICE_QEURY) carries the app's
  // *protocol* version, which the firmware reads as app_target_ver. Sending
  // version ≥ 3 here makes the radio emit V3 frames (with SNR prefix). Note:
  // CMD_APP_START does NOT set this field — bytes 1..7 of APP_START are
  // reserved on the firmware side, so DEVICE_QUERY is how we negotiate.
  DEVICE_QUERY: 0x16,
  // Repeater admin login. Payload is [32B dest pubkey][ASCII password]. Radio
  // replies RESP_SENT immediately; the real outcome arrives later as
  // PUSH_LOGIN_SUCCESS / PUSH_LOGIN_FAIL after the remote repeater answers.
  SEND_LOGIN: 0x1a,
  SEND_STATUS_REQ: 0x1b,
  // CMD_LOGOUT just calls stopConnection() locally — no graceful "bye" packet
  // is sent. Replies RESP_OK.
  LOGOUT: 0x1d,
  GET_CHANNEL: 0x1f,
  SET_CHANNEL: 0x20,
  // CMD_SEND_TRACE_PATH: [0x24][tag u32 LE][auth u32 LE][flags u8][path bytes]
  // — min total length 11. flags bits 0..1 encode the per-hop hash size.
  SEND_TRACE_PATH: 0x24,
  SEND_TELEMETRY_REQ: 0x27,
  // CMD_SEND_BINARY_REQ: [0x32][32B dest pubkey][req_data]. Used for generic
  // mesh requests where the first req_data byte is a REQ_TYPE (e.g. ACL list,
  // neighbours, owner info). Reply lands in PUSH_BINARY_RESPONSE.
  SEND_BINARY_REQ: 0x32,
  // CMD_GET_STATS: [0x38][subtype u8] (CORE/RADIO/PACKETS). Reply is
  // RESP_CODE_STATS (24) with [subtype][fields...].
  GET_STATS: 0x38,
  // CMD_SEND_ANON_REQ: [0x39][32B dest pubkey][N data bytes]. Data byte 0 is
  // the sub-type — 0 or ≥0x20 (ASCII) means a password login; 0x01/0x02/0x03
  // are anonymous regions/owner/clock queries.
  SEND_ANON_REQ: 0x39,
  // CMD_SET_PATH_HASH_MODE: [0x3d][mode u8]. Global radio setting (not per
  //   contact). Values: 0=legacy/1-byte, 1=standard/2-byte, 2=strict/4-byte.
  //   Replies RESP_OK.
  SET_PATH_HASH_MODE: 0x3d,
} as const;

// Protocol version we negotiate with the firmware. 4 matches the official
// MeshCore mobile clients and unlocks V3 receive frames (RESP_*_MSG_RECV_V3).
export const APP_PROTOCOL_VERSION = 4;

// Text-message types per firmware (companion_radio/MyMesh.cpp):
// plain text, CLI/data (repeater commands etc.), and signed plain.
export const TXT_TYPE = {
  PLAIN: 0,
  CLI_DATA: 1,
  SIGNED_PLAIN: 2,
} as const;

export const RESP = {
  OK: 0x00,
  ERR: 0x01,
  CONTACTS_START: 0x02,
  CONTACT: 0x03,
  END_OF_CONTACTS: 0x04,
  SELF_INFO: 0x05,
  SENT: 0x06,
  CONTACT_MSG_RECV: 0x07,
  CHANNEL_MSG_RECV: 0x08,
  NO_MORE_MESSAGES: 0x0a,
  CONTACT_MSG_RECV_V3: 0x10,
  CHANNEL_MSG_RECV_V3: 0x11,
  CHANNEL_INFO: 0x12,
  // RESP_CODE_STATS reply to CMD_GET_STATS — second byte echoes the requested
  // STATS_TYPE so the caller can route the rest of the payload.
  STATS: 0x18,
} as const;

// ADV_TYPE values from src/helpers/AdvertDataHelpers.h, used in RESP_CONTACT
// frames to identify what kind of node the contact is.
export const ADV_TYPE = {
  CHAT: 1,
  REPEATER: 2,
  ROOM: 3,
  SENSOR: 4,
} as const;

export const PUSH = {
  SEND_CONFIRMED: 0x82,
  MSG_WAITING: 0x83,
  // PUSH_RAW_DATA wraps any raw-bytes payload received over the mesh, with a
  // [snr*4][rssi][0xff] header in front of the raw bytes.
  RAW_DATA: 0x84,
  LOGIN_SUCCESS: 0x85,
  LOGIN_FAIL: 0x86,
  STATUS_RESPONSE: 0x87,
  TRACE_DATA: 0x89,
  NEW_ADVERT: 0x8a,
  TELEMETRY_RESPONSE: 0x8b,
  // PUSH_BINARY_RESPONSE delivers a tag-matched binary reply to a prior
  // SEND_ANON_REQ / SEND_BINARY_REQ. Layout: [0x8c][0][tag u32 LE][bytes...].
  BINARY_RESPONSE: 0x8c,
  CONTACT_DELETED: 0x8f,
} as const;

// Mesh-level admin request sub-types carried inside PAYLOAD_TYPE_REQ. We send
// these via SEND_STATUS_REQ / SEND_TELEMETRY_REQ / SEND_BINARY_REQ; the
// repeater answers via PAYLOAD_TYPE_RESPONSE, which the connected radio
// surfaces back to us as PUSH_STATUS_RESPONSE / TELEMETRY_RESPONSE /
// BINARY_RESPONSE depending on which pending_* tag matched.
export const REQ_TYPE = {
  GET_STATUS: 0x01,
  KEEP_ALIVE: 0x02,
  GET_TELEMETRY_DATA: 0x03,
  GET_ACCESS_LIST: 0x05,
  GET_NEIGHBOURS: 0x06,
  GET_OWNER_INFO: 0x07,
} as const;

// Sub-type byte for CMD_SEND_ANON_REQ data. A leading 0 or ASCII byte (>= 0x20)
// is treated as a password login; everything else is one of these queries.
export const ANON_REQ_TYPE = {
  REGIONS: 0x01,
  OWNER: 0x02,
  BASIC: 0x03,
} as const;

export const STATS_TYPE = {
  CORE: 0x00,
  RADIO: 0x01,
  PACKETS: 0x02,
} as const;

// Permission bits returned in PUSH_LOGIN_SUCCESS byte 7 (ACL permissions).
export const PERM_BITS = {
  ACL_ADMIN: 0x01,
  ACL_GUEST: 0x02,
  ACL_ROLE_MASK: 0x03,
} as const;
