import { describe, expect, it } from 'vitest';
import { normalizeNodeKey, toSavedRequestDto } from '../../../../src/shared/telemetry/dto';
import type { SavedRequest } from '../../../../src/shared/telemetry/types';
import { bytes, PLAN_FIXTURE } from './fixtures';

const KEY = 'ab'.repeat(32);

const base: SavedRequest = {
  id: 'r1',
  nodeKey: KEY,
  source: 'repeater',
  requestedAt: 1,
  repliedAt: 2,
  outcome: 'ok',
  roundTripMs: 1,
  hops: 0,
  route: 'direct',
  aclRole: 'admin',
  permsGranted: 0x07,
  raw: null,
};

describe('normalizeNodeKey', () => {
  it('accepts a contact key or a bare key in either case', () => {
    expect(normalizeNodeKey(`c:${KEY}`)).toBe(KEY);
    expect(normalizeNodeKey(KEY.toUpperCase())).toBe(KEY);
  });

  it('rejects prefixes, channel keys and junk', () => {
    expect(normalizeNodeKey('c:abcd')).toBeNull();
    expect(normalizeNodeKey(`ch:${KEY}`)).toBeNull();
    expect(normalizeNodeKey('zz'.repeat(32))).toBeNull();
  });
});

describe('toSavedRequestDto', () => {
  it('hexes raw, attaches the decode and treats padding as fully decoded', () => {
    const dto = toSavedRequestDto({ ...base, raw: bytes(`${PLAN_FIXTURE} 00 00`) });
    expect(dto).not.toHaveProperty('raw');
    expect(dto.rawHex?.endsWith('038000010000')).toBe(true);
    expect(dto.readings).toHaveLength(9);
    expect(dto.restHex).toBe('');
    expect(dto.aclRole).toBe('admin');
  });

  it('keeps an undecodable tail as restHex', () => {
    const dto = toSavedRequestDto({ ...base, raw: bytes('01 74 01 A9 02 FE 01') });
    expect(dto.readings).toHaveLength(1);
    expect(dto.restHex).toBe('02fe01');
  });

  it('has no readings for a timeout', () => {
    const dto = toSavedRequestDto({ ...base, outcome: 'timeout', repliedAt: null, roundTripMs: null });
    expect(dto).toMatchObject({ rawHex: null, readings: [], restHex: '' });
  });
});
