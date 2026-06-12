import { Buffer } from 'node:buffer';
import { describe, expect, it } from 'vitest';
import {
  autoAddByteToFlags,
  autoAddFlagsToByte,
  buildAddUpdateContact,
  buildAnonLogin,
  buildAppStart,
  buildDeviceQuery,
  buildGetAutoAddConfig,
  buildGetChannel,
  buildGetContacts,
  buildGetCustomVar,
  buildGetNextMsg,
  buildGetStats,
  buildLogout,
  buildReboot,
  buildResetPath,
  buildSendAnonReq,
  buildSendBinaryReq,
  buildSendChannelText,
  buildSendDmText,
  buildSendLogin,
  buildSendSelfAdvert,
  buildSendStatusReq,
  buildSendTelemetryReq,
  buildSendTracePath,
  buildSetAdvertLatLon,
  buildSetAdvertName,
  buildSetAutoAddConfig,
  buildSetChannel,
  buildSetCustomVar,
  buildSetOtherParams,
  buildSetPathHashMode,
  buildSetRadioParams,
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

describe('encode: bare/simple builders (missing coverage)', () => {
  it('buildGetCustomVar appends the key, or bare opcode for empty key', () => {
    expect(hex(buildGetCustomVar())).toBe('28');
    expect(hex(buildGetCustomVar('gps'))).toBe('28677073');
  });

  it('buildGetStats appends the subtype', () => {
    expect(hex(buildGetStats(0x00))).toBe('3800');
  });

  it('buildSetAutoAddConfig appends the packed flags byte', () => {
    expect(
      hex(
        buildSetAutoAddConfig({
          chat: true,
          repeater: true,
          room: true,
          sensor: true,
          overwriteOldest: true,
        }),
      ),
    ).toBe('3a1f');
  });

  it('buildSendChannelText lays out [cmd][flags][idx][ts u32 LE][text]', () => {
    const out = buildSendChannelText({ channelIdx: 2, text: 'hi', timestampUnix: 1, flags: 0 });
    expect(hex(out)).toBe('030002010000006869');
  });
});

describe('encode: 32-byte-pubkey commands (missing coverage)', () => {
  const pk = 'aa'.repeat(32);

  it('buildLogout is [0x1d][32B pubkey]', () => {
    expect(hex(buildLogout(pk))).toBe(`1d${pk}`);
  });

  it('buildResetPath is [0x0d][32B pubkey]', () => {
    expect(hex(buildResetPath(pk))).toBe(`0d${pk}`);
  });

  it('buildSendStatusReq is [0x1b][32B pubkey]', () => {
    expect(hex(buildSendStatusReq(pk))).toBe(`1b${pk}`);
  });

  it('buildSendTelemetryReq is [0x27][3 reserved zero bytes][32B pubkey]', () => {
    expect(hex(buildSendTelemetryReq(pk))).toBe(`27000000${pk}`);
  });

  it('buildSendLogin is [0x1a][32B pubkey][ascii password]', () => {
    expect(hex(buildSendLogin(pk, 'pw'))).toBe(`1a${pk}7077`);
  });

  it('buildSendAnonReq is [0x39][32B pubkey][data]; rejects empty data', () => {
    expect(hex(buildSendAnonReq(pk, Buffer.from([0x01])))).toBe(`39${pk}01`);
    expect(() => buildSendAnonReq(pk, Buffer.alloc(0))).toThrow(/≥1 byte/);
  });

  it('buildAnonLogin wraps the password as anon-req data; rejects empty', () => {
    expect(hex(buildAnonLogin(pk, 'pw'))).toBe(`39${pk}7077`);
    expect(() => buildAnonLogin(pk, '')).toThrow(/empty/);
  });

  it('buildSendBinaryReq is [0x32][32B pubkey][reqData]; rejects empty', () => {
    expect(hex(buildSendBinaryReq(pk, Buffer.from([0x05])))).toBe(`32${pk}05`);
    expect(() => buildSendBinaryReq(pk, Buffer.alloc(0))).toThrow(/≥1 byte/);
  });

  it('rejects pubkeys shorter than 32 bytes', () => {
    expect(() => buildLogout('aabb')).toThrow(/32B/);
    expect(() => buildSendStatusReq('aabb')).toThrow(/32B/);
  });
});

describe('encode: structured builders (missing coverage)', () => {
  const pk = 'aa'.repeat(32);

  it('buildSetChannel lays out [0x20][idx][name 32B null-padded][secret 16B]', () => {
    const out = buildSetChannel(1, 'General', 'ab'.repeat(16));
    expect(out.length).toBe(50);
    expect(out[0]).toBe(0x20);
    expect(out[1]).toBe(1);
    const nameRegion = out.subarray(2, 34);
    expect(nameRegion.subarray(0, nameRegion.indexOf(0)).toString('utf8')).toBe('General');
    expect(out.subarray(34, 50).toString('hex')).toBe('ab'.repeat(16));
  });

  it('buildSetChannel rejects a secret that is not 16 bytes', () => {
    expect(() => buildSetChannel(0, 'x', 'abcd')).toThrow(/16 bytes/);
  });

  it('buildSendTracePath lays out [0x24][tag u32 LE][auth u32 LE][flags u8][path]', () => {
    const out = buildSendTracePath({ tag: 1, authCode: 2, flags: 0, path: Buffer.from([0xaa]) });
    expect(hex(out)).toBe('24010000000200000000aa');
  });

  it('buildSendTracePath rejects an empty path', () => {
    expect(() => buildSendTracePath({ tag: 1, authCode: 2, path: Buffer.alloc(0) })).toThrow(
      /≥1 byte/,
    );
  });

  it('buildSetAdvertLatLon writes signed micro-degrees', () => {
    const out = buildSetAdvertLatLon(37.5, -122.25);
    expect(out[0]).toBe(0x0e);
    expect(out.readInt32LE(1)).toBe(37_500_000);
    expect(out.readInt32LE(5)).toBe(-122_250_000);
  });

  it('buildSetRadioParams lays out freq/bw/sf/cr, repeat byte only when set', () => {
    const base = buildSetRadioParams({
      frequencyHz: 915_000_000,
      bandwidthHz: 250_000,
      spreadingFactor: 11,
      codingRate: 5,
    });
    expect(base.length).toBe(11);
    expect(base[0]).toBe(0x0b);
    expect(base.readUInt32LE(1)).toBe(915_000_000);
    expect(base.readUInt32LE(5)).toBe(250_000);
    expect(base[9]).toBe(11);
    expect(base[10]).toBe(5);

    const withRepeat = buildSetRadioParams({
      frequencyHz: 915_000_000,
      bandwidthHz: 250_000,
      spreadingFactor: 11,
      codingRate: 5,
      clientRepeat: true,
    });
    expect(withRepeat.length).toBe(12);
    expect(withRepeat[11]).toBe(1);
  });

  it('buildAddUpdateContact omits the GPS tail when not provided (136 bytes)', () => {
    const out = buildAddUpdateContact({
      publicKeyHex: pk,
      advType: 1,
      flags: 0,
      outPathHex: '',
      name: 'Bob',
      timestampUnix: 5,
    });
    expect(out.length).toBe(136);
    expect(out[0]).toBe(0x09);
    expect(out.subarray(1, 33).toString('hex')).toBe(pk);
    expect(out[33]).toBe(1); // advType
    expect(out[34]).toBe(0); // flags
    expect(out[35]).toBe(0); // out_path_len
    const nameRegion = out.subarray(100, 132);
    expect(nameRegion.subarray(0, nameRegion.indexOf(0)).toString('utf8')).toBe('Bob');
    expect(out.readUInt32LE(132)).toBe(5);
  });

  it('buildAddUpdateContact includes the GPS tail when provided (148 bytes)', () => {
    const out = buildAddUpdateContact({
      publicKeyHex: pk,
      advType: 1,
      flags: 0,
      outPathHex: '',
      name: 'Bob',
      timestampUnix: 5,
      gpsLat: 1,
      gpsLon: 2,
      lastAdvertUnix: 10,
    });
    expect(out.length).toBe(148);
    expect(out.readInt32LE(136)).toBe(1_000_000);
    expect(out.readInt32LE(140)).toBe(2_000_000);
    expect(out.readUInt32LE(144)).toBe(10);
  });
});
