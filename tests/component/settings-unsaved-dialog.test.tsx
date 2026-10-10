import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { notify } from '@/lib/notify';
import { useStore } from '@/lib/store';
import { registerSectionHandle, unregisterSectionHandle } from '@/panels/settings/sectionHandles';
import { UnsavedChangesDialog } from '@/panels/settings/UnsavedChangesDialog';

const initial = useStore.getState();

beforeEach(() => {
  useStore.setState({
    settingsUi: {
      ...initial.settingsUi,
      activeTab: 'app',
      sections: [{ id: 'app-a', title: 'Section A', tab: 'app' }],
      dirtyById: { 'app-a': true },
      pendingTarget: { kind: 'tab', tab: 'radio' },
    },
  });
});

afterEach(() => {
  unregisterSectionHandle('app-a');
  vi.restoreAllMocks();
});

describe('UnsavedChangesDialog', () => {
  it('Save all: a failed save keeps the dialog open and does not carry out the navigation', async () => {
    const failure = vi.spyOn(notify, 'failure').mockImplementation(() => {});
    const err = new Error('disk full');
    registerSectionHandle('app-a', { save: vi.fn(async () => Promise.reject(err)), reset: vi.fn() });

    render(<UnsavedChangesDialog client={null} />);
    fireEvent.click(screen.getByRole('button', { name: 'Save all' }));

    await waitFor(() => expect(failure).toHaveBeenCalledWith('Save', err));
    const s = useStore.getState().settingsUi;
    expect(s.pendingTarget).toEqual({ kind: 'tab', tab: 'radio' });
    expect(s.activeTab).toBe('app');
    expect(screen.getByText('Unsaved settings changes')).toBeTruthy();
    // Re-enabled for a retry once the save settles.
    expect((screen.getByRole('button', { name: 'Save all' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('Save all: a successful save carries out the pending navigation', async () => {
    const save = vi.fn(async () => {});
    registerSectionHandle('app-a', { save, reset: vi.fn() });

    render(<UnsavedChangesDialog client={null} />);
    fireEvent.click(screen.getByRole('button', { name: 'Save all' }));

    await waitFor(() => expect(useStore.getState().settingsUi.activeTab).toBe('radio'));
    expect(save).toHaveBeenCalledTimes(1);
    expect(useStore.getState().settingsUi.pendingTarget).toBeNull();
  });
});
