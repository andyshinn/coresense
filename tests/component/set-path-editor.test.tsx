import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { SetPathEditor } from '@/components/path/SetPathEditor';
import { getNameColor } from '@/lib/contactColor';
import { useStore } from '@/lib/store';
import type { Contact } from '../../src/shared/types';
import { DEFAULT_APP_SETTINGS } from '../../src/shared/types';

// The Path editor is the exact UI from the bug report: before the packed
// out_path_len fix, a direct 2-byte-mode repeater arrived with outPathHex =
// "00"×64, which split into 32 "0000" hop rows. Post-fix the contact carries the
// correct outPathHex, so this asserts the rows the editor renders from it.
const base: Omit<Contact, 'outPathHex' | 'outPathHashSize' | 'hops'> = {
  key: `c:${'42'.repeat(32)}`,
  publicKeyHex: '42'.repeat(32),
  name: 'egrme.sh RAK3401',
  kind: 'repeater',
  favourite: false,
};

afterEach(() => {
  useStore.getState().applyContacts([]);
});

describe('SetPathEditor path rows', () => {
  it('renders no hop rows (no "0000") for a direct contact — empty out_path', () => {
    useStore.getState().applyContacts([]);
    // A direct / 0-hop contact: firmware out_path_len 0x40 decodes to zero path
    // bytes, so the on-radio Contact carries outPathHex undefined.
    const direct: Contact = { ...base, hops: 0, outPathHex: undefined, outPathHashSize: undefined };
    render(<SetPathEditor contact={direct} client={null} />);

    expect(screen.queryAllByLabelText('Hop prefix')).toHaveLength(0);
    expect(screen.getByText(/No hops/)).toBeTruthy();
    // The regression symptom was 32 "0000" hop inputs — none must exist now.
    expect(screen.queryByDisplayValue('0000')).toBeNull();
  });

  it('renders one row per real hop for a 3-hop 2-byte path', () => {
    useStore.getState().applyContacts([]);
    const threeHop: Contact = { ...base, hops: 3, outPathHex: 'aabbccddeeff', outPathHashSize: 2 };
    render(<SetPathEditor contact={threeHop} client={null} />);

    const inputs = screen.queryAllByLabelText('Hop prefix') as HTMLInputElement[];
    expect(inputs.map((i) => i.value)).toEqual(['aabb', 'ccdd', 'eeff']);
    // Path summary reflects the real hop count, not a byte length.
    expect(screen.getByText('3 hops')).toBeTruthy();
  });
});

// A repeater saved as a contact, so `repeaterChoices` (built from the store's
// `contacts`) resolves the first hop below as "known". Its pubkey is
// deliberately longer than — and distinct from — the 4-char prefix a hop row
// carries, so a test asserting "hashes the pubkey" cannot be satisfied by a
// component that actually hashes the prefix string instead.
const repeaterName = 'RelayOne';
const repeaterPubkey = `ab12${'00'.repeat(30)}`;
const knownRepeater: Contact = {
  key: `c:${repeaterPubkey}`,
  publicKeyHex: repeaterPubkey,
  name: repeaterName,
  kind: 'repeater',
};

describe('SetPathEditor hop avatar identity', () => {
  afterEach(() => {
    useStore.getState().applyContacts([]);
    useStore.getState().applyAppSettings(DEFAULT_APP_SETTINGS);
  });

  it('hashes an unknown hop prefix under byKey (default) — the prefix is key material', () => {
    useStore.getState().applyContacts([]);
    // A second, known hop shares the render so an assertion on the unknown
    // hop's exact colour can't be satisfied by a component that (bug) always
    // hashes `name`: for THIS hop name and prefix are the same string, but the
    // sibling known hop below pins that identity, not name, drives the hash.
    const contact: Contact = { ...base, hops: 2, outPathHex: 'ab12ff34', outPathHashSize: 2 };
    useStore.getState().applyContacts([knownRepeater]);
    const { container } = render(<SetPathEditor contact={contact} client={null} />);

    const avatars = container.querySelectorAll('li .rounded-full');
    expect(avatars).toHaveLength(2);
    const unknownAvatar = avatars[1] as HTMLElement;
    // Unknown hop (index 1, prefix "ff34"): hashes the prefix under byKey.
    expect(unknownAvatar.className).not.toContain('bg-cs-bg-3');
    expect(unknownAvatar.style.color).toBe(getNameColor('ff34').fg);
  });

  it('goes neutral for an unknown hop under byName — no name exists to hash', () => {
    useStore.getState().applyContacts([]);
    useStore.getState().applyAppSettings({ ...DEFAULT_APP_SETTINGS, identityColorMode: 'byName' });
    const contact: Contact = { ...base, hops: 1, outPathHex: 'ab12', outPathHashSize: 2 };
    const { container } = render(<SetPathEditor contact={contact} client={null} />);

    const avatar = container.querySelector('.rounded-full') as HTMLElement;
    expect(avatar.className).toContain('bg-cs-bg-3');
    expect(avatar.style.color).toBe('');
  });

  it('known repeater under byKey hashes its pubkey, not its name and not its prefix', () => {
    useStore.getState().applyContacts([knownRepeater]);
    const contact: Contact = { ...base, hops: 1, outPathHex: 'ab12', outPathHashSize: 2 };
    const { container } = render(<SetPathEditor contact={contact} client={null} />);

    const avatar = container.querySelector('li .rounded-full') as HTMLElement;
    expect(avatar.style.color).toBe(getNameColor(repeaterPubkey).fg);
    expect(avatar.style.color).not.toBe(getNameColor('ab12').fg);
    expect(avatar.style.color).not.toBe(getNameColor(repeaterName).fg);
  });

  // Regression test for I-1: `knownPublicKeyHex ?? (identityMode === 'byKey' ?
  // hop.prefixHex : null)` short-circuited on the known pubkey before the mode
  // was ever consulted, so a known repeater under byName still hashed its
  // pubkey — landing on a different ramp slot than the Add-hop picker, which
  // correctly hashes the name. This asserts they now agree.
  it('known repeater under byName matches the Add-hop picker avatar for the same repeater', async () => {
    useStore.getState().applyContacts([knownRepeater]);
    useStore.getState().applyAppSettings({ ...DEFAULT_APP_SETTINGS, identityColorMode: 'byName' });
    const contact: Contact = { ...base, hops: 1, outPathHex: 'ab12', outPathHashSize: 2 };
    const { container } = render(<SetPathEditor contact={contact} client={null} />);

    const hopAvatar = container.querySelector('li .rounded-full') as HTMLElement;
    expect(hopAvatar.style.color).toBe(getNameColor(repeaterName).fg);

    fireEvent.click(screen.getByRole('button', { name: /add hop/i }));
    // cmdk mirrors item labels into a visually-hidden live region for
    // screen readers, so `findByText` matches twice; go straight for the
    // single known-repeater item instead.
    const pickerItem = (await screen.findAllByRole('option')).find((el) => el.textContent?.includes(repeaterName));
    const pickerAvatar = pickerItem?.querySelector('.rounded-full') as HTMLElement;

    expect(pickerAvatar.style.color).toBe(hopAvatar.style.color);
    expect(pickerAvatar.style.color).toBe(getNameColor(repeaterName).fg);
  });
});
