import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../src/renderer/lib/api', () => ({
  api: {
    putAppSettings: vi.fn(async () => ({ ok: true })),
  },
}));

import { api } from '../../src/renderer/lib/api';
import { AppearanceSection } from '../../src/renderer/panels/settings/app/Appearance';

const client = { baseUrl: 'http://x', apiKey: 'k' };

describe('AppearanceSection', () => {
  it('saves a changed identity colour mode', () => {
    render(<AppearanceSection client={client} />);
    fireEvent.change(screen.getByDisplayValue('By key (only verified identities)'), {
      target: { value: 'byName' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
    expect(api.putAppSettings).toHaveBeenCalledWith(client, expect.objectContaining({ identityColorMode: 'byName' }));
  });

  it('warns that byKey leaves channel posters grey', () => {
    render(<AppearanceSection client={client} />);
    expect(screen.getByText(/Posters stay grey until this node hears an advert/)).toBeTruthy();
  });
});
