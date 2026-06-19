# CI Build & Release Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A GitHub Actions workflow that tests and builds CoreSense for Windows, macOS, and Linux, stores nightly builds as artifacts, and cuts a draft GitHub release (with signed, auto-update-compatible assets) on version tags.

**Architecture:** One new workflow `build.yml` with a `test` gate job feeding a 3-OS `build` matrix (each runs `electron-forge make` and uploads `out/make/**` as artifacts), plus a tag-gated `release` job that collects all artifacts into one draft GitHub release. macOS is signed+notarized via the existing forge env hooks; Windows is signed via Azure Trusted Signing through a rewritten `scripts/windows-sign.cjs`. The existing `ci.yml` is trimmed so it no longer double-runs on `main`.

**Tech Stack:** GitHub Actions, Electron Forge 7.11, pnpm (via `pnpm/action-setup@v4`), Node 24.15.0, Azure Trusted Signing (`Microsoft.Trusted.Signing.Client` + `signtool`), Apple `codesign`/notarytool, vitest (for the signing-hook unit test), actionlint (workflow validation).

## Global Constraints

These apply to every task; copied verbatim from the spec:

- **Node 24.15.0** everywhere (build and test).
- **pnpm v11** via `pnpm/action-setup@v4`; install with `pnpm install --frozen-lockfile`.
- Build tooling is **Electron Forge** (`pnpm make` / `make:mac` / `make:win`), not electron-builder. Never call electron-builder.
- macOS build is **universal** (x64+arm64), Windows is **x64**, Linux is **x64**.
- Linux runner needs `libudev-dev` (for `@stoprocent/noble`) plus `rpm` and `fakeroot` (for `MakerRpm`/`MakerDeb`).
- Code signing is **opt-in via env**, already wired in `forge.config.ts`. macOS reads `APPLE_SIGNING_IDENTITY`, `APPLE_API_KEY` (a file path), `APPLE_API_KEY_ID`, `APPLE_API_ISSUER`. Windows is enabled by `WINDOWS_SIGN=1` and the `scripts/windows-sign.cjs` hook.
- Upload **all** of `out/make/**` (do not cherry-pick) so the auto-update file set — Windows `RELEASES` + `*.nupkg` + `*Setup.exe`, macOS `*.zip` + `*.dmg`, Linux `.deb`/`.rpm` — is complete.
- Releases are created as **drafts** (`draft: true`); the maintainer publishes manually.
- Checkout build jobs with **`lfs: true`** so `resources/tiles/*.pmtiles` ship in release builds.
- Every workflow file must pass `actionlint` with **no errors** before commit.

## File Structure

