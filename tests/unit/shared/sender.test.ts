import { describe, expect, it } from 'vitest';
import { isRealPubkey, parseSender, senderDisplayName } from '../../../src/shared/sender';

describe('parseSender', () => {
  it('decodes every branch of the encoding', () => {
    expect(parseSender(undefined)).toEqual({ kind: 'self' });
    expect(parseSender(null)).toEqual({ kind: 'self' });
    expect(parseSender('unknown')).toEqual({ kind: 'unknown' });
    expect(parseSender('')).toEqual({ kind: 'unknown' });
    expect(parseSender('name:Alice')).toEqual({ kind: 'name', name: 'Alice' });
    expect(parseSender('name:')).toEqual({ kind: 'name', name: '' });
    expect(parseSender('abcdef0123')).toEqual({ kind: 'pubkey', pk: 'abcdef0123' });
  });
});

describe('senderDisplayName', () => {
  it('strips the name: prefix', () => expect(senderDisplayName('name:Alice')).toBe('Alice'));
  it('shortens a raw pubkey to 8 chars + ellipsis', () => expect(senderDisplayName('abcdef0123456789')).toBe('abcdef01…'));
  it('returns empty for self and unknown senders', () => {
    expect(senderDisplayName(undefined)).toBe('');
    expect(senderDisplayName(null)).toBe('');
    expect(senderDisplayName('')).toBe('');
    expect(senderDisplayName('unknown')).toBe('');
  });
});

describe('isRealPubkey', () => {
  it('is true only for a keyed sender', () => {
    expect(isRealPubkey('abcdef0123456789')).toBe(true);
    expect(isRealPubkey('name:Alice')).toBe(false);
    expect(isRealPubkey('unknown')).toBe(false);
    expect(isRealPubkey(undefined)).toBe(false);
    expect(isRealPubkey(null)).toBe(false);
  });
});
