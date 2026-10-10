import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../../src/renderer/lib/api', () => ({
  api: { putMapSettings: vi.fn() },
}));
vi.mock('../../../../../src/renderer/lib/notify', () => import('../../../../support/notifyMock'));

import { api } from '../../../../../src/renderer/lib/api';
import { updateMapSettings } from '../../../../../src/renderer/lib/map/settings';
import { useStore } from '../../../../../src/renderer/lib/store';
import { DEFAULT_MAP_SETTINGS } from '../../../../../src/shared/types';
import { notify } from '../../../../support/notifyMock';

const client = { baseUrl: 'http://x', apiKey: 'k' };
const put = vi.mocked(api.putMapSettings);
const mapSettings = () => useStore.getState().mapSettings;

beforeEach(() => {
  useStore.getState().applyMapSettings(DEFAULT_MAP_SETTINGS);
  put.mockResolvedValue({ ok: true });
});
afterEach(() => {
  vi.clearAllMocks();
});

describe('updateMapSettings', () => {
  it('merges the patch into the live settings, applies it and PUTs the merged object', () => {
    updateMapSettings(client, { favouritesOnly: true });
    expect(mapSettings()).toEqual({ ...DEFAULT_MAP_SETTINGS, favouritesOnly: true });
    expect(put).toHaveBeenCalledWith(client, { ...DEFAULT_MAP_SETTINGS, favouritesOnly: true });
  });

  it("builds on the store, not a caller's stale snapshot", () => {
    updateMapSettings(client, { lastZoom: 9 });
    updateMapSettings(client, { favouritesOnly: true });
    expect(put).toHaveBeenLastCalledWith(client, { ...DEFAULT_MAP_SETTINGS, lastZoom: 9, favouritesOnly: true });
  });

  it('applies locally without a PUT when there is no client', () => {
    updateMapSettings(null, { showMarkerLabels: false });
    expect(mapSettings().showMarkerLabels).toBe(false);
    expect(put).not.toHaveBeenCalled();
  });

  it('reports a failed PUT and rolls the store back', async () => {
    const err = new Error('disk full');
    put.mockRejectedValueOnce(err);
    updateMapSettings(client, { favouritesOnly: true });
    expect(mapSettings().favouritesOnly).toBe(true);
    await vi.waitFor(() => expect(notify.failure).toHaveBeenCalledWith('Saving map settings', err));
    expect(mapSettings()).toEqual(DEFAULT_MAP_SETTINGS);
  });

  it('keeps a newer write when an older PUT fails', async () => {
    let reject: (err: unknown) => void = () => {};
    put.mockImplementationOnce(() => new Promise((_, r) => (reject = r)));
    updateMapSettings(client, { favouritesOnly: true });
    updateMapSettings(client, { lastZoom: 11 });
    reject(new Error('boom'));
    await vi.waitFor(() => expect(notify.failure).toHaveBeenCalled());
    expect(mapSettings()).toEqual({ ...DEFAULT_MAP_SETTINGS, favouritesOnly: true, lastZoom: 11 });
  });
});
