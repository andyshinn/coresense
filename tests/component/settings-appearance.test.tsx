import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/renderer/lib/api', () => ({
  api: {
    putAppSettings: vi.fn(async () => ({ ok: true })),
  },
}));

import { api } from '../../src/renderer/lib/api';
import { useStore } from '../../src/renderer/lib/store';
import { AppearanceSection } from '../../src/renderer/panels/settings/app/Appearance';

const client = { baseUrl: 'http://x', apiKey: 'k' };

afterEach(() => {
  vi.mocked(api.putAppSettings).mockClear();
  // The zustand store is a module global; leave the theme where the app's own
  // default leaves it so ordering between tests can't matter.
  act(() => {
    useStore.getState().setThemePref('auto');
  });
});

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

  // Issue #22 — the selector used to write AppSettings.theme, which nothing
  // ever read, so picking a theme did nothing at all.
  it('writes the theme straight to ui.themePref, which is what the app applies', () => {
    render(<AppearanceSection client={client} />);
    fireEvent.change(screen.getByDisplayValue('Auto (system)'), { target: { value: 'light' } });
    expect(useStore.getState().ui.themePref).toBe('light');
  });

  it('applies the theme immediately, without going through the section Save', () => {
    render(<AppearanceSection client={client} />);
    fireEvent.change(screen.getByDisplayValue('Auto (system)'), { target: { value: 'dark' } });
    // Instant-apply: no save call, and the section's Save button stays
    // disabled because the theme is not part of its draft at all.
    expect(useStore.getState().ui.themePref).toBe('dark');
    expect(api.putAppSettings).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /^save$/i })).toHaveProperty('disabled', true);
  });

  it('no longer carries a theme in the saved app-settings payload', () => {
    render(<AppearanceSection client={client} />);
    fireEvent.change(screen.getByDisplayValue('Auto (system)'), { target: { value: 'dark' } });
    fireEvent.change(screen.getByDisplayValue('Rich (sender + meta)'), { target: { value: 'compact' } });
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

    const [, payload] = vi.mocked(api.putAppSettings).mock.calls[0] as unknown as [unknown, Record<string, unknown>];
    expect(payload.messageStyle).toBe('compact');
    expect(payload).not.toHaveProperty('theme');
  });

  // Issue #22, secondary symptom: Cmd-T wrote ui.themePref while the selector
  // rendered AppSettings.theme, so the dropdown showed a stale value.
  it('follows a theme changed from outside the panel (the Cmd-T path)', () => {
    render(<AppearanceSection client={client} />);
    expect(screen.getByDisplayValue('Auto (system)')).toBeTruthy();

    act(() => {
      useStore.getState().setThemePref('dark');
    });

    expect(screen.getByDisplayValue('Dark')).toBeTruthy();
    expect(screen.queryByDisplayValue('Auto (system)')).toBeNull();
  });
});
