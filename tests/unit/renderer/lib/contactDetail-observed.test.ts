import { describe, expect, it } from 'vitest';
import { resolveContact } from '../../../../src/renderer/lib/contactDetail';
import type { DiscoveredContact } from '../../../../src/shared/contacts/discovered';
import type { Contact } from '../../../../src/shared/types';

// #45 item 7: the rail shows two hop counts in two directions. The merge is
// where they could most easily be collapsed back into one, because the on-radio
// Contact carries `hops` and the discovered row carries both.

const PK = 'ab'.repeat(32);

const discovered = (over: Partial<DiscoveredContact> = {}): DiscoveredContact => ({
  key: `c:${PK}`,
  publicKeyHex: PK,
  name: 'Node',
  kind: 'chat',
  firstHeardMs: 1_750_000_000_000,
  onRadio: true,
  favourite: false,
  blocked: false,
  ...over,
});

const contact = (over: Partial<Contact> = {}): Contact =>
  ({ key: `c:${PK}`, publicKeyHex: PK, name: 'Node', kind: 'chat', ...over }) as Contact;

describe('resolveContact — observed (inbound) hops', () => {
  it('keeps the inbound and outbound counts apart', () => {
    const rc = resolveContact(PK, [discovered({ hops: 1, observedHops: 4 })], [contact({ hops: 1 })]);

    expect(rc?.hops).toBe(1);
    expect(rc?.observedHops).toBe(4);
  });

  it('carries a zero-hop measurement through as 0', () => {
    const rc = resolveContact(PK, [discovered({ observedHops: 0 })], []);

    expect(rc?.observedHops).toBe(0);
  });

  // There is no inbound field on the on-radio Contact, so there is nothing to
  // fall back TO — and falling back to `hops` would be exactly the
  // outbound-for-inbound substitution this change exists to remove.
  it('never falls back to the on-radio contact for an unmeasured node', () => {
    const rc = resolveContact(PK, [discovered({ hops: 2 })], [contact({ hops: 2 })]);

    expect(rc?.hops).toBe(2);
    expect(rc?.observedHops).toBeUndefined();
  });

  it('reports the radio-clock reception time when there is one', () => {
    const rc = resolveContact(PK, [discovered({ observedHops: 3, observedAtMs: 1_760_000_000_000 })], []);

    expect(rc?.observedAtMs).toBe(1_760_000_000_000);
  });

  it('leaves both undefined for a contact with no discovered row at all', () => {
    const rc = resolveContact(PK, [], [contact({ hops: 2 })]);

    expect(rc?.observedHops).toBeUndefined();
    expect(rc?.observedAtMs).toBeUndefined();
  });
});
