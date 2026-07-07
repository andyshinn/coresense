# Homebrew Tap & Two-Channel Casks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let macOS users `brew install --cask coresense` (latest stable) or `brew install --cask coresense@dev` (latest prerelease), with each cask auto-bumped by CI on the matching GitHub release event.

**Architecture:** Two in-repo Homebrew casks under `Casks/` sharing one zero-dependency Node updater (`scripts/update-cask.mjs`). A single workflow (`.github/workflows/homebrew-cask.yml`) fires on both `released` and `prereleased`, picks the target cask from the release's `prerelease` flag, downloads the published universal DMG, rewrites `version` + `sha256`, and commits to `main`. Both casks are seeded with real values from already-published releases so they work on merge.

**Tech Stack:** Homebrew Cask (Ruby), Node ESM (`node:crypto`/`node:util` — no deps), GitHub Actions, `gh` CLI, Vitest (unit), Biome.

**Reference implementation:** Beacon's setup at `/Users/andy/GitHub/andyshinn/beacon` — `Casks/beacon.rb`, `scripts/update-cask.mjs`, `.github/workflows/homebrew-cask.yml`. This plan ports that, converts it to single-quote Biome style, and adds the prerelease channel.

**Spec:** [`docs/superpowers/specs/2026-07-05-homebrew-tap-casks-design.md`](../specs/2026-07-05-homebrew-tap-casks-design.md)

## Global Constraints

Every task's requirements implicitly include these:

