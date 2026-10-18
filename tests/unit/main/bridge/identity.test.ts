import { Buffer } from 'node:buffer';
import { Protocol } from '@andyshinn/meshcore-ts';
import { describe, expect, it } from 'vitest';
import { inboxKeyFor, parseAppStartName, parseNodeNameFromSelfInfo } from '../../../../src/main/bridge/identity';

/** CMD_APP_START: [0x01][version][6 reserved bytes][app name, UTF-8]. */
function appStart(name: string | Buffer, code: number = Protocol.CMD.APP_START): Buffer {
  const tail = typeof name === 'string' ? Buffer.from(name, 'utf8') : name;
  return Buffer.concat([Buffer.from([code, 0x01, 0, 0, 0, 0, 0, 0]), tail]);
}

describe('parseAppStartName', () => {
  it('reads the app name after the 8-byte header', () => {
    expect(parseAppStartName(appStart('meshcore-flutter'))).toBe('meshcore-flutter');
  });

  it('strips NUL padding after the name', () => {
    expect(parseAppStartName(appStart(Buffer.from('meshcore-flutter\0\0\0', 'utf8')))).toBe('meshcore-flutter');
  });

  it('trims surrounding whitespace', () => {
    expect(parseAppStartName(appStart('  coresense \n'))).toBe('coresense');
  });

  it('returns null for a header with no name after it', () => {
    expect(parseAppStartName(appStart(''))).toBeNull();
  });

  it('returns null when the name is nothing but padding or whitespace', () => {
    expect(parseAppStartName(appStart(Buffer.from([0, 0, 0])))).toBeNull();
    expect(parseAppStartName(appStart('   '))).toBeNull();
  });

  it('returns null for any frame other than APP_START', () => {
    expect(parseAppStartName(appStart('meshcore-flutter', Protocol.CMD.DEVICE_QUERY))).toBeNull();
  });
});

describe('inboxKeyFor', () => {
  it('pairs the client IP with its app name', () => {
    expect(inboxKeyFor('192.168.1.20', 'meshcore-flutter')).toBe('192.168.1.20:meshcore-flutter');
  });

  // Every official Flutter client announces the same name, and one machine can
  // run several client kinds, so neither half is an identity on its own.
  it('keeps the same app on two hosts, and two apps on one host, apart', () => {
    const keys = new Set([
      inboxKeyFor('10.0.0.1', 'meshcore-flutter'),
      inboxKeyFor('10.0.0.2', 'meshcore-flutter'),
      inboxKeyFor('10.0.0.1', 'other-client'),
    ]);
    expect(keys.size).toBe(3);
  });

  it('marks a missing half with _', () => {
    expect(inboxKeyFor(null, null)).toBe('_:_');
    expect(inboxKeyFor('10.0.0.1', null)).toBe('10.0.0.1:_');
  });
});

describe('parseNodeNameFromSelfInfo', () => {
  /** A RESP_SELF_INFO-shaped frame: code, a header holding non-printable bytes
   *  (as the pubkey and radio metadata always do), then the name. */
  function selfInfo(name: string, code: number = Protocol.RESP.SELF_INFO): Buffer {
    const header = Buffer.alloc(57);
    header[0] = code;
    header[56] = 0x07; // a control byte right before the name
    return Buffer.concat([header, Buffer.from(name, 'ascii')]);
  }

  it('reads the printable name at the end of the frame', () => {
    expect(parseNodeNameFromSelfInfo(selfInfo('Base Camp'))).toBe('Base Camp');
  });

  it('returns null when the frame has no printable tail', () => {
    expect(parseNodeNameFromSelfInfo(selfInfo(''))).toBeNull();
  });

  it('returns null for any frame other than RESP_SELF_INFO', () => {
    expect(parseNodeNameFromSelfInfo(selfInfo('Base Camp', Protocol.RESP.DEVICE_INFO))).toBeNull();
  });

  it('returns null for a bare code byte', () => {
    expect(parseNodeNameFromSelfInfo(Buffer.from([Protocol.RESP.SELF_INFO]))).toBeNull();
  });
});
