import type { UpdateChannel, UpdateState } from '../../shared/types';
import { type GitHubRelease, isNewer, normalizeTag, pickLatest } from './version';

const RELEASES_URL = 'https://api.github.com/repos/andyshinn/coresense/releases?per_page=30';

export interface NotifyDeps {
  fetch: typeof fetch;
  now: () => number;
}

/** Check GitHub Releases for the channel and return a notify-mode UpdateState. */
export async function checkNotify(channel: UpdateChannel, currentVersion: string, deps: NotifyDeps): Promise<UpdateState> {
  const base = { mode: 'notify', channel, currentVersion } as const;
  try {
    const res = await deps.fetch(RELEASES_URL, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'coresense-updater' },
    });
    if (!res.ok) throw new Error(`GitHub API ${res.status}`);
    const releases = (await res.json()) as GitHubRelease[];
    const latest = pickLatest(releases, channel);
    const lastCheckedAt = deps.now();
    if (latest && isNewer(latest.tag_name, currentVersion)) {
      return {
        ...base,
        status: 'available',
        latestVersion: normalizeTag(latest.tag_name) ?? latest.tag_name,
        releaseUrl: latest.html_url,
        lastCheckedAt,
      };
    }
    return { ...base, status: 'up-to-date', lastCheckedAt };
  } catch (err) {
    return { ...base, status: 'error', error: (err as Error).message, lastCheckedAt: deps.now() };
  }
}
