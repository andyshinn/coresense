import semver from 'semver';
import type { UpdateChannel } from '../../shared/types';

export interface GitHubRelease {
  tag_name: string;
  html_url: string;
  prerelease: boolean;
  draft: boolean;
}

/** Strip a leading `v` and return a valid semver string, or null. */
export function normalizeTag(tag: string): string | null {
  return semver.valid(tag.replace(/^v/, '').trim());
}

/** True when `latestTag` is a strictly newer version than `current`. */
export function isNewer(latestTag: string, current: string): boolean {
  const latest = normalizeTag(latestTag);
  const cur = semver.valid(current);
  if (!latest || !cur) return false;
  return semver.gt(latest, cur);
}

/**
 * Highest-semver published release for the channel.
 * Stable = newest non-prerelease; Development = newest prerelease.
 * Drafts are always excluded (unauthenticated API never returns them anyway).
 */
export function pickLatest(releases: GitHubRelease[], channel: UpdateChannel): GitHubRelease | null {
  const wantPrerelease = channel === 'development';
  let best: GitHubRelease | null = null;
  let bestVersion: string | null = null;
  for (const r of releases) {
    if (r.draft) continue;
    if (r.prerelease !== wantPrerelease) continue;
    const v = normalizeTag(r.tag_name);
    if (!v) continue;
    if (!bestVersion || semver.gt(v, bestVersion)) {
      best = r;
      bestVersion = v;
    }
  }
  return best;
}
