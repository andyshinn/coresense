import { readdirSync, readFileSync } from 'node:fs';
import { builtinModules } from 'node:module';
import path from 'node:path';
import type { UserConfig } from 'vite';
import { describe, expect, it } from 'vitest';

// Loaded through a computed specifier on purpose: a static import of a .mts
// path trips TS5097 and drags the config into the typecheck program, where its
// unplugin-info options don't type-check. Only the value is wanted here.
const CONFIG = path.resolve(__dirname, '../../../vite.main.config.mts');
const mainConfig: UserConfig = (await import(/* @vite-ignore */ CONFIG)).default;

// forge derives the main-process externals from `module.builtinModules`, which
// omits prefix-only builtins (node:sqlite, node:test, …). A missed one gets
// stubbed by Vite and throws on first property access at runtime, not build
// time — it crashed bootstrap once via StateHolder -> openDb, and only
// `electron-forge start` surfaces it. So: every `node:` specifier main imports
// must be external, from the plugin's list or ours.
const forgeExternals = ['electron', 'electron/common', ...builtinModules.flatMap((m) => [m, `node:${m}`])];

const configured = mainConfig.build?.rollupOptions?.external;
const ourExternals = Array.isArray(configured) ? configured.filter((e): e is string => typeof e === 'string') : [];

const effective = new Set([...forgeExternals, ...ourExternals]);

// Matches `from 'node:x'`, `import('node:x')` and `require('node:x')`.
const NODE_IMPORT = /(?:from\s*|import\s*\(\s*|require\s*\(\s*)['"](node:[\w/.-]+)['"]/g;

// Only src/main: preload and renderer are separate bundles with their own
// configs, and a `node:` import in either would be a different bug.
const MAIN_ROOT = path.resolve(__dirname, '../../../src/main');

function nodeImportsBySpecifier(): Map<string, string[]> {
  const found = new Map<string, string[]>();
  for (const entry of readdirSync(MAIN_ROOT, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.ts')) continue;
    const file = path.join(entry.parentPath, entry.name);
    const source = readFileSync(file, 'utf8');
    for (const [, specifier] of source.matchAll(NODE_IMPORT)) {
      const rel = path.relative(MAIN_ROOT, file);
      found.set(specifier, [...(found.get(specifier) ?? []), rel]);
    }
  }
  return found;
}

describe('main-process vite externals', () => {
  it('externalizes every node: builtin the main bundle imports', () => {
    const imports = nodeImportsBySpecifier();
    // Guard against a silently empty scan making this vacuous.
    expect(imports.size).toBeGreaterThan(5);

    const bundled = [...imports].filter(([specifier]) => !effective.has(specifier));
    expect(bundled.map(([specifier, files]) => `${specifier} (imported by ${files.join(', ')})`)).toEqual([]);
  });

  it('covers the prefix-only builtins the forge plugin structurally cannot', () => {
    // Pins the mechanism, not just the symptom. Harmless if a future Node
    // starts listing these; until then it's the only thing externalizing them.
    for (const specifier of ['node:sqlite']) {
      expect(forgeExternals).not.toContain(specifier);
      expect(ourExternals).toContain(specifier);
    }
  });
});
