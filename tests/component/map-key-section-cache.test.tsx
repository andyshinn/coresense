import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/renderer/lib/api', () => ({
  api: {
    setProtomapsApiKey: vi.fn(async () => ({ ok: true, hasKey: true })),
    clearProtomapsApiKey: vi.fn(async () => ({ ok: true, hasKey: false })),
    getTileCacheInfo: vi.fn(async () => ({ bytes: 25 * 1024 * 1024, count: 3 })),
    clearTileCache: vi.fn(async () => ({ bytes: 0, count: 0 })),
    openTileCacheFolder: vi.fn(async () => ({ ok: true })),
    putMapSettings: vi.fn(async () => ({ ok: true })),
  },
}));
vi.mock('../../src/renderer/lib/notify', () => ({
  notify: { success: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

import { MapKeySection } from '../../src/renderer/components/settings/MapKeySection';
import { api } from '../../src/renderer/lib/api';

const client = { baseUrl: 'http://x', apiKey: 'k' };

afterEach(() => vi.clearAllMocks());

describe('MapKeySection cache controls', () => {
  it('shows the current cache size on mount', async () => {
    render(<MapKeySection client={client} />);
    expect(await screen.findByText(/25\.0 MB/)).toBeTruthy();
  });

  it('clears the cache and refreshes size', async () => {
    render(<MapKeySection client={client} />);
    await waitFor(() => expect(api.getTileCacheInfo).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: /clear cache/i }));
    await waitFor(() => expect(api.clearTileCache).toHaveBeenCalledWith(client));
  });

  it('opens the cache folder', async () => {
    render(<MapKeySection client={client} />);
    fireEvent.click(screen.getByRole('button', { name: /open folder/i }));
    await waitFor(() => expect(api.openTileCacheFolder).toHaveBeenCalledWith(client));
  });

  it('persists a new cap when the select changes', async () => {
    render(<MapKeySection client={client} />);
    fireEvent.change(screen.getByLabelText(/cache size limit/i), {
      target: { value: String(1024 * 1024 * 1024) },
    });
    await waitFor(() => expect(api.putMapSettings).toHaveBeenCalled());
  });
});
