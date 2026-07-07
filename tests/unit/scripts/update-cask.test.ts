import { createHash } from 'node:crypto';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { applyCaskUpdate, replaceField, sha256 } from '../../../scripts/update-cask.mjs';

// The `url` line embeds Ruby interpolation (`#{version}`) that MUST survive an
// update untouched — a naive replace could corrupt it. Kept in a const so the
// long line is written once.
const URL_LINE =
  '  url "https://github.com/andyshinn/coresense/releases/download/v#{version}/CoreSense-#{version}-universal.dmg"';

const CASK = [
  'cask "coresense@dev" do',
  '  version "0.0.11-dev.0"',
  '  sha256 "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"',
  '',
  URL_LINE,
  '  app "CoreSense.app"',
  'end',
  '',
].join('\n');

describe('update-cask', () => {
  it('rewrites version and sha256, touching only those two lines', () => {
    const digest = 'b'.repeat(64);
    const out = applyCaskUpdate(CASK, '0.0.12-dev.0', digest);

    expect(out).toContain('  version "0.0.12-dev.0"');
    expect(out).toContain(`  sha256 "${digest}"`);
    expect(out).toContain(URL_LINE); // interpolation preserved

    const before = CASK.split('\n');
    const after = out.split('\n');
    const changed = before.filter((line, i) => line !== after[i]);
    expect(changed).toEqual([
      '  version "0.0.11-dev.0"',
      '  sha256 "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"',
    ]);
  });

  it('throws when the target field line is missing', () => {
    expect(() => replaceField('cask "x" do\nend\n', 'version', '1.0.0')).toThrow(/version/);
  });

  it('computes the streamed sha256 of a file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'update-cask-'));
    const file = join(dir, 'blob.bin');
    const bytes = Buffer.from('hello coresense');
    await writeFile(file, bytes);

    const expected = createHash('sha256').update(bytes).digest('hex');
    expect(await sha256(file)).toBe(expected);
  });
});