- **Create** `.github/workflows/build.yml` — test gate, 3-OS build matrix, tag-gated draft release.
- **Create** `tests/unit/scripts/windows-sign.test.ts` — unit test for the signing hook (mocks `node:child_process`).
- **Rewrite** `scripts/windows-sign.cjs` — Azure Trusted Signing dlib instead of Certum SimplySign smart card.
- **Modify** `.github/workflows/ci.yml` — stop running on pushes to `main` (dedupe with `build.yml`'s gate).

---

### Task 1: Rewrite the Windows signing hook for Azure Trusted Signing

**Files:**
- Create: `tests/unit/scripts/windows-sign.test.ts`
- Modify (rewrite): `scripts/windows-sign.cjs`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: `scripts/windows-sign.cjs` exporting `async function windowsSign(fileToSign: string): Promise<void>`. It reads `AZURE_TRUSTED_SIGNING_DLIB`, `AZURE_TRUSTED_SIGNING_METADATA`, optional `SIGNTOOL_PATH` (default `signtool.exe`), and optional `CODESIGN_TIMESTAMP_URL` (default `http://timestamp.acs.microsoft.com`) **inside the function** (so tests can vary env per call). Throws if dlib or metadata env is unset. Task 3's Windows job sets these env vars.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/scripts/windows-sign.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The hook calls execFileSync from node:child_process; mock it so no real
// signtool is invoked. vi.hoisted lets the mock factory reference the spy.
const { execFileSync } = vi.hoisted(() => ({ execFileSync: vi.fn() }));
vi.mock('node:child_process', () => ({ execFileSync }));

// windows-sign.cjs is a CommonJS module exporting a single async function.
const loadSign = async () => {
  const mod = await import('../../../scripts/windows-sign.cjs');
  return (mod.default ?? mod) as (file: string) => Promise<void>;
};

const ENV_KEYS = [
  'AZURE_TRUSTED_SIGNING_DLIB',
  'AZURE_TRUSTED_SIGNING_METADATA',
  'SIGNTOOL_PATH',
  'CODESIGN_TIMESTAMP_URL',
];

describe('windows-sign hook', () => {
  const original: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of ENV_KEYS) {
      original[k] = process.env[k];
      delete process.env[k];
    }
    execFileSync.mockReset();
  });

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (original[k] === undefined) delete process.env[k];
      else process.env[k] = original[k];
    }
  });

  it('throws when AZURE_TRUSTED_SIGNING_DLIB is unset', async () => {
    process.env.AZURE_TRUSTED_SIGNING_METADATA = '/tmp/metadata.json';
    const sign = await loadSign();
    await expect(sign('C:/app/foo.exe')).rejects.toThrow(/AZURE_TRUSTED_SIGNING_DLIB/);
    expect(execFileSync).not.toHaveBeenCalled();
  });

  it('throws when AZURE_TRUSTED_SIGNING_METADATA is unset', async () => {
    process.env.AZURE_TRUSTED_SIGNING_DLIB = '/tmp/dlib.dll';
    const sign = await loadSign();
    await expect(sign('C:/app/foo.exe')).rejects.toThrow(/AZURE_TRUSTED_SIGNING_METADATA/);
    expect(execFileSync).not.toHaveBeenCalled();
  });

  it('invokes signtool with the dlib, metadata, and file using defaults', async () => {
    process.env.AZURE_TRUSTED_SIGNING_DLIB = '/tmp/dlib.dll';
    process.env.AZURE_TRUSTED_SIGNING_METADATA = '/tmp/metadata.json';
    const sign = await loadSign();
    await sign('C:/app/foo.exe');
    expect(execFileSync).toHaveBeenCalledTimes(1);
    const [tool, args] = execFileSync.mock.calls[0];
    expect(tool).toBe('signtool.exe');
    expect(args).toEqual([
      'sign',
      '/v',
      '/fd', 'sha256',
      '/tr', 'http://timestamp.acs.microsoft.com',
      '/td', 'sha256',
      '/dlib', '/tmp/dlib.dll',
      '/dmdf', '/tmp/metadata.json',
      '/d', 'CoreSense',
      'C:/app/foo.exe',
    ]);
  });

  it('honors SIGNTOOL_PATH and CODESIGN_TIMESTAMP_URL overrides', async () => {
    process.env.AZURE_TRUSTED_SIGNING_DLIB = '/tmp/dlib.dll';
    process.env.AZURE_TRUSTED_SIGNING_METADATA = '/tmp/metadata.json';
    process.env.SIGNTOOL_PATH = 'C:/sdk/signtool.exe';
    process.env.CODESIGN_TIMESTAMP_URL = 'http://ts.example/';
    const sign = await loadSign();
    await sign('C:/app/foo.exe');
    const [tool, args] = execFileSync.mock.calls[0];
    expect(tool).toBe('C:/sdk/signtool.exe');
    expect(args).toContain('http://ts.example/');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run tests/unit/scripts/windows-sign.test.ts`
Expected: FAIL — the current `windows-sign.cjs` throws about `CODESIGN_THUMBPRINT`, so the message-regex and the default-invocation assertions do not match.

- [ ] **Step 3: Rewrite the hook**

Replace the entire contents of `scripts/windows-sign.cjs` with:

```js
// Windows code-signing hook for @electron/windows-sign, wired in via
// forge.config.ts -> packagerConfig.windowsSign.hookModulePath (only when
// WINDOWS_SIGN=1). Electron Forge calls this once per binary that needs a
// signature: every packaged .exe/.dll/.node, then MakerSquirrel's Setup.exe.
// The hook signs the file IN PLACE and must throw on failure.
//
// This targets Azure Trusted Signing (cloud, CI-friendly — no smart card, no
// GUI). signtool loads the Trusted Signing dlib, which authenticates to Azure
// via the standard env vars (AZURE_TENANT_ID / AZURE_CLIENT_ID /
// AZURE_CLIENT_SECRET) picked up by DefaultAzureCredential, and signs using the
// account + certificate profile described in the metadata JSON. The CI job
// installs the dlib, writes the metadata file, and exports:
//   AZURE_TRUSTED_SIGNING_DLIB     - path to Azure.CodeSigning.Dlib.dll
//   AZURE_TRUSTED_SIGNING_METADATA - path to metadata.json
//   SIGNTOOL_PATH (optional)       - full path to a recent signtool.exe
//   CODESIGN_TIMESTAMP_URL (opt.)  - RFC-3161 timestamp server
// Env is read inside the function so a single hook instance honours per-call env.

const { execFileSync } = require('node:child_process');

module.exports = async function windowsSign(fileToSign) {
  const dlib = process.env.AZURE_TRUSTED_SIGNING_DLIB;
  const metadata = process.env.AZURE_TRUSTED_SIGNING_METADATA;
  const signtool = process.env.SIGNTOOL_PATH || 'signtool.exe';
  const timestampUrl = process.env.CODESIGN_TIMESTAMP_URL || 'http://timestamp.acs.microsoft.com';

  if (!dlib) {
    throw new Error(`AZURE_TRUSTED_SIGNING_DLIB is not set — cannot sign ${fileToSign}`);
  }
  if (!metadata) {
    throw new Error(`AZURE_TRUSTED_SIGNING_METADATA is not set — cannot sign ${fileToSign}`);
  }

  execFileSync(
    signtool,
    [
      'sign',
      '/v',
      '/fd',
      'sha256', // file digest algorithm
      '/tr',
      timestampUrl, // RFC-3161 timestamp server (survives cert expiry)
      '/td',
      'sha256', // timestamp digest algorithm
      '/dlib',
      dlib, // Trusted Signing dlib that performs the cloud sign
      '/dmdf',
      metadata, // JSON: Endpoint, CodeSigningAccountName, CertificateProfileName
      '/d',
      'CoreSense', // description shown in the Windows UAC prompt
      fileToSign,
    ],
    { stdio: 'inherit' },
  );
};
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm exec vitest run tests/unit/scripts/windows-sign.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Confirm lint/format is clean for the touched files**

Run: `pnpm exec biome check scripts/windows-sign.cjs tests/unit/scripts/windows-sign.test.ts`
Expected: no errors. (If Biome reports formatting, run `pnpm exec biome format --write` on the two files and re-run.)

- [ ] **Step 6: Commit**

```bash
git add scripts/windows-sign.cjs tests/unit/scripts/windows-sign.test.ts
git commit -m "feat(sign): switch Windows signing hook to Azure Trusted Signing"
```

---

### Task 2: Scaffold build.yml — test gate + unsigned 3-OS build matrix

**Files:**
- Create: `.github/workflows/build.yml`

**Interfaces:**
- Consumes: nothing.
- Produces: a `Build` workflow with jobs `test` and `build`. The `build` job is an OS matrix with `matrix.platform` ∈ {`darwin`, `win32`, `linux`} and `matrix.make` (the make command). Task 3 inserts signing steps into `build`; Task 4 adds a `release` job that consumes the `coresense-<platform>` artifacts uploaded here.

This task produces a fully working **unsigned** workflow: nightly artifacts on `main`/manual already function end to end. Signing and releases are layered on in Tasks 3–4.

- [ ] **Step 1: Create the workflow file**

Create `.github/workflows/build.yml`:

```yaml
name: Build

on:
  push:
    branches: [main] # nightly → artifacts only
    tags: ['v*.*.*'] # release → draft GitHub release (Task 4)
  workflow_dispatch: # manual

permissions:
  contents: write # create releases / upload assets

concurrency:
  group: build-${{ github.ref }}
  # never cancel an in-flight tag/release build; do cancel superseded main builds
  cancel-in-progress: ${{ !startsWith(github.ref, 'refs/tags/') }}

env:
  NODE_VERSION: '24.15.0'
  PNPM_VERSION: '11'

jobs:
  test:
    name: Test
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Install native build deps
        run: sudo apt-get update && sudo apt-get install -y libudev-dev
      - uses: pnpm/action-setup@v4
        with:
          version: ${{ env.PNPM_VERSION }}
      - uses: actions/setup-node@v4
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm typecheck
      - run: pnpm lint
      - run: pnpm test:unit
      - run: pnpm test:integration

  build:
    name: Build (${{ matrix.platform }})
    needs: test
    runs-on: ${{ matrix.os }}
    strategy:
      fail-fast: false
      matrix:
        include:
          - os: macos-latest
            platform: darwin
            make: pnpm make:mac
          - os: windows-latest
            platform: win32
            make: pnpm make:win
          - os: ubuntu-latest
            platform: linux
            make: pnpm make
    steps:
      - uses: actions/checkout@v4
        with:
          lfs: true
      - name: Install Linux build deps
        if: matrix.platform == 'linux'
        run: sudo apt-get update && sudo apt-get install -y libudev-dev rpm fakeroot
      - uses: pnpm/action-setup@v4
        with:
          version: ${{ env.PNPM_VERSION }}
      - uses: actions/setup-node@v4
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - name: Make
        run: ${{ matrix.make }}
      - name: Upload build artifacts
        uses: actions/upload-artifact@v4
        with:
          name: coresense-${{ matrix.platform }}
          path: out/make/**
          if-no-files-found: error
```

- [ ] **Step 2: Validate with actionlint**

Run: `actionlint .github/workflows/build.yml`
Expected: no output (exit 0 = no errors).

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/build.yml
git commit -m "ci: add build workflow with test gate and unsigned 3-OS matrix"
```

---

### Task 3: Add macOS + Windows code signing to the build job

**Files:**
- Modify: `.github/workflows/build.yml`

**Interfaces:**
- Consumes: `matrix.platform` from Task 2; the `scripts/windows-sign.cjs` hook from Task 1 (reads the `AZURE_TRUSTED_SIGNING_*` env exported here).
- Produces: a `build` job whose macOS run is signed+notarized and whose Windows run is signed via Azure Trusted Signing. No new interface for later tasks.

Replace the **entire `build:` job** in `.github/workflows/build.yml` with the version below (the `name`, `on`, `permissions`, `concurrency`, `env`, and `test` job are unchanged). The new steps: macOS keychain import + notary-key file (before `Make`), Windows Trusted Signing setup (before `Make`), and signing env on the `Make` step. Each signing step is guarded by `if: matrix.platform == ...` so it no-ops on the other OSes.

- [ ] **Step 1: Replace the build job**

```yaml
  build:
    name: Build (${{ matrix.platform }})
    needs: test
    runs-on: ${{ matrix.os }}
    strategy:
      fail-fast: false
      matrix:
        include:
          - os: macos-latest
            platform: darwin
            make: pnpm make:mac
          - os: windows-latest
            platform: win32
            make: pnpm make:win
          - os: ubuntu-latest
            platform: linux
            make: pnpm make
    steps:
      - uses: actions/checkout@v4
        with:
          lfs: true
      - name: Install Linux build deps
        if: matrix.platform == 'linux'
        run: sudo apt-get update && sudo apt-get install -y libudev-dev rpm fakeroot
      - uses: pnpm/action-setup@v4
        with:
          version: ${{ env.PNPM_VERSION }}
      - uses: actions/setup-node@v4
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: pnpm
      - run: pnpm install --frozen-lockfile

      # --- macOS: import Developer ID cert into an ephemeral keychain ---
      - name: Import macOS signing certificate
        if: matrix.platform == 'darwin'
        env:
          MACOS_CERTIFICATE: ${{ secrets.MACOS_CERTIFICATE }}
          MACOS_CERTIFICATE_PASSWORD: ${{ secrets.MACOS_CERTIFICATE_PASSWORD }}
        run: |
          set -euo pipefail
          KEYCHAIN_PATH="$RUNNER_TEMP/build.keychain-db"
          KEYCHAIN_PASSWORD="$(openssl rand -base64 24)"
          CERT_PATH="$RUNNER_TEMP/certificate.p12"
          echo "$MACOS_CERTIFICATE" | base64 --decode > "$CERT_PATH"
          security create-keychain -p "$KEYCHAIN_PASSWORD" "$KEYCHAIN_PATH"
          security set-keychain-settings -lut 21600 "$KEYCHAIN_PATH"
          security unlock-keychain -p "$KEYCHAIN_PASSWORD" "$KEYCHAIN_PATH"
          security import "$CERT_PATH" -P "$MACOS_CERTIFICATE_PASSWORD" \
            -A -t cert -f pkcs12 -k "$KEYCHAIN_PATH"
          security set-key-partition-list -S apple-tool:,apple:,codesign: \
            -s -k "$KEYCHAIN_PASSWORD" "$KEYCHAIN_PATH"
          security default-keychain -s "$KEYCHAIN_PATH"
          security list-keychains -d user -s "$KEYCHAIN_PATH"
          rm -f "$CERT_PATH"

      # --- macOS: write the notary API key (.p8) to a file forge can read ---
      - name: Write notary API key
        if: matrix.platform == 'darwin'
        env:
          APPLE_API_KEY: ${{ secrets.APPLE_API_KEY }}
        run: |
          set -euo pipefail
          KEY_PATH="$RUNNER_TEMP/AuthKey.p8"
          printf '%s' "$APPLE_API_KEY" > "$KEY_PATH"
          echo "APPLE_API_KEY=$KEY_PATH" >> "$GITHUB_ENV"

      # --- Windows: install Trusted Signing dlib + metadata, locate signtool ---
      - name: Set up Azure Trusted Signing
        if: matrix.platform == 'win32'
        shell: pwsh
        env:
          AZURE_CODE_SIGNING_ENDPOINT: ${{ secrets.AZURE_CODE_SIGNING_ENDPOINT }}
          AZURE_CODE_SIGNING_ACCOUNT: ${{ secrets.AZURE_CODE_SIGNING_ACCOUNT }}
          AZURE_CERT_PROFILE: ${{ secrets.AZURE_CERT_PROFILE }}
        run: |
          $ErrorActionPreference = 'Stop'
          # Trusted Signing client contains Azure.CodeSigning.Dlib.dll
          $client = "$env:RUNNER_TEMP\tsclient"
          nuget install Microsoft.Trusted.Signing.Client -Version 1.0.95 `
            -OutputDirectory $client -ExcludeVersion
          $dlib = Join-Path $client "Microsoft.Trusted.Signing.Client\bin\x64\Azure.CodeSigning.Dlib.dll"
          if (-not (Test-Path $dlib)) { throw "Trusted Signing dlib not found at $dlib" }
          # Metadata describing the signing account + certificate profile
          $metadata = "$env:RUNNER_TEMP\metadata.json"
          @{
            Endpoint = $env:AZURE_CODE_SIGNING_ENDPOINT
            CodeSigningAccountName = $env:AZURE_CODE_SIGNING_ACCOUNT
            CertificateProfileName = $env:AZURE_CERT_PROFILE
          } | ConvertTo-Json | Set-Content -Path $metadata -Encoding utf8
          # Newest signtool from the Windows SDK (>= 10.0.2261.755 required)
          $signtool = Get-ChildItem "C:\Program Files (x86)\Windows Kits\10\bin\*\x64\signtool.exe" |
            Sort-Object FullName -Descending | Select-Object -First 1 -ExpandProperty FullName
          if (-not $signtool) { throw "signtool.exe not found" }
          # Export for the forge windowsSign hook (scripts/windows-sign.cjs)
          "AZURE_TRUSTED_SIGNING_DLIB=$dlib"         | Out-File $env:GITHUB_ENV -Append
          "AZURE_TRUSTED_SIGNING_METADATA=$metadata" | Out-File $env:GITHUB_ENV -Append
          "SIGNTOOL_PATH=$signtool"                  | Out-File $env:GITHUB_ENV -Append
          "WINDOWS_SIGN=1"                           | Out-File $env:GITHUB_ENV -Append

      - name: Make
        env:
          # macOS signing + notarization (read by forge.config.ts)
          APPLE_SIGNING_IDENTITY: ${{ secrets.APPLE_SIGNING_IDENTITY }}
          APPLE_API_KEY_ID: ${{ secrets.APPLE_API_KEY_ID }}
          APPLE_API_ISSUER: ${{ secrets.APPLE_API_ISSUER }}
          # Windows Trusted Signing auth (read by the signtool dlib)
          AZURE_TENANT_ID: ${{ secrets.AZURE_TENANT_ID }}
          AZURE_CLIENT_ID: ${{ secrets.AZURE_CLIENT_ID }}
          AZURE_CLIENT_SECRET: ${{ secrets.AZURE_CLIENT_SECRET }}
        run: ${{ matrix.make }}

      - name: Upload build artifacts
        uses: actions/upload-artifact@v4
        with:
          name: coresense-${{ matrix.platform }}
          path: out/make/**
          if-no-files-found: error
```

(Note: `APPLE_API_KEY` is set as a job-level env var by the "Write notary API key" step via `$GITHUB_ENV`, so it is available to the `Make` step without being repeated in its `env:` block.)

- [ ] **Step 2: Validate with actionlint**

Run: `actionlint .github/workflows/build.yml`
Expected: no output (exit 0). actionlint runs shellcheck on the bash `run:` blocks — there should be no warnings. If shellcheck flags an unquoted expansion, quote it and re-run.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/build.yml
git commit -m "ci: sign macOS (notarize) and Windows (Trusted Signing) builds"
```

---

### Task 4: Add the tag-gated draft release job

**Files:**
- Modify: `.github/workflows/build.yml`

**Interfaces:**
- Consumes: the `coresense-<platform>` artifacts uploaded by the `build` job (Tasks 2–3).
- Produces: a draft GitHub release on `v*.*.*` tags with every maker output attached. Terminal — no later task depends on it.

- [ ] **Step 1: Append the release job**

Add this `release` job at the end of `.github/workflows/build.yml` (same indentation level as `test` and `build`, i.e. two spaces under `jobs:`):

```yaml
  release:
    name: Draft release
    needs: build
    if: startsWith(github.ref, 'refs/tags/')
    runs-on: ubuntu-latest
    steps:
      - name: Download all build artifacts
        uses: actions/download-artifact@v4
        with:
          path: dist-artifacts
      - name: Create draft release
        uses: softprops/action-gh-release@v2
        with:
          draft: true
          generate_release_notes: true
          # Every maker output across the three coresense-<platform> artifacts.
          # Includes the auto-update set (RELEASES, *.nupkg, *Setup.exe, *.zip).
          files: dist-artifacts/**/*
          fail_on_unmatched_files: true
```

- [ ] **Step 2: Validate with actionlint**

Run: `actionlint .github/workflows/build.yml`
Expected: no output (exit 0).

- [ ] **Step 3: Sanity-check the full workflow parses as expected**

Run: `actionlint -verbose .github/workflows/build.yml`
Expected: actionlint reports it parsed `build.yml` and found 3 jobs (`test`, `build`, `release`) with no errors.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/build.yml
git commit -m "ci: cut draft GitHub release with all assets on version tags"
```

---

### Task 5: Trim ci.yml so it no longer runs on main

**Files:**
- Modify: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: nothing.
- Produces: `ci.yml` running on pull requests and non-`main` branch pushes only. Pushes to `main` are now covered by `build.yml`'s `test` gate, removing the double test run.

- [ ] **Step 1: Change the triggers**

In `.github/workflows/ci.yml`, replace the `on:` block:

```yaml
on:
  push:
  pull_request:
```

with:

```yaml
on:
  push:
    branches-ignore: [main] # main is tested by build.yml's gate
  pull_request:
```

Leave the rest of `ci.yml` (the `checks` and `e2e` jobs) unchanged.

- [ ] **Step 2: Validate with actionlint**

Run: `actionlint .github/workflows/ci.yml`
Expected: no output (exit 0).

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: stop running ci.yml on main (covered by build.yml gate)"
```

---

## Required repository secrets (operator setup, outside this plan)

The workflow builds unsigned and skips the release-signing benefit until these exist; signing steps fail loudly if a secret is missing. Document for the maintainer:

**macOS:** `MACOS_CERTIFICATE` (base64 Developer ID Application `.p12`), `MACOS_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY`, `APPLE_API_KEY` (notary `.p8` contents), `APPLE_API_KEY_ID`, `APPLE_API_ISSUER`.

**Windows (Azure Trusted Signing):** `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET` (service principal with the *Trusted Signing Certificate Profile Signer* role), `AZURE_CODE_SIGNING_ENDPOINT`, `AZURE_CODE_SIGNING_ACCOUNT`, `AZURE_CERT_PROFILE`.

---

## Self-Review

**Spec coverage:**
- 3-OS native build → Task 2 (`build` matrix). ✓
- pnpm/action-setup + latest actions + Node 24.15.0 → Tasks 2–4 (checkout@v4, setup-node@v4, upload/download-artifact@v4, action-gh-release@v2). ✓
- Draft release on tag with assets → Task 4. ✓
- Nightly builds as artifacts on main → Task 2 (`upload-artifact`, no release on main). ✓
- Manual runs → Task 2 (`workflow_dispatch`). ✓
- Auto-update-compatible assets (upload all of `out/make`) → Tasks 2 & 4. ✓
- macOS signing/notarization → Task 3. ✓
- Windows signing via Azure Trusted Signing + hook rewrite → Tasks 1 & 3. ✓
- `lfs: true` for tiles → Tasks 2–3. ✓
- ci.yml dedupe → Task 5. ✓

**Placeholder scan:** No TBD/TODO; every code/YAML block is complete; the only "operator setup" deferral is secret *values*, which cannot live in the repo by design.

**Type/name consistency:** The hook env names (`AZURE_TRUSTED_SIGNING_DLIB`, `AZURE_TRUSTED_SIGNING_METADATA`, `SIGNTOOL_PATH`, `CODESIGN_TIMESTAMP_URL`) are identical between Task 1's hook, Task 1's test, and Task 3's Windows setup step. Artifact name `coresense-<platform>` matches between the upload (Tasks 2–3) and the download glob `dist-artifacts/**/*` (Task 4). `matrix.platform`/`matrix.make` keys are consistent across the matrix definition and step conditions.
