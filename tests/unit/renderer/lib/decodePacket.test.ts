import { describe, expect, it } from 'vitest';
import { summarizePacket } from '../../../../src/renderer/lib/decodePacket';
import { frameHex } from '../../../support/frames';

describe('summarizePacket', () => {
  it('returns a structured summary without throwing on a real mesh frame', () => {
    const summary = summarizePacket(frameHex('meshPacketRaw'));
    expect(typeof summary.routeName).toBe('string');
    expect(typeof summary.typeName).toBe('string');
    expect(typeof summary.isValid).toBe('boolean');
  });

  it('reports an invalid result for non-hex input instead of throwing', () => {
    const summary = summarizePacket('zzzz');
    expect(summary.isValid).toBe(false);
    expect(summary.typeName).toBe('invalid');
  });
});
