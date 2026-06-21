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
    render(<UpdatesSection client={client} />);
    expect(screen.getByText('Updates')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /check for updates/i }));
    expect(api.checkForUpdates).toHaveBeenCalledTimes(1);
  });

  it('persists a channel change on save', () => {
    render(<UpdatesSection client={client} />);
    fireEvent.change(screen.getByDisplayValue('Stable'), { target: { value: 'development' } });
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
    expect(api.putAppSettings).toHaveBeenCalledWith(
      client,
      expect.objectContaining({ updates: expect.objectContaining({ channel: 'development' }) }),
    );
  });
});
