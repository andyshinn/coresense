import { describe, expect, it } from 'vitest';
import { buildPlaintextFields, inspectPacket } from '../../../../src/renderer/lib/packetInspect';
import { ACK_HEX, ADVERT_HEX, GROUP_TEXT_HEX, TEXT_MESSAGE_HEX } from '../../../support/packetFixtures';

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

  it('marks a DM (TextMessage) as an unavailable "not addressed to us" note', () => {
    const r = inspectPacket(TEXT_MESSAGE_HEX);
    expect(r.payload?.secondary?.kind).toBe('encrypted');
    const note = r.payload?.secondary && 'note' in r.payload.secondary ? r.payload.secondary.note : '';
    expect(note).toContain('addressed to us');
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
