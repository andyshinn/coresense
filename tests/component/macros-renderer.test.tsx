import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '@/lib/api';
import { useStore } from '@/lib/store';
import type { MacroTemplate } from '../../src/shared/macros/types';

const client = { baseUrl: 'http://x', apiKey: 'k' } as Parameters<typeof api.getMacros>[0];

beforeEach(() => useStore.setState({ macros: [] }));
afterEach(() => vi.unstubAllGlobals());

describe('renderer macro plumbing', () => {
  it('getMacros calls GET /api/macros', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => [] });
    vi.stubGlobal('fetch', fetchMock);
    await api.getMacros(client);
    expect(fetchMock).toHaveBeenCalledWith('http://x/api/macros', expect.objectContaining({}));
  });

  it('applyMacros updates the store slice', () => {
    const macros: MacroTemplate[] = [{ id: '1', name: 'a', template: 'x', scope: 'global', createdAt: 0, updatedAt: 0 }];
    useStore.getState().applyMacros(macros);
    expect(useStore.getState().macros).toEqual(macros);
  });
});
