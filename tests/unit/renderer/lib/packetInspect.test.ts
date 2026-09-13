import { createCipheriv, createHash, createHmac } from 'node:crypto';
import { MeshCoreDecoder } from '@michaelhart/meshcore-decoder';
import { describe, expect, it } from 'vitest';
import { buildPlaintextFields, inspectPacket, sectionColor } from '../../../../src/renderer/lib/packetInspect';
import {
  ACK_HEX,
  ADVERT_HEX,
  GROUP_TEXT_ENCRYPTED_HEX,
  GROUP_TEXT_HEX,
  GROUP_TEXT_SECRET_HEX,
  TEXT_MESSAGE_HEX,
} from '../../../support/packetFixtures';

// Same Flood GroupText as GROUP_TEXT_HEX but with pathlen 0x00 (no Path Data segment).
const GROUP_TEXT_NO_PATH_HEX = '15002abbcc00112233';

describe('inspectPacket', () => {
  it('decodes packet-level fields with contiguous byte coverage', () => {
    const r = inspectPacket(GROUP_TEXT_HEX);
    expect(r.ok).toBe(true);
    expect(r.size).toBe(10);
    expect(r.payloadTypeName).toBe('Group Text');
    expect(r.routeName).toBe('Flood');
    // Header is byte 0 and carries a bit table (route/payload/version).
    expect(r.fields[0].start).toBe(0);
    expect(r.fields[0].end).toBe(0);
    expect(r.fields[0].bits?.some((b) => /route/i.test(b.field))).toBe(true);
    // Path-length byte is index 1 and gets a computed bit table (hop count + hash size).
    const pathLen = r.fields.find((f) => f.start === 1 && f.end === 1);
    expect(pathLen?.bits?.some((b) => /hop/i.test(b.field))).toBe(true);
    // Coverage is contiguous 0..size-1.
    const covered = new Set<number>();
    for (const f of r.fields) for (let i = f.start; i <= f.end; i++) covered.add(i);
    expect(covered.size).toBe(r.size);
    // Each colorIdx is in range.
    expect(r.fields.every((f) => f.colorIdx >= 0 && f.colorIdx < 7)).toBe(true);
  });

  it('gives each top-level section a stable color regardless of optional path segments', () => {
    const withPath = inspectPacket(GROUP_TEXT_HEX); // pathlen 0x01 → has a Path Data segment
    const noPath = inspectPacket(GROUP_TEXT_NO_PATH_HEX); // pathlen 0x00 → no path segment
    const payloadColor = (r: ReturnType<typeof inspectPacket>) => r.fields.find((f) => f.name === 'Payload')?.colorIdx;

    // The Payload keeps its color whether or not a Path segment precedes it (the reported bug).
    expect(payloadColor(withPath)).toBe(sectionColor('Payload'));
    expect(payloadColor(noPath)).toBe(payloadColor(withPath));

    // Sanity: the with-path packet really does carry a distinct Path section.
    const pathField = withPath.fields.find((f) => f.name === 'Path Data');
    expect(pathField?.colorIdx).toBe(sectionColor('Path Data'));
    expect(pathField?.colorIdx).not.toBe(payloadColor(withPath));
    // And the no-path packet has one fewer section (no Path Data).
    expect(noPath.fields.some((f) => f.name === 'Path Data')).toBe(false);
  });

  it('exposes a normalized payload breakdown starting at byte 0', () => {
    const r = inspectPacket(GROUP_TEXT_HEX);
    const { payload } = r;
    expect(payload).not.toBeNull();
    if (!payload) return;
    const pf = payload.fields;
    expect(pf[0].start).toBe(0);
    const last = pf[pf.length - 1];
    expect(last.end).toBe(payload.bytes.length - 1);
  });

  it('returns ok:false for junk input instead of throwing', () => {
    const r = inspectPacket('zz');
    expect(r.ok).toBe(false);
  });

  it('handles a payload with no sub-structure (Ack) without crashing', () => {
    const r = inspectPacket(ACK_HEX);
    expect(r.ok).toBe(true);
    expect(r.payloadTypeName).toBe('Ack');
  });
});

