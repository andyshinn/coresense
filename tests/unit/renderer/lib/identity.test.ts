import { describe, expect, it } from 'vitest';
import { buildDiscoveredNameIndex, identityHashInput, resolveIdentity } from '../../../../src/renderer/lib/identity';
import type { DiscoveredContact } from '../../../../src/shared/contacts/discovered';
import type { Contact } from '../../../../src/shared/types';

const PK = 'a'.repeat(64);

const contact = (over: Partial<Contact> = {}): Contact => ({
  key: 'c:abc',
  publicKeyHex: 'abc',
  name: 'alice',
  kind: 'chat',
  ...over,
});

const disc = (over: Partial<DiscoveredContact> = {}): DiscoveredContact => ({
  key: 'c:def',
  publicKeyHex: 'def',
  name: 'bob',
  kind: 'chat',
  firstHeardMs: 1,
  onRadio: false,
  favourite: false,
  blocked: false,
  ...over,
});

const idx = (rows: DiscoveredContact[] = []) => buildDiscoveredNameIndex(rows);

describe('resolveIdentity', () => {
  it('resolves a named poster to a saved contact', () => {
    const r = resolveIdentity('name:alice', [contact()], idx());
    expect(r).toMatchObject({ name: 'alice', pubkey: 'abc', contactKey: 'c:abc', source: 'contact', ambiguous: false });
  });

  it('falls back to the discovered pool when no contact matches', () => {
    const r = resolveIdentity('name:bob', [contact()], idx([disc()]));
    expect(r).toMatchObject({ name: 'bob', pubkey: 'def', source: 'discovered', ambiguous: false });
    expect(r.contactKey).toBeNull();
  });

  it('prefers a saved contact over a discovered row with the same name', () => {
    const r = resolveIdentity('name:alice', [contact()], idx([disc({ name: 'alice', publicKeyHex: 'zzz' })]));
    expect(r.source).toBe('contact');
    expect(r.pubkey).toBe('abc');
  });

  it('treats two discovered nodes sharing a name as unresolved', () => {
    const rows = [disc({ publicKeyHex: 'd1' }), disc({ publicKeyHex: 'd2' })];
    const r = resolveIdentity('name:bob', [], idx(rows));
    expect(r).toMatchObject({ name: 'bob', pubkey: null, source: 'none', ambiguous: true });
  });

  it('matches exactly — case and whitespace differences miss', () => {
    expect(resolveIdentity('name:Alice', [contact()], idx()).source).toBe('none');
    expect(resolveIdentity('name:alice ', [contact()], idx()).source).toBe('none');
  });

  it('carries the blocked flag from the discovered row', () => {
    const r = resolveIdentity('name:bob', [], idx([disc({ blocked: true })]));
    expect(r.blocked).toBe(true);
  });

  it('returns a nameless identity for self and unknown', () => {
    for (const fromPk of [null, undefined, 'unknown']) {
      const r = resolveIdentity(fromPk, [contact()], idx());
      expect(r).toMatchObject({ name: null, pubkey: null, source: 'none' });
    }
  });

  it('routes a raw pubkey straight through, with its contact when saved', () => {
    expect(resolveIdentity(PK, [], idx())).toMatchObject({ pubkey: PK, contactKey: null, source: 'none' });
    const saved = contact({ key: `c:${PK}`, publicKeyHex: PK, name: 'zed' });
    expect(resolveIdentity(PK, [saved], idx())).toMatchObject({ pubkey: PK, contactKey: `c:${PK}`, source: 'contact' });
  });

  // Regression tests for M-5: the raw-hex branch used to hardcode
  // `blocked: false` and never consult the discovered pool, contradicting the
  // spec ("blocked comes from the resolved DiscoveredContact.blocked").
  // Unreachable from the People rail (channel posts never carry a raw
  // pubkey), but `useIdentityHash` sends every DM/hex sender through it.
  it('resolves blocked for a raw pubkey found in the discovered pool, with no saved contact', () => {
    const heard = disc({ publicKeyHex: PK, name: 'zed', blocked: true });
    const r = resolveIdentity(PK, [], idx([heard]));
    expect(r).toMatchObject({ pubkey: PK, contactKey: null, source: 'none', blocked: true });
  });

  it('resolves blocked for a raw pubkey that is also a saved contact', () => {
    const saved = contact({ key: `c:${PK}`, publicKeyHex: PK, name: 'zed' });
    const heard = disc({ publicKeyHex: PK, name: 'zed', blocked: true });
    const r = resolveIdentity(PK, [saved], idx([heard]));
    expect(r).toMatchObject({ pubkey: PK, contactKey: `c:${PK}`, source: 'contact', blocked: true });
  });

  it('defaults blocked to false for a raw pubkey never heard from', () => {
    const heard = disc({ publicKeyHex: 'someone-else', blocked: true });
    const r = resolveIdentity(PK, [], idx([heard]));
    expect(r.blocked).toBe(false);
  });
});

describe('identityHashInput', () => {
  const resolved = resolveIdentity('name:alice', [contact()], idx());
  const unresolved = resolveIdentity('name:nobody', [], idx());

  it('byKey hashes the pubkey when one is known', () => {
    expect(identityHashInput(resolved, 'byKey')).toBe('abc');
  });

  it('byKey returns null (neutral) when no pubkey is known', () => {
    expect(identityHashInput(unresolved, 'byKey')).toBeNull();
  });

  it('byName hashes the display name regardless of resolution', () => {
    expect(identityHashInput(resolved, 'byName')).toBe('alice');
    expect(identityHashInput(unresolved, 'byName')).toBe('nobody');
  });

  it('is neutral for a nameless identity in either mode', () => {
    const self = resolveIdentity(null, [], idx());
    expect(identityHashInput(self, 'byKey')).toBeNull();
    expect(identityHashInput(self, 'byName')).toBeNull();
  });
});
