import type { Buffer } from 'node:buffer';
import { describe, expect, it } from 'vitest';
import {
  autoAddByteToFlags,
  autoAddFlagsToByte,
  buildAppStart,
  buildDeviceQuery,
  buildGetAutoAddConfig,
  buildGetBattAndStorage,
  buildGetChannel,
  buildGetContacts,
  buildGetNextMsg,
  buildReboot,
  buildSendDmText,
  buildSendSelfAdvert,
  buildSetAdvertName,
  buildSetCustomVar,
  buildSetOtherParams,
  buildSetPathHashMode,
  buildSetRadioTxPower,
  deriveChannelSecret,
  pathHashModeToSize,
  pathHashSizeToMode,
} from '../../../../src/main/protocol/encode';

const hex = (b: Buffer) => b.toString('hex');

describe('encode: bare-opcode commands', () => {
  it('buildDeviceQuery defaults to protocol version 4', () => {
    expect(hex(buildDeviceQuery())).toBe('1604');
  });

  it('buildDeviceQuery(3) matches the byte sequence seen on the wire', () => {
    // Cross-checked against coresense.log: PROXY_RX cmd=0x16 hex=1603
    expect(hex(buildDeviceQuery(3))).toBe('1603');
  });

  it('buildGetNextMsg is a single opcode', () => {
    expect(hex(buildGetNextMsg())).toBe('0a');
  });

  it('buildGetBattAndStorage is a single opcode', () => {
    expect(hex(buildGetBattAndStorage())).toBe('14');
  });

  it('buildGetAutoAddConfig is a single opcode', () => {
    expect(hex(buildGetAutoAddConfig())).toBe('3b');
  });

  it('buildGetChannel appends the slot index', () => {
    expect(hex(buildGetChannel(0))).toBe('1f00');
    expect(hex(buildGetChannel(3))).toBe('1f03');
  });

  it('buildSendSelfAdvert encodes the flood flag', () => {
    expect(hex(buildSendSelfAdvert())).toBe('0701');
    expect(hex(buildSendSelfAdvert(false))).toBe('0700');
  });

  it('buildSetRadioTxPower appends dBm', () => {
    expect(hex(buildSetRadioTxPower(20))).toBe('0c14');
  });

  it('buildReboot appends the literal "reboot"', () => {
    expect(hex(buildReboot())).toBe('137265626f6f74');
  });
});

describe('encode: APP_START', () => {
  it('matches the logged handshake frame', () => {
    // coresense.log: BLE_TX 24B cmd=0x01 hex=01010000000000006d657368636f72652d666c7574746572
    expect(hex(buildAppStart('meshcore-flutter', 1))).toBe(
      '01010000000000006d657368636f72652d666c7574746572',
    );
  });

  it('lays out [cmd][version][6 reserved zero bytes][name]', () => {
    const out = buildAppStart('mc', 1);
    expect(out[0]).toBe(0x01);
    expect(out[1]).toBe(0x01);
    expect([...out.subarray(2, 8)]).toEqual([0, 0, 0, 0, 0, 0]);
    expect(out.subarray(8).toString('utf8')).toBe('mc');
  });
});

describe('encode: GET_CONTACTS', () => {
  it('is a bare opcode with no `since`', () => {
    expect(hex(buildGetContacts())).toBe('04');
  });

  it('appends `since` as u32 LE', () => {
    expect(hex(buildGetContacts(0x100))).toBe('0400010000');
  });
});

describe('encode: SET_OTHER_PARAMS bit packing', () => {
  it('packs telemetry env<<4 | loc<<2 | base', () => {
    const out = buildSetOtherParams({
      telemetryBase: 1,
      telemetryLoc: 2,
      telemetryEnv: 0,
      advertLocationPolicy: 1,
      multiAcks: 2,
    });
    // [0x26][reserved 0][(0<<4)|(2<<2)|1 = 0x09][0x01][0x02]
    expect(hex(out)).toBe('2600090102');
  });
});

describe('encode: SET_ADVERT_NAME / SET_CUSTOM_VAR', () => {
  it('buildSetAdvertName appends the UTF-8 name', () => {
    expect(hex(buildSetAdvertName('Hand'))).toBe('0848616e64');
  });

  it('buildSetCustomVar formats "key:value" with boolean → 1/0', () => {
    expect(hex(buildSetCustomVar('gps', true))).toBe('296770733a31');
  });
});

describe('encode: SET_PATH_HASH_MODE + size/mode conversions', () => {
  it('emits [0x3d][0x00][mode]', () => {
    expect(hex(buildSetPathHashMode(1))).toBe('3d0001');
  });

  it('round-trips per-hop byte size ↔ mode', () => {
    for (const size of [1, 2, 3] as const) {
      expect(pathHashModeToSize(pathHashSizeToMode(size))).toBe(size);
    }
    expect(pathHashSizeToMode(1)).toBe(0);
    expect(pathHashSizeToMode(3)).toBe(2);
  });
});

describe('encode: auto-add flag bit field round-trip', () => {
  it('all flags set → 0x1f', () => {
    expect(
      autoAddFlagsToByte({
        chat: true,
        repeater: true,
        room: true,
        sensor: true,
        overwriteOldest: true,
      }),
    ).toBe(0x1f);
  });

  it('byte → flags → byte is stable across 0..0x1f', () => {
    for (let b = 0; b <= 0x1f; b++) {
      expect(autoAddFlagsToByte(autoAddByteToFlags(b))).toBe(b);
    }
  });
});

describe('encode: DM text framing + validation', () => {
  it('lays out [cmd][txt_type][attempt][ts u32 LE][6B pubkey prefix][text]', () => {
    const out = buildSendDmText({
      destPublicKeyHex: 'aabbccddeeff00112233445566778899',
      text: 'hi',
      timestampUnix: 1,
    });
    expect(out[0]).toBe(0x02); // SEND_TXT_MSG
    expect(out[1]).toBe(0); // PLAIN
    expect(out[2]).toBe(0); // attempt
    expect(out.readUInt32LE(3)).toBe(1); // timestamp
    expect(out.subarray(7, 13).toString('hex')).toBe('aabbccddeeff'); // first 6 bytes
    expect(out.subarray(13).toString('utf8')).toBe('hi');
  });

  it('rejects a public key shorter than 6 bytes', () => {
    expect(() => buildSendDmText({ destPublicKeyHex: 'aabb', text: 'x' })).toThrow(/≥6 bytes/);
  });
});

describe('encode: deriveChannelSecret', () => {
  it('is 16 bytes (32 lowercase hex chars) and deterministic', () => {
    const a = deriveChannelSecret('public');
    const b = deriveChannelSecret('public');
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{32}$/);
    expect(a).toBe('efa1f375d76194fa51a3556a97e641e6'); // golden: SHA-256('public')[:16]
  });

  it('differs for different channel names', () => {
    expect(deriveChannelSecret('public')).not.toBe(deriveChannelSecret('private'));
  });
});
