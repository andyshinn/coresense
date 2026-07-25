import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { SetPathEditor } from '@/components/path/SetPathEditor';
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

describe('SetPathEditor unknown-hop avatar identity', () => {
  afterEach(() => {
    useStore.getState().applyContacts([]);
    useStore.getState().applyAppSettings(DEFAULT_APP_SETTINGS);
  });

  it('hashes an unknown hop prefix under byKey (default) — the prefix is key material', () => {
    useStore.getState().applyContacts([]);
    const contact: Contact = { ...base, hops: 1, outPathHex: 'ab12', outPathHashSize: 2 };
    const { container } = render(<SetPathEditor contact={contact} client={null} />);

    const avatar = container.querySelector('.rounded-full') as HTMLElement;
    expect(avatar.className).not.toContain('bg-cs-bg-3');
    expect(avatar.style.color).toBeTruthy();
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
});
