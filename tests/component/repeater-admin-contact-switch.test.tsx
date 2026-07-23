import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

// NeighboursTab (imported by the RepeaterAdmin index) transitively pulls in
// maplibre through MapCanvas, which can't boot in jsdom. We never navigate to
// the Neighbours tab here, so stub the map components to inert nodes.
vi.mock('../../src/renderer/components/map/MapCanvas', () => ({
  MapCanvas: () => null,
}));
vi.mock('../../src/renderer/components/map/NeighbourMapLayer', () => ({
  NeighbourMapLayer: () => null,
}));

vi.mock('../../src/renderer/lib/notify', () => ({
  notify: { success: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

// Owner-info fetch returns data scoped to whichever repeater key was asked for,
// so a stale render is unambiguous: "A-FW" must never appear while viewing B.
vi.mock('../../src/renderer/lib/api', () => ({
  api: {
    repeaterSession: vi.fn(async () => ({ session: null })),
    repeaterOwner: vi.fn(async (_c: unknown, key: string) => ({
      ok: true,
      info: {
        firmwareVersion: key.includes('aa') ? 'A-FW-1.0' : 'B-FW-2.0',
        nodeName: key.includes('aa') ? 'node-A' : 'node-B',
        ownerInfo: key.includes('aa') ? 'owner-A' : 'owner-B',
      },
    })),
  },
}));

import { useStore } from '../../src/renderer/lib/store';
import { RepeaterAdmin } from '../../src/renderer/panels/repeater-admin';
import type { Contact } from '../../src/shared/types';

const client = { baseUrl: 'http://x', apiKey: 'k' };

const repeaterA: Contact = {
  key: `c:${'aa'.repeat(32)}`,
  publicKeyHex: 'aa'.repeat(32),
  name: 'Repeater A',
  kind: 'repeater',
};
const repeaterB: Contact = {
  key: `c:${'bb'.repeat(32)}`,
  publicKeyHex: 'bb'.repeat(32),
  name: 'Repeater B',
  kind: 'repeater',
};

afterEach(() => {
  useStore.getState().setRepeaterAdminTab(null);
  useStore.getState().setRepeaterAdminActiveTab(null);
});

describe('RepeaterAdmin — switching repeaters clears the previous one’s tab data', () => {
  it('does not show repeater A’s fetched owner info after switching to repeater B', async () => {
    const { rerender } = render(<RepeaterAdmin contact={repeaterA} client={client} />);

    // Go to the Owner tab and fetch A's owner info.
    fireEvent.click(screen.getByRole('button', { name: 'Owner' }));
    fireEvent.click(screen.getByRole('button', { name: 'Fetch' }));
    await waitFor(() => expect(screen.getByText('A-FW-1.0')).toBeTruthy());

    // Switch the panel to a different repeater in the same slot (prop change,
    // no remount from the parent) — exactly what the left-nav does.
    rerender(<RepeaterAdmin contact={repeaterB} client={client} />);

    // The stale owner info from A must be gone; B hasn't been fetched yet.
    expect(screen.queryByText('A-FW-1.0')).toBeNull();
    expect(screen.queryByText('owner-A')).toBeNull();
  });
});
