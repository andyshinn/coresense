// Rewrite `version` and `sha256` in a CoreSense Homebrew cask from a built DMG.
// Run by .github/workflows/homebrew-cask.yml on each published release, and
// usable by hand against a downloaded release DMG:
//
//   node scripts/update-cask.mjs --version 0.0.10 --dmg CoreSense-0.0.10-universal.dmg
//   node scripts/update-cask.mjs --version 0.0.12-dev.0 \
//     --dmg CoreSense-0.0.12-dev.0-universal.dmg --cask Casks/coresense@dev.rb
//
// Plain Node ESM, zero dependencies (so CI needs only setup-node, no install).
// Exports its pure helpers for unit tests; runs the CLI only when invoked
// directly. Edits ONLY the two anchored lines and fails loudly rather than emit
// a half-updated cask.
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const DEFAULT_CASK = join(REPO_ROOT, 'Casks', 'coresense.rb');

// Streamed SHA-256 of a file, hex-encoded.
export async function sha256(path) {
  const hash = createHash('sha256');
  await new Promise((res, rej) => {
    createReadStream(path)
      .on('error', rej)
      .on('data', (chunk) => hash.update(chunk))
      .on('end', res);
  });
  return hash.digest('hex');
}

// Replace exactly one `<field> "<old>"` line (anchored at line start), or throw.
export function replaceField(source, field, value) {
  const pattern = new RegExp(`^(\\s*${field}\\s+")[^"]*(")`, 'm');
  if (!pattern.test(source)) {
    throw new Error(`could not find a \`${field} "..."\` line in the cask`);
  }
  return source.replace(pattern, `$1${value}$2`);
}

// Rewrite both `version` and `sha256` in a cask's source text.
export function applyCaskUpdate(source, version, digest) {
  return replaceField(replaceField(source, 'version', version), 'sha256', digest);
}

function fail(message) {
  console.error(`update-cask: ${message}`);
  process.exit(1);
}

async function main() {
  const { values } = parseArgs({
    options: {
      version: { type: 'string' },
      dmg: { type: 'string' },
      cask: { type: 'string', default: DEFAULT_CASK },
    },
  });

  const version = values.version?.replace(/^v/, '');
  if (!version) fail('--version is required (e.g. --version 0.0.10)');
  if (!values.dmg) fail('--dmg is required (path to the release DMG)');

  const dmgPath = resolve(values.dmg);
  const caskPath = resolve(values.cask);

  const dmgStat = await stat(dmgPath).catch(() => null);
  if (!dmgStat?.isFile()) fail(`DMG not found: ${dmgPath}`);

  const digest = await sha256(dmgPath);
  const original = await readFile(caskPath, 'utf8');
  const updated = applyCaskUpdate(original, version, digest);

  if (updated === original) {
    console.log(`update-cask: no change (already version ${version}, sha256 ${digest})`);
  } else {
    await writeFile(caskPath, updated);
    console.log(`update-cask: set version ${version}, sha256 ${digest}`);
  }
}

// Execute the CLI only when run directly (not when imported by tests).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => fail(err.message));
}