describe('inspectPacket secondary sections', () => {
  it('marks a GroupText with no key as an unavailable channel lock note', () => {
    const r = inspectPacket(GROUP_TEXT_HEX); // no keyStore
    expect(r.payload?.secondary?.kind).toBe('encrypted');
    expect(r.payload?.secondary && 'available' in r.payload.secondary && r.payload.secondary.available).toBe(false);
    const note = r.payload?.secondary && 'note' in r.payload.secondary ? r.payload.secondary.note : '';
    expect(note).toContain('channel');
  });

  it('marks a DM (TextMessage) as end-to-end encrypted, not "not addressed to us"', () => {
    const r = inspectPacket(TEXT_MESSAGE_HEX);
    expect(r.payload?.secondary?.kind).toBe('encrypted');
    const note = r.payload?.secondary && 'note' in r.payload.secondary ? r.payload.secondary.note : '';
    // Accurate whether this radio is the recipient or just overheard two other nodes.
    expect(note).toContain('between sender and recipient');
    expect(note).not.toContain('addressed to us');
    expect(note).not.toContain("this radio's private key");
  });

  it("doesn't tell the user to add a channel they already hold for a GroupData packet", () => {
    // Same channel hash/MAC/ciphertext as the decryptable GroupText, retyped as GroupData (ptype 6 → header 0x19).
    const groupDataHex = `19${GROUP_TEXT_ENCRYPTED_HEX.slice(2)}`;
    const keyStore = MeshCoreDecoder.createKeyStore({ channelSecrets: [GROUP_TEXT_SECRET_HEX] });
    const r = inspectPacket(groupDataHex, { keyStore });
    const note = r.payload?.secondary && 'note' in r.payload.secondary ? r.payload.secondary.note : '';
    expect(note).not.toContain('Add the channel');
  });

  it('flags re-encoded plaintext as approximate when firmware truncation split a UTF-8 character', () => {
    // Firmware cuts channel text by byte count, so a post can end mid-emoji. Encrypt
    // exactly that under the Public secret: "bob: hi" + the first 2 bytes of 😀 (f0 9f 98 80).
    const key = Buffer.from(GROUP_TEXT_SECRET_HEX, 'hex');
    const text = Buffer.concat([Buffer.from('bob: hi', 'utf8'), Buffer.from([0xf0, 0x9f])]);
    let plain = Buffer.concat([Buffer.from([0, 0, 0, 0, 0]), text]);
    plain = Buffer.concat([plain, Buffer.alloc((16 - (plain.length % 16)) % 16)]);
    const cipher = createCipheriv('aes-128-ecb', key, null).setAutoPadding(false);
    const ct = Buffer.concat([cipher.update(plain), cipher.final()]);
    const mac = createHmac('sha256', Buffer.concat([key, Buffer.alloc(16)]))
      .update(ct)
      .digest()
      .subarray(0, 2);
    const hash = createHash('sha256').update(key).digest()[0];
    const hex = Buffer.concat([Buffer.from([0x15, 0x00, hash]), mac, ct]).toString('hex');

    const keyStore = MeshCoreDecoder.createKeyStore({ channelSecrets: [GROUP_TEXT_SECRET_HEX] });
    const secondary = inspectPacket(hex, { keyStore }).payload?.secondary;
    expect(secondary?.kind).toBe('decrypted');
    const msg = secondary && 'fields' in secondary ? secondary.fields.find((f) => f.name === 'Message') : undefined;
    expect(msg?.desc).toMatch(/approximate/);
  });

  it('decrypts a channel message into the real plaintext bytes, sender prefix included', () => {
    const keyStore = MeshCoreDecoder.createKeyStore({ channelSecrets: [GROUP_TEXT_SECRET_HEX] });
    const r = inspectPacket(GROUP_TEXT_ENCRYPTED_HEX, { keyStore });
    const secondary = r.payload?.secondary;
    expect(secondary?.kind).toBe('decrypted');
    const bytes = secondary && 'bytes' in secondary ? secondary.bytes : [];
    // timestamp(4) · flags(1) · text — the decoder splits "bob: hello" into sender/message.
    expect(new TextDecoder().decode(new Uint8Array(bytes.slice(5)))).toBe('bob: hello');
    expect(bytes.slice(0, 4)).toEqual([0x40, 0xb1, 0xb9, 0x68]); // 1757000000 little-endian
  });

  it('builds a plaintext strip: timestamp(4) · flags(1) · message', () => {
    const { bytes, fields } = buildPlaintextFields(0x01020304, 0x00, 'hi');
    expect(bytes.slice(0, 4)).toEqual([0x04, 0x03, 0x02, 0x01]); // little-endian
    expect(fields.map((f) => [f.start, f.end])).toEqual([
      [0, 3],
      [4, 4],
      [5, 6],
    ]);
  });

  it('builds a byte-accurate Advert app-data strip with real lat/lon bytes', () => {
    const r = inspectPacket(ADVERT_HEX);
    expect(r.ok).toBe(true);
    expect(r.payload?.secondary?.kind).toBe('appdata');
    const secondary = r.payload?.secondary;
    if (secondary?.kind !== 'appdata') throw new Error('expected appdata secondary');

    const [flags, lat, lon, name] = secondary.fields;
    expect([flags.start, flags.end]).toEqual([0, 0]);
    expect([lat.start, lat.end]).toEqual([1, 4]);
    expect([lon.start, lon.end]).toEqual([5, 8]);
    expect(name.name).toBe('Node Name');
    expect([name.start, name.end]).toEqual([9, secondary.bytes.length - 1]);
    expect(name.value).toBe('TestNode');
    expect(lat.value).toBe('51.5074');
    expect(lon.value).toBe('-0.1278');

    // Byte-accurate: the strip covers exactly through the last field's end byte.
    expect(secondary.bytes.length).toBe(name.end + 1);
    // The latitude/longitude bytes in the strip are the REAL app-data bytes, not zeros.
    expect(secondary.bytes.slice(1, 5)).toEqual([0xc8, 0xf0, 0x11, 0x03]);
    expect(secondary.bytes.slice(1, 5)).not.toEqual([0, 0, 0, 0]);
    expect(secondary.bytes.slice(5, 9)).toEqual([0xc8, 0x0c, 0xfe, 0xff]);
  });
});