- **Tap command:** `brew tap andyshinn/coresense https://github.com/andyshinn/coresense` (in-repo tap — the URL is required once).
- **DMG artifact name:** `CoreSense-<version>-universal.dmg` (verified on v0.0.10 and v0.0.12-dev.0).
- **Cask tokens:** `coresense` (stable) and `coresense@dev` (prerelease). Files: `Casks/coresense.rb`, `Casks/coresense@dev.rb`.
- **App bundle:** `CoreSense.app`. **Bundle id (for `zap`):** `com.electron.coresense` (Electron Forge default — not customized).
- **`auto_updates`:** `true` on the stable cask only; **omitted** on `coresense@dev` (dev channel is notify-only, so `brew upgrade` manages it).
- **`livecheck` strategy:** `:github_latest` (stable), `:github_releases` (dev — includes prereleases).
- **macOS floor:** `depends_on macos: :big_sur`.
- **Release triggers:** stable bump on `released`; dev bump on `prereleased` (see [ci.yml:164-165](../../../.github/workflows/ci.yml#L164-L165) — tags with a `-` publish as prerelease, tags without a `-` create a draft).
- **Node version in CI workflow:** `'24'` (no `.nvmrc`; matches ci.yml `NODE_VERSION: '24.15.0'`).
- **Biome style** (applies to `scripts/update-cask.mjs` and the test — `.rb`/`.yml`/`.md` are ignored): single quotes, semicolons, trailing commas `all`, 2-space indent, line width 125.
- **Lint scoped to changed files:** run `pnpm exec biome check <paths>` (repo-wide `pnpm lint` can trip on pre-existing artifacts).
- **Git:** work on branch `feat/homebrew-tap-casks` (already created). Local commits work in-sandbox; `gh`/network steps need sandbox disabled.

---

### Task 1: `scripts/update-cask.mjs` updater + unit test

**Files:**
- Create: `scripts/update-cask.mjs`
- Test: `tests/unit/scripts/update-cask.test.ts`

**Interfaces:**
- Produces (named ESM exports, consumed by the test and — via CLI — by Task 3 & Task 4):
  - `replaceField(source: string, field: string, value: string): string` — replaces one anchored `<field> "..."` line; throws if absent.
  - `applyCaskUpdate(source: string, version: string, digest: string): string` — rewrites both `version` and `sha256`.
  - `sha256(path: string): Promise<string>` — streamed hex digest.
  - `DEFAULT_CASK: string` — absolute path to `Casks/coresense.rb`.
  - CLI: `node scripts/update-cask.mjs --version <v> --dmg <path> [--cask <path>]` (runs only when invoked directly).

- [ ] **Step 1: Write the failing test**

Create `tests/unit/scripts/update-cask.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test:unit -- update-cask`
Expected: FAIL — cannot resolve `../../../scripts/update-cask.mjs` (module does not exist yet).

- [ ] **Step 3: Write the updater**

Create `scripts/update-cask.mjs`:

```js
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test:unit -- update-cask`
Expected: PASS — 3 tests pass.

- [ ] **Step 5: Typecheck and lint the new files**

Run: `pnpm typecheck && pnpm exec biome check scripts/update-cask.mjs tests/unit/scripts/update-cask.test.ts`
Expected: no errors. If Biome reports formatting, run `pnpm exec biome check --write scripts/update-cask.mjs tests/unit/scripts/update-cask.test.ts` and re-run the check.

- [ ] **Step 6: Commit**

```bash
git add scripts/update-cask.mjs tests/unit/scripts/update-cask.test.ts
git commit -m "feat: add update-cask.mjs cask updater with tests"
```

---

### Task 2: The two cask files

**Files:**
- Create: `Casks/coresense.rb`
- Create: `Casks/coresense@dev.rb`

**Interfaces:**
- Consumes: nothing at build time. The `sha256` all-zeros placeholders are replaced with real values in Task 3; `version` values are already correct.

- [ ] **Step 1: Create the stable cask**

Create `Casks/coresense.rb`:

```ruby
# Homebrew cask for CoreSense (stable channel). `version` + `sha256` are
# auto-managed on each STABLE release by .github/workflows/homebrew-cask.yml
# (via scripts/update-cask.mjs); edit those two lines by hand only as a fallback.
# Install with:
#   brew tap andyshinn/coresense https://github.com/andyshinn/coresense
#   brew install --cask coresense
cask "coresense" do
  version "0.0.10"
  sha256 "0000000000000000000000000000000000000000000000000000000000000000"

  url "https://github.com/andyshinn/coresense/releases/download/v#{version}/CoreSense-#{version}-universal.dmg"
  name "CoreSense"
  desc "Experimental desktop MeshCore client"
  homepage "https://github.com/andyshinn/coresense"

  livecheck do
    url :url
    strategy :github_latest
  end

  auto_updates true
  conflicts_with cask: "coresense@dev"
  depends_on macos: :big_sur

  app "CoreSense.app"

  zap trash: [
    "~/Library/Application Support/CoreSense",
    "~/Library/Caches/com.electron.coresense",
    "~/Library/Caches/com.electron.coresense.ShipIt",
    "~/Library/Preferences/com.electron.coresense.plist",
    "~/Library/Saved Application State/com.electron.coresense.savedState",
  ]
end
```

- [ ] **Step 2: Create the development cask**

Create `Casks/coresense@dev.rb` (differs only in: comment, token, version, desc, `livecheck` strategy, no `auto_updates`, and the `conflicts_with` target):

```ruby
# Homebrew cask for CoreSense (development / prerelease channel). `version` +
# `sha256` are auto-managed on each PRERELEASE by
# .github/workflows/homebrew-cask.yml (via scripts/update-cask.mjs); edit those
# two lines by hand only as a fallback. Install with:
#   brew tap andyshinn/coresense https://github.com/andyshinn/coresense
#   brew install --cask coresense@dev
cask "coresense@dev" do
  version "0.0.12-dev.0"
  sha256 "0000000000000000000000000000000000000000000000000000000000000000"

  url "https://github.com/andyshinn/coresense/releases/download/v#{version}/CoreSense-#{version}-universal.dmg"
  name "CoreSense"
  desc "Experimental desktop MeshCore client (development builds)"
  homepage "https://github.com/andyshinn/coresense"

  livecheck do
    url :url
    strategy :github_releases
  end

  conflicts_with cask: "coresense"
  depends_on macos: :big_sur

  app "CoreSense.app"

  zap trash: [
    "~/Library/Application Support/CoreSense",
    "~/Library/Caches/com.electron.coresense",
    "~/Library/Caches/com.electron.coresense.ShipIt",
    "~/Library/Preferences/com.electron.coresense.plist",
    "~/Library/Saved Application State/com.electron.coresense.savedState",
  ]
end
```

- [ ] **Step 3: Lint the casks (offline style)**

Run: `brew style --cask Casks/coresense.rb Casks/coresense@dev.rb`
Expected: no offences. (Style does not validate the placeholder sha256 — that is checked in Task 3.)

Fallbacks:
- If `brew` reports an offence about `conflicts_with cask:` referencing an `@`-token, remove the `conflicts_with` line from **both** casks (the natural "an App already exists at …" conflict still prevents both being installed) and re-run.
- If `brew` is not installed, at minimum verify Ruby syntax: `ruby -c Casks/coresense.rb && ruby -c Casks/coresense@dev.rb` (expect `Syntax OK` twice).

- [ ] **Step 4: Commit**

```bash
git add Casks/coresense.rb Casks/coresense@dev.rb
git commit -m "feat: add coresense + coresense@dev homebrew casks"
```

---

### Task 3: Seed real sha256 values from published releases

**Files:**
- Modify: `Casks/coresense.rb` (sha256 line only)
- Modify: `Casks/coresense@dev.rb` (sha256 line only)

**Interfaces:**
- Consumes: the CLI of `scripts/update-cask.mjs` (Task 1); the cask files (Task 2).

> **Network required.** `gh release download` needs internet — disable the sandbox for the `gh` steps if running sandboxed. If the current latest stable / prerelease differ from `v0.0.10` / `v0.0.12-dev.0`, run `gh release list --repo andyshinn/coresense` first and substitute the newest of each channel (update the `version` line in the cask too if you change versions).

- [ ] **Step 1: Download both published DMGs to a scratch dir**

```bash
SEED_DIR="$(mktemp -d)"
gh release download v0.0.10       --repo andyshinn/coresense --pattern 'CoreSense-*-universal.dmg' --dir "$SEED_DIR"
gh release download v0.0.12-dev.0 --repo andyshinn/coresense --pattern 'CoreSense-*-universal.dmg' --dir "$SEED_DIR"
ls "$SEED_DIR"
```
Expected: `CoreSense-0.0.10-universal.dmg` and `CoreSense-0.0.12-dev.0-universal.dmg` present.

- [ ] **Step 2: Rewrite the sha256 (and confirm the version) in each cask**

```bash
node scripts/update-cask.mjs --version 0.0.10 \
  --dmg "$SEED_DIR/CoreSense-0.0.10-universal.dmg"
node scripts/update-cask.mjs --version 0.0.12-dev.0 \
  --dmg "$SEED_DIR/CoreSense-0.0.12-dev.0-universal.dmg" --cask Casks/coresense@dev.rb
```
Expected: two `update-cask: set version … sha256 …` log lines.

- [ ] **Step 3: Verify only the sha256 lines changed**

Run: `git diff --stat Casks/ && git diff Casks/`
Expected: exactly one changed line per file — the `sha256 "…"` line goes from all-zeros to a real 64-hex digest. The `version` lines are unchanged (already correct from Task 2).

- [ ] **Step 4: Verify the digest matches the DMG (independent check)**

```bash
shasum -a 256 "$SEED_DIR/CoreSense-0.0.10-universal.dmg"
grep sha256 Casks/coresense.rb
shasum -a 256 "$SEED_DIR/CoreSense-0.0.12-dev.0-universal.dmg"
grep sha256 Casks/coresense@dev.rb
```
Expected: the hex from `shasum` matches the `sha256` in the corresponding cask.

Optional end-to-end (installs the app; requires `brew`): `brew install --cask ./Casks/coresense.rb` — Homebrew downloads from the cask `url` and verifies the sha256; then `brew uninstall --cask coresense`. A sha mismatch aborts the install.

- [ ] **Step 5: Commit**

```bash
git add Casks/coresense.rb Casks/coresense@dev.rb
git commit -m "chore: seed homebrew casks with real release sha256"
```

---

### Task 4: `homebrew-cask.yml` auto-bump workflow

**Files:**
- Create: `.github/workflows/homebrew-cask.yml`

**Interfaces:**
- Consumes: `scripts/update-cask.mjs` CLI (Task 1); the cask files (Task 2/3).

- [ ] **Step 1: Create the workflow**

Create `.github/workflows/homebrew-cask.yml`:

```yaml
name: Homebrew cask

# Keep Casks/coresense.rb and Casks/coresense@dev.rb (version + sha256) in sync
# with releases. `released` fires only for STABLE, published releases (and
# prerelease->release promotions); `prereleased` fires for PRERELEASE publishes.
# Both are post-publish, so the download URL resolves and the sha256 matches the
# final bytes — no draft-release race.
on:
  release:
    types: [released, prereleased]

permissions:
  contents: write

concurrency:
  group: homebrew-cask
  cancel-in-progress: false

jobs:
  bump:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
        with:
          ref: main # commit the bump onto the branch head, not the tagged commit

      - uses: actions/setup-node@v6
        with:
          node-version: '24'

      - name: Select target cask
        env:
          PRERELEASE: ${{ github.event.release.prerelease }}
        run: |
          if [ "$PRERELEASE" = "true" ]; then
            echo "CASK=Casks/coresense@dev.rb" >> "$GITHUB_ENV"
          else
            echo "CASK=Casks/coresense.rb" >> "$GITHUB_ENV"
          fi

      - name: Download release DMG
        env:
          GH_TOKEN: ${{ github.token }}
          TAG: ${{ github.event.release.tag_name }}
        run: gh release download "$TAG" --repo "$GITHUB_REPOSITORY" --pattern 'CoreSense-*-universal.dmg' --dir dist

      - name: Update cask
        env:
          TAG: ${{ github.event.release.tag_name }}
        run: |
          shopt -s nullglob
          dmgs=(dist/CoreSense-*-universal.dmg)
          if [ ${#dmgs[@]} -eq 0 ]; then echo "No universal DMG found in release $TAG"; exit 1; fi
          node scripts/update-cask.mjs --version "${TAG#v}" --dmg "${dmgs[0]}" --cask "$CASK"

      - name: Commit cask bump
        env:
          TAG: ${{ github.event.release.tag_name }}
        run: |
          if git diff --quiet -- "$CASK"; then
            echo "Cask already up to date for $TAG; nothing to commit."
            exit 0
          fi
          git config user.name "github-actions[bot]"
          git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
          git add "$CASK"
          git commit -m "chore: bump homebrew cask to ${TAG} [skip ci]"
          git push origin HEAD:main
```

- [ ] **Step 2: Validate the workflow YAML**

Run: `actionlint .github/workflows/homebrew-cask.yml` (if installed).
Expected: no errors. If `actionlint` is not installed, validate parse only: `pnpm exec js-yaml .github/workflows/homebrew-cask.yml >/dev/null 2>&1 || python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/homebrew-cask.yml'))"` — expect no output/error.

- [ ] **Step 3: Verify the cask-selection logic locally**

Run:
```bash
for pre in true false; do
  if [ "$pre" = "true" ]; then CASK=Casks/coresense@dev.rb; else CASK=Casks/coresense.rb; fi
  echo "prerelease=$pre -> $CASK"
done
```
Expected:
```
prerelease=true -> Casks/coresense@dev.rb
prerelease=false -> Casks/coresense.rb
```

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/homebrew-cask.yml
git commit -m "ci: auto-bump homebrew casks on release (stable + prerelease)"
```

---

### Task 5: Docs — README install section + RELEASING.md

**Files:**
- Modify: `README.md`
- Create: `RELEASING.md`

- [ ] **Step 1: Add the Install section to README**

In `README.md`, insert a new `## Install` section immediately before `## Features`. Replace:

```markdown
## Features

We aim to have feature parity with the mobile applications.
```

with:

```markdown
## Install

### macOS (Homebrew)

CoreSense ships two Homebrew casks — a **stable** channel and a **development**
(prerelease) channel:

```sh
brew tap andyshinn/coresense https://github.com/andyshinn/coresense
brew install --cask coresense        # latest stable release
brew install --cask coresense@dev    # latest development (prerelease) build
```

Upgrade later with `brew upgrade --cask coresense` (or `coresense@dev`). The
explicit tap URL is needed once because the casks live in this repo rather than a
separate `homebrew-coresense` tap. Stable builds self-update in-app; development
builds are upgraded through Homebrew.

## Features

We aim to have feature parity with the mobile applications.
```

- [ ] **Step 2: Create RELEASING.md**

Create `RELEASING.md`:

```markdown
# Releasing

CoreSense is built and released by [`ci.yml`](.github/workflows/ci.yml) on
`v*.*.*` tags:

- A tag **without** a `-` (e.g. `v0.1.0`) → a **draft** stable release. Publish
  it in the GitHub UI to make it live.
- A tag **with** a `-` (e.g. `v0.1.0-dev.0`) → a **published prerelease**.

## Homebrew casks

The two casks in [`Casks/`](Casks/) auto-bump on publish via
[`.github/workflows/homebrew-cask.yml`](.github/workflows/homebrew-cask.yml):

| Release event | Trigger | Cask updated |
|---|---|---|
| Stable published (or prerelease promoted to release) | `released` | `Casks/coresense.rb` |
| Prerelease published | `prereleased` | `Casks/coresense@dev.rb` |

The workflow downloads the published `CoreSense-<version>-universal.dmg`,
recomputes `version` + `sha256` with
[`scripts/update-cask.mjs`](scripts/update-cask.mjs), and commits the change to
`main` with `[skip ci]`.

### Bumping a cask by hand

```sh
gh release download v0.1.0 --repo andyshinn/coresense \
  --pattern 'CoreSense-*-universal.dmg' --dir /tmp/dmg
# stable (default cask):
node scripts/update-cask.mjs --version 0.1.0 --dmg /tmp/dmg/CoreSense-0.1.0-universal.dmg
# development cask: add --cask Casks/coresense@dev.rb
```
```

- [ ] **Step 3: Verify the docs**

Run: `grep -n "brew install --cask coresense@dev" README.md RELEASING.md`
Expected: matches in both files. Eyeball that the README fenced code block for the install commands is intact (the triple-backtick ` ```sh ` block closes before `## Features`).

- [ ] **Step 4: Commit**

```bash
git add README.md RELEASING.md
git commit -m "docs: document homebrew install and cask release flow"
```

---

## Final verification

- [ ] `pnpm test:unit -- update-cask` passes.
- [ ] `pnpm typecheck` passes.
- [ ] `pnpm exec biome check scripts/update-cask.mjs tests/unit/scripts/update-cask.test.ts` is clean.
- [ ] `brew style --cask Casks/coresense.rb Casks/coresense@dev.rb` is clean (or `conflicts_with` dropped per Task 2 fallback).
- [ ] Both casks contain a real (non-zero) `sha256` matching their DMG.
- [ ] `git log --oneline` shows the task commits on `feat/homebrew-tap-casks`.
- [ ] Optional smoke: `brew install --cask ./Casks/coresense.rb` then `brew uninstall --cask coresense` succeeds.

## Self-Review (completed while writing)

- **Spec coverage:** §3 casks → Task 2; §4 script → Task 1; §5 seeding → Task 3; §6 workflow → Task 4; §7 docs → Task 5; §1/§2 install UX + decisions → distributed across all tasks + README. No gaps.
- **Placeholder scan:** the only `0000…` values are the sha256 seeds intentionally replaced in Task 3; no TODO/TBD.
- **Type/name consistency:** `applyCaskUpdate`/`replaceField`/`sha256`/`DEFAULT_CASK` are defined in Task 1 and used identically by the test and the Task 3/4 CLI; the `$CASK` env var is set once (Task 4 Step 1) and reused by later steps; cask tokens (`coresense`, `coresense@dev`), DMG glob (`CoreSense-*-universal.dmg`), and bundle id (`com.electron.coresense`) are identical everywhere.
