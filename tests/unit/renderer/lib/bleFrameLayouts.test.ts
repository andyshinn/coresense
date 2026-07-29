import { describe, expect, it } from 'vitest';
import { bleFramePurpose, inspectBleFrame, summarizeBleFrame } from '../../../../src/renderer/lib/bleFrameLayouts';

const asciiHex = (s: string) =>
  Array.from(s)
    .map((c) => c.charCodeAt(0).toString(16).padStart(2, '0'))
    .join('');

describe('inspectBleFrame', () => {
  it('lays out a channel-message frame by field (channel · path · txt-type · ts · text)', () => {
    // channel_idx(1)=05 · path_len(1)=01 · txt_type(1)=00 · ts(4) · text "hi"
    const r = inspectBleFrame('050100aabbccdd6869', 'RESP_CHANNEL_MSG_RECV');
    expect(r.fields.map((f) => f.name)).toEqual(['Channel Index', 'Path Length', 'Text Type', 'Sender Timestamp', 'Text']);
    expect(r.fields[0].start).toBe(0);
    // txt_type is its own byte at index 2, so the timestamp is bytes 3-6 (the old
    // layout was missing this byte and shifted everything after it).
    const ts = r.fields.find((f) => f.name === 'Sender Timestamp');
    expect([ts?.start, ts?.end]).toEqual([3, 6]);
    // the text field runs to the end
    expect(r.fields[r.fields.length - 1].end).toBe(r.bytes.length - 1);
  });

  it('lays out a battery/storage frame as three little-endian numbers', () => {
    const r = inspectBleFrame('3c0f0004000000200000', 'RESP_BATT_AND_STORAGE');
    expect(r.fields.map((f) => [f.name, f.start, f.end])).toEqual([
      ['Battery', 0, 1],
      ['Storage Used', 2, 5],
      ['Storage Total', 6, 9],
    ]);
  });

  it('lays out PUSH_ADVERT as a single 32-byte public key (not pubkey+timestamp+appdata)', () => {
    const r = inspectBleFrame('00'.repeat(32), 'PUSH_ADVERT');
    expect(r.fields).toHaveLength(1);
    expect(r.fields[0].name).toBe('Public Key');
    expect([r.fields[0].start, r.fields[0].end]).toEqual([0, 31]);
  });

  it('falls back to a single Body field for an unknown code', () => {
    const r = inspectBleFrame('deadbeef', 'RESP_MYSTERY');
    expect(r.fields).toHaveLength(1);
    expect(r.fields[0].start).toBe(0);
    expect(r.fields[0].end).toBe(3);
  });

  it('clamps a truncated frame to the bytes present without crashing', () => {
    const r = inspectBleFrame('3c0f', 'RESP_BATT_AND_STORAGE');
    expect(r.fields[0].name).toBe('Battery');
    expect(r.fields[r.fields.length - 1].end).toBe(r.bytes.length - 1);
  });
});

describe('summarizeBleFrame', () => {
  it('summarizes a channel message as "#idx sender: text"', () => {
    // channel_idx=05 · path=01 · txt_type=00 · ts(4) · "bob: hi"
    const hex = `050100aabbccdd${asciiHex('bob: hi')}`;
    expect(summarizeBleFrame(hex, 'RESP_CHANNEL_MSG_RECV')).toBe('#5 bob: hi');
  });

  it('summarizes a contact message as "prefix · “text”"', () => {
    // pubkey_prefix(6)=001122334455 · path_len=01 · txt_type=00 · ts(4)=aabbccdd · "yo"
    const hex = `00112233445501${'00'}aabbccdd${asciiHex('yo')}`;
    expect(summarizeBleFrame(hex, 'RESP_CONTACT_MSG_RECV')).toBe('001122334455 · “yo”');
  });

  it('summarizes battery voltage and storage in human units', () => {
    // 3900 mV · 1024 KB used · 8192 KB total → 3.90 V · 1.0/8.0 MB
    expect(summarizeBleFrame('3c0f0004000000200000', 'RESP_BATT_AND_STORAGE')).toBe('3.90 V · 1.0/8.0 MB');
  });

  it('summarizes a channel-info frame with its name', () => {
    const hex = `02${asciiHex('General')}${'00'.repeat(32 - 7)}${'00'.repeat(16)}`;
    expect(summarizeBleFrame(hex, 'RESP_CHANNEL_INFO')).toBe('#2 “General”');
  });

  it('maps a known error code to its name', () => {
    expect(summarizeBleFrame('02', 'RESP_ERR')).toBe('error: not found');
  });

  it('returns a fixed note for bare frames', () => {
    expect(summarizeBleFrame('', 'RESP_NO_MORE_MESSAGES')).toBe('queue empty');
    expect(summarizeBleFrame('', 'PUSH_MSG_WAITING')).toBe('messages waiting');
  });

  it('shows a key prefix for advert/path frames', () => {
    expect(summarizeBleFrame(`aabbccddeeff${'00'.repeat(26)}`, 'PUSH_ADVERT')).toBe('key AABBCCDDEEFF…');
  });

  it('falls back to a byte count for frames it cannot summarize', () => {
    expect(summarizeBleFrame('deadbeef', 'RESP_MYSTERY')).toBe('4 B');
    expect(summarizeBleFrame('', 'RESP_MYSTERY')).toBe('');
  });
});

describe('bleFramePurpose', () => {
  it('returns a human note for known frames and empty for unknown', () => {
    expect(bleFramePurpose('RESP_BATT_AND_STORAGE')).toContain('Battery');
    expect(bleFramePurpose('RESP_MYSTERY')).toBe('');
    expect(bleFramePurpose(undefined)).toBe('');
  });
});
