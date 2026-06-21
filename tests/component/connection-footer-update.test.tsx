import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/renderer/lib/api', () => ({
  api: { installUpdate: vi.fn(async () => ({ ok: true })), connect: vi.fn() },
}));

import { SidebarProvider } from '../../src/renderer/components/ui/sidebar';
import { useStore } from '../../src/renderer/lib/store';
import { ConnectionFooter } from '../../src/renderer/shell/leftnav/ConnectionFooter';
import type { UpdateState } from '../../src/shared/types';

function renderFooter() {
  return render(
    <SidebarProvider>
      <ConnectionFooter
        client={{ baseUrl: 'http://x', apiKey: 'k' }}
        state="connected"
        sync={{ phase: 'idle', channels: { done: 0, total: 0 }, contacts: { done: 0, total: 0 } }}
        onClick={() => {}}
        active={false}
      />
    </SidebarProvider>,
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
});
