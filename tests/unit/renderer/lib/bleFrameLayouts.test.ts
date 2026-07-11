import { describe, expect, it } from 'vitest';
import { inspectBleFrame } from '../../../../src/renderer/lib/bleFrameLayouts';

describe('inspectBleFrame', () => {
  it('lays out a known channel-message frame by field', () => {
    // chash(1)=2a · pathType(1)=01 · ts(4) · text "hi"
    const r = inspectBleFrame('2a01aabbccdd6869', 'RESP_CHANNEL_MSG_RECV');
    expect(r.fields[0].start).toBe(0);
    expect(r.fields[0].end).toBe(0);
    // the text field runs to the end
    expect(r.fields[r.fields.length - 1].end).toBe(r.bytes.length - 1);
  });

  it('falls back to a single Body field for an unknown code', () => {
    const r = inspectBleFrame('deadbeef', 'RESP_MYSTERY');
    expect(r.fields).toHaveLength(1);
    expect(r.fields[0].start).toBe(0);
    expect(r.fields[0].end).toBe(3);
  });
});
