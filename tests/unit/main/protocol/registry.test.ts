import { Buffer } from 'node:buffer';
import { describe, expect, it, vi } from 'vitest';
import type { Feature } from '../../../../src/main/protocol/feature';
import { FeatureRegistry } from '../../../../src/main/protocol/registry';

function fakeFeature(handles: number[], handle = vi.fn()): Feature {
  return { handles, handle };
}

describe('FeatureRegistry', () => {
  it('maps each handled code to its feature', () => {
    const a = fakeFeature([0x80]);
    const b = fakeFeature([0x90, 0x91]);
    const reg = new FeatureRegistry([a, b]);
    expect(reg.get(0x80)).toBe(a);
    expect(reg.get(0x91)).toBe(b);
    expect(reg.get(0x07)).toBeUndefined();
  });

  it('throws when two features claim the same code', () => {
    expect(() => new FeatureRegistry([fakeFeature([0x80]), fakeFeature([0x80])])).toThrow(
      /duplicate/i,
    );
  });

  it('dispatches a frame to the right handler', () => {
    const handle = vi.fn();
    const reg = new FeatureRegistry([fakeFeature([0x90], handle)]);
    const ctx = { writeFrame: vi.fn(), request: vi.fn() };
    reg.get(0x90)?.handle(0x90, Buffer.from([0x90, 0x01]), ctx);
    expect(handle).toHaveBeenCalledWith(0x90, Buffer.from([0x90, 0x01]), ctx);
  });
});
