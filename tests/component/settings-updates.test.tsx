import { Theme } from '@radix-ui/themes';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../src/renderer/lib/api', () => ({
  api: {
    putAppSettings: vi.fn(async () => ({ ok: true })),
    checkForUpdates: vi.fn(async () => ({ ok: true, updateState: null })),
  },
}));

import { api } from '../../src/renderer/lib/api';
import { UpdatesSection } from '../../src/renderer/panels/settings/app/Updates';

const client = { baseUrl: 'http://x', apiKey: 'k' };

describe('UpdatesSection', () => {
  it('renders channel + auto-check and triggers a manual check', () => {
    render(
      <Theme>
        <UpdatesSection client={client} />
      </Theme>,
    );
    expect(screen.getByText('Updates')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /check for updates/i }));
    expect(api.checkForUpdates).toHaveBeenCalledTimes(1);
  });

  it('persists a channel change on save', () => {
    render(
      <Theme>
        <UpdatesSection client={client} />
      </Theme>,
    );
    // Radix Select renders a combobox trigger (unlabelled) + a listbox portal.
    // Click the trigger to open the dropdown, then click the desired option.
    fireEvent.click(screen.getByRole('combobox'));
    fireEvent.click(screen.getByRole('option', { name: 'Development' }));
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
    expect(api.putAppSettings).toHaveBeenCalledWith(
      client,
      expect.objectContaining({ updates: expect.objectContaining({ channel: 'development' }) }),
    );
  });
});
