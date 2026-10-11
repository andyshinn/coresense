import { act, fireEvent, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Settings › App › Behavior carries the global telemetry retention, the same
// value the compare view's "Keep per node" edits (DECISIONS: Retention).

const { api, notify } = vi.hoisted(() => ({
  api: { putAppSettings: vi.fn(async () => ({ ok: true })) },
  notify: { success: vi.fn(), info: vi.fn(), error: vi.fn() },
}));
vi.mock('../../src/renderer/lib/notify', () => ({ notify }));
vi.mock('../../src/renderer/lib/api', async (orig) => ({
  ...(await orig<typeof import('../../src/renderer/lib/api')>()),
  api,
}));

import { useStore } from '../../src/renderer/lib/store';
import { BehaviorSection } from '../../src/renderer/panels/settings/app';
import { DEFAULT_APP_SETTINGS } from '../../src/shared/types';
import { renderWithClient } from '../support/renderWithClient';

beforeEach(() => {
  api.putAppSettings.mockClear();
  useStore.setState({ appSettings: { ...DEFAULT_APP_SETTINGS, telemetry: { retentionPerNode: 77 } } });
});

describe('Settings › App › telemetry retention', () => {
  it('shows the retention and saves a change, clamped, with the rest of the section', async () => {
    renderWithClient(<BehaviorSection />);
    const input = screen.getByDisplayValue('77') as HTMLInputElement;
    expect(screen.getByText('Saved telemetry per node')).toBeTruthy();

    fireEvent.change(input, { target: { value: '900' } });
    expect(input.value).toBe('500');
    await act(async () => {
      fireEvent.click(screen.getByText('Save'));
    });
    expect(api.putAppSettings).toHaveBeenCalledTimes(1);
    const sent = (api.putAppSettings.mock.calls[0] as unknown[])[1] as typeof DEFAULT_APP_SETTINGS;
    expect(sent.telemetry.retentionPerNode).toBe(500);
  });
});
