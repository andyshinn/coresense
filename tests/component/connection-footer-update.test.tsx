import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/renderer/lib/api', () => ({
  api: { installUpdate: vi.fn(async () => ({ ok: true })), connect: vi.fn() },
}));
vi.mock('../../src/renderer/lib/notify', () => ({
  notify: { success: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

import { Theme } from '@radix-ui/themes';
import { api } from '../../src/renderer/lib/api';
import { notify } from '../../src/renderer/lib/notify';
import { useStore } from '../../src/renderer/lib/store';
import { ConnectionFooter } from '../../src/renderer/shell/leftnav/ConnectionFooter';
import { NavRoot } from '../../src/renderer/shell/leftnav/nav';
import type { UpdateState } from '../../src/shared/types';

function renderFooter() {
  return render(
    <Theme>
      <NavRoot>
        <ConnectionFooter
          client={{ baseUrl: 'http://x', apiKey: 'k' }}
          state="connected"
          sync={{ phase: 'idle', channels: { done: 0, total: 0 }, contacts: { done: 0, total: 0 } }}
          onClick={() => {}}
          active={false}
        />
      </NavRoot>
    </Theme>,
  );
}

afterEach(() => useStore.getState().applyUpdateState(null));

describe('ConnectionFooter update indicator', () => {
  it('is hidden when no update is pending', () => {
    renderFooter();
    expect(screen.queryByTestId('update-indicator')).toBeNull();
  });

  it('shows the indicator when an update is downloaded', () => {
    const s: UpdateState = {
      status: 'downloaded',
      mode: 'silent',
      channel: 'stable',
      currentVersion: '0.0.10',
      latestVersion: '0.0.11',
    };
    useStore.getState().applyUpdateState(s);
    renderFooter();
    expect(screen.getByTestId('update-indicator')).toBeTruthy();
  });

  it('surfaces an error toast when the install action fails (no silent swallow)', async () => {
    (api.installUpdate as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('boom'));
    useStore.getState().applyUpdateState({
      status: 'downloaded',
      mode: 'silent',
      channel: 'stable',
      currentVersion: '0.0.10',
      latestVersion: '0.0.11',
    });
    renderFooter();
    fireEvent.click(screen.getByTestId('update-indicator'));
    fireEvent.click(await screen.findByRole('button', { name: /restart & install/i }));
    await waitFor(() => expect(notify.error).toHaveBeenCalledWith(expect.stringContaining('boom'), expect.anything()));
  });
});
