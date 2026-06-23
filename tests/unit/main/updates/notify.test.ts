import { describe, expect, it, vi } from 'vitest';
import { checkNotify } from '../../../../src/main/updates/notify';

function fakeFetch(body: unknown, ok = true, status = 200) {
  return vi.fn(async () => ({ ok, status, json: async () => body })) as unknown as typeof fetch;
}
const now = () => 1_000;

const releases = [
  { tag_name: 'v0.0.10', html_url: 'https://gh/u10', prerelease: false, draft: false },
  { tag_name: 'v0.1.0-beta.1', html_url: 'https://gh/b1', prerelease: true, draft: false },
];

describe('checkNotify', () => {
  it('reports an available stable update', async () => {
    const s = await checkNotify('stable', '0.0.9', { fetch: fakeFetch(releases), now });
    expect(s).toMatchObject({
      status: 'available',
      mode: 'notify',
      channel: 'stable',
      latestVersion: '0.0.10',
      releaseUrl: 'https://gh/u10',
      lastCheckedAt: 1000,
    });
  });

  it('reports an available development (prerelease) update', async () => {
    const s = await checkNotify('development', '0.0.10', { fetch: fakeFetch(releases), now });
    expect(s).toMatchObject({ status: 'available', latestVersion: '0.1.0-beta.1', releaseUrl: 'https://gh/b1' });
  });

  it('reports up-to-date when nothing is newer', async () => {
    const s = await checkNotify('stable', '0.0.10', { fetch: fakeFetch(releases), now });
    expect(s.status).toBe('up-to-date');
    expect(s.releaseUrl).toBeUndefined();
  });

  it('reports an error on a non-OK response', async () => {
    const s = await checkNotify('stable', '0.0.10', { fetch: fakeFetch(null, false, 503), now });
    expect(s.status).toBe('error');
    expect(s.error).toContain('503');
  });
});
