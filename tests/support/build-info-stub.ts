// Test stub for the unplugin-info virtual modules `~build/git` and
// `~build/package`. The integration Vitest project aliases both to this file
// (see vitest.config.ts) because the real virtual modules only exist when the
// app is bundled through Vite with unplugin-info. build-info.ts reads
// `abbreviatedSha` from ~build/git and `version` from ~build/package.
export const abbreviatedSha = 'testsha';
export const version = '0.0.0-test';
