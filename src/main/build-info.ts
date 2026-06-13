// Single home for the build-time virtuals exposed by unplugin-info, so the
// (very narrow) handling of "no git checkout" sits in one place. The plugin
// throws if either module fails to resolve at build time, so a missing git
// repo at build time is what we paper over here — the runtime read is
// otherwise guaranteed to succeed.
import { abbreviatedSha as rawAbbrev } from '~build/git';
import { version as packageVersion } from '~build/package';

export const APP_VERSION: string = packageVersion;

// unplugin-info exposes a 10-char abbreviation; we shorten to 7 to match
// `git rev-parse --short` defaults users see in the terminal. If the build
// happened outside a git checkout, abbreviatedSha can be an empty string —
// surface that as the literal "unknown" so downstream UI can render it
// without a special case.
export const GIT_SHA: string = rawAbbrev && rawAbbrev.length > 0 ? rawAbbrev.slice(0, 7) : 'unknown';
