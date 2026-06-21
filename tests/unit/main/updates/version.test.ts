import { describe, expect, it } from 'vitest';
import { isNewer, normalizeTag, pickLatest } from '../../../../src/main/updates/version';

describe('normalizeTag', () => {
  it('strips a leading v and validates semver', () => {
    expect(normalizeTag('v0.1.0')).toBe('0.1.0');
    expect(normalizeTag('0.1.0-beta.2')).toBe('0.1.0-beta.2');
    expect(normalizeTag('nightly')).toBeNull();
  });
});

describe('isNewer', () => {
  it('compares release tags against the current version (prerelease-aware)', () => {
    expect(isNewer('v0.0.11', '0.0.10')).toBe(true);
    expect(isNewer('v0.0.10', '0.0.10')).toBe(false);
    expect(isNewer('v0.0.9', '0.0.10')).toBe(false);
    expect(isNewer('v0.1.0-beta.2', '0.1.0-beta.1')).toBe(true);
    expect(isNewer('v0.1.0-beta.1', '0.1.0')).toBe(false);
    expect(isNewer('v0.0.10', '0.1.0-beta.1')).toBe(false); // no downgrade dev->stable
  });
});

describe('pickLatest', () => {
  const releases = [
    { tag_name: 'v0.0.10', html_url: 'u10', prerelease: false, draft: false },
    { tag_name: 'v0.1.0-beta.1', html_url: 'b1', prerelease: true, draft: false },
    { tag_name: 'v0.1.0-beta.3', html_url: 'b3', prerelease: true, draft: false },
    { tag_name: 'v9.9.9', html_url: 'draft', prerelease: false, draft: true },
  ];
  it('stable picks the highest non-prerelease, ignoring drafts', () => {
    expect(pickLatest(releases, 'stable')?.html_url).toBe('u10');
  });
  it('development picks the highest prerelease', () => {
    expect(pickLatest(releases, 'development')?.html_url).toBe('b3');
  });
  it('returns null when no candidate matches', () => {
    expect(pickLatest([releases[0]], 'development')).toBeNull();
  });
});
