# CI build & release workflow — design

**Date:** 2026-06-19
**Status:** Approved (brainstorming)

## Goal

A GitHub Actions workflow that **tests and builds** CoreSense for **Windows, macOS,
and Linux** on native runners, then:

- on a version **tag** (`v*.*.*`), creates a **draft GitHub release** with every
  built asset attached (the maintainer reviews and publishes manually);
- on a push to **`main`**, stores the builds as **workflow artifacts** (nightly)
  so they can be grabbed from the run later — no release is cut;
- can be run **manually** via `workflow_dispatch`.

The produced assets must be compatible with Electron auto-updates via
`update-electron-app` / `update.electronjs.org`, which the app will adopt later.

## Context / constraints

- Build tooling is **Electron Forge** (`@electron-forge/*` 7.11.2), **not**
  electron-builder. Makers already configured in `forge.config.ts`:
  `MakerSquirrel` (Windows), `MakerZIP` (darwin + win32), `MakerDMG` (macOS),
  `MakerRpm` + `MakerDeb` (Linux).
- `@electron-forge/publisher-github` is configured with `draft: true`, but the
  release path here uses the **collect-and-release** strategy (below) instead of
  per-platform `electron-forge publish`, to avoid release-creation races and to
  reuse the same artifacts for nightly.
- Package manager is **pnpm** (lockfile + `pnpm-workspace.yaml`). Use
  `pnpm/action-setup@v4` (pnpm v11).
- **Node 24.15.0** everywhere (matches the existing `ci.yml`; build and test
  environments stay aligned).
- Native dep `@stoprocent/noble` needs `libudev-dev` on Linux. `MakerRpm` needs
  `rpm` (+ `fakeroot`) on the Ubuntu runner; `MakerDeb` uses `dpkg`/`fakeroot`.
- macOS build is **universal** (x64 + arm64), Windows is **x64**, Linux is x64.
- Code signing is **opt-in via env** in `forge.config.ts`: macOS notarization
  (App Store Connect API key) and Windows signtool (`WINDOWS_SIGN=1`). Both are
  wired up in this workflow.
- `update.electronjs.org` only serves **published** releases (drafts are
  invisible), which fits the draft-then-publish flow. Electron auto-update does
  not support Linux (expected — Linux ships `.deb`/`.rpm` for manual install).

## Files changed

1. **`.github/workflows/build.yml`** (new) — test gate → 3-OS build → tag release.
2. **`scripts/windows-sign.cjs`** (rewrite) — swap the Certum SimplySign
   smart-card body (interactive GUI, cannot run headless) for the **Azure Trusted
   Signing dlib** path the file already documents.
3. **`.github/workflows/ci.yml`** (trigger trim) — stop running on pushes to
   `main` so tests don't run twice on `main` (build.yml's gate covers it); keep
   running on pull requests and non-`main` branch pushes.

## `build.yml` design

### Top-level

```yaml
name: Build

on:
  push:
    branches: [main]      # nightly → artifacts only
    tags: ['v*.*.*']      # release → draft GitHub release
  workflow_dispatch:       # manual

permissions:
  contents: write          # create releases / upload assets

concurrency:
  group: build-${{ github.ref }}
  # never cancel an in-flight tag/release build; do cancel superseded main builds
  cancel-in-progress: ${{ !startsWith(github.ref, 'refs/tags/') }}
```

### Job: `test` (gate)

Runs on `ubuntu-latest`. Mirrors `ci.yml`'s fast checks so a release is never
cut from red code. The build jobs declare `needs: test`.

Steps: checkout → `apt-get install -y libudev-dev` → `pnpm/action-setup@v4`
(version 11) → `actions/setup-node@v4` (node-version `24.15.0`, `cache: pnpm`) →
`pnpm install --frozen-lockfile` → `pnpm typecheck` → `pnpm lint` →
`pnpm test:unit` → `pnpm test:integration`.

(E2E + coverage stay in `ci.yml` for pull-request feedback; not duplicated here.)

### Job: `build` (matrix, `needs: test`)

| platform | runner | make command | runner-specific setup |
|----------|--------|--------------|-----------------------|
| `darwin` (universal) | `macos-latest` | `pnpm make:mac` | import Developer ID cert into ephemeral keychain; write notary `.p8` to temp file |
| `win32` (x64) | `windows-latest` | `pnpm make:win` | install Trusted Signing client; locate recent `signtool.exe`; write `metadata.json`; export signing env |
| `linux` (x64) | `ubuntu-latest` | `pnpm make` | `apt-get install -y libudev-dev rpm fakeroot` |

Common steps: `actions/checkout@v4` **with `lfs: true`** (so release builds bundle
`resources/tiles/*.pmtiles` rather than the empty-state) → `pnpm/action-setup@v4`
(v11) → `actions/setup-node@v4` (`24.15.0`, `cache: pnpm`) →
`pnpm install --frozen-lockfile` → platform setup (above) → make → upload.

Upload: `actions/upload-artifact@v4` with `name: coresense-<platform>` and
`path: out/make/**`. **This is the nightly deliverable** — on a `main` push the
workflow ends here and the artifacts are downloadable from the run.

### Job: `release` (tags only, `needs: build`)

Runs on `ubuntu-latest`, guarded by `if: startsWith(github.ref, 'refs/tags/')`.

Steps: `actions/download-artifact@v4` (all artifacts into one directory) →
`softprops/action-gh-release@v2` with:

- `draft: true`
- `generate_release_notes: true`
- `files:` every maker output from the downloaded artifacts (glob across
  `coresense-*/**`)
- tag/name derived from `github.ref`

Uses the built-in `GITHUB_TOKEN` (`contents: write`).

## Code signing

### macOS (App Store Connect API key + Developer ID cert)

Fully scriptable on `macos-latest`:

1. Create an ephemeral keychain, import the Developer ID Application cert from a
   base64 `.p12` secret, unlock it, and allow `codesign` access.
2. Write the notary API key `.p8` contents to a temp file; export
   `APPLE_API_KEY` as that **file path** (forge passes it to `@electron/notarize`,
   which expects a path).
3. Run `pnpm make:mac`; the existing `forge.config.ts` hooks pick up the env and
   sign + notarize the universal app.

Secrets:

| secret | meaning |
|--------|---------|
| `MACOS_CERTIFICATE` | base64-encoded Developer ID Application `.p12` |
| `MACOS_CERTIFICATE_PASSWORD` | password for the `.p12` |
| `APPLE_SIGNING_IDENTITY` | e.g. `Developer ID Application: Name (TEAMID)` |
| `APPLE_API_KEY` | contents of the notary `.p8` (written to a file in-job) |
| `APPLE_API_KEY_ID` | App Store Connect API key ID |
| `APPLE_API_ISSUER` | App Store Connect issuer ID |

A throwaway keychain password is generated in-job (no secret needed).

### Windows (Azure Trusted Signing)

The current `scripts/windows-sign.cjs` targets a Certum cert via SimplySign
Desktop (a virtual smart card needing an interactive GUI) — it **cannot run on a
hosted runner**. Rewrite it to the Trusted Signing dlib path already documented
at the bottom of the file. Electron Forge calls the hook **per binary** (every
packaged `.exe`/`.dll`/`.node`, then the Squirrel `Setup.exe`), so inner binaries
and the app `.exe` inside `.nupkg` update packages are all signed — this is why
the per-file hook is used rather than the folder-based `trusted-signing-action`,
which would only sign the outer installer.

Workflow setup on `windows-latest`:

1. Install `Microsoft.Trusted.Signing.Client` (NuGet, pinned version); resolve the
   `Azure.CodeSigning.Dlib.dll` path.
2. Locate a `signtool.exe` ≥ `10.0.2261.755` (from the Windows SDK BuildTools);
   older signtool fails silently with the dlib.
3. Write `metadata.json` (`Endpoint`, `CodeSigningAccountName`,
   `CertificateProfileName`) from secrets/vars.
4. Export `AZURE_TRUSTED_SIGNING_DLIB`, `AZURE_TRUSTED_SIGNING_METADATA`,
   `SIGNTOOL_PATH`, `WINDOWS_SIGN=1`, and the Azure auth env.
5. Run `pnpm make:win`; the rewritten hook runs
   `signtool sign /fd sha256 /tr <timestamp> /td sha256 /dlib <dll> /dmdf metadata.json <file>`
   per binary.

`windows-sign.cjs` rewrite: read `AZURE_TRUSTED_SIGNING_DLIB` and
`AZURE_TRUSTED_SIGNING_METADATA`; throw if unset; keep the optional `SIGNTOOL_PATH`
and timestamp-URL overrides; default timestamp URL to
`http://timestamp.acs.microsoft.com`.

Auth (service principal, via env consumed by `DefaultAzureCredential`):
`AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`.

Config (secrets or repo vars): `AZURE_CODE_SIGNING_ENDPOINT` (e.g.
`https://eus.codesigning.azure.net/`), `AZURE_CODE_SIGNING_ACCOUNT`,
`AZURE_CERT_PROFILE`.

The signing service-principal needs the **Trusted Signing Certificate Profile
Signer** role on the certificate profile.

## Auto-update compatibility

The makers already emit the full update file set and the workflow uploads **all**
of `out/make`:

- **Windows:** `RELEASES`, `*.nupkg` (full), `*Setup.exe` — what Squirrel.Windows
  / `update.electronjs.org/<owner>/<repo>/win32/...` consume.
- **macOS:** `*.zip` (Squirrel.Mac update feed) alongside the `.dmg` (manual
  download). macOS auto-update requires the signed + notarized build (covered
  above).
- **Linux:** `.deb` / `.rpm` for manual install (Electron auto-update unsupported).

Auto-update activates only once the **draft is published** (drafts are invisible
to the public update API), matching the draft-then-publish flow. Wiring
`update-electron-app` into the app's main process is out of scope for this
workflow.

## Out of scope

- App-side `update-electron-app` integration (main-process call).
- A rolling "nightly" prerelease (nightly = workflow artifacts only, by decision).
- Linux auto-update (not supported by Electron).
- arm64 Windows / arm Linux builds.

## Decisions

- **Release strategy:** collect-and-release (make → upload artifacts → single
  tag-gated release job) over per-platform `electron-forge publish`. Avoids
  release-creation races and reuses the same artifacts for nightly.
- **Build triggers:** `main` + tags + manual only (tests run on every push/PR via
  `ci.yml`). PR builds are not triggered (mac/win runners are expensive).
- **Node 24.15.0** everywhere (aligns with existing `ci.yml`).
- **Windows signing via Azure Trusted Signing** (cloud, headless) replacing the
  Certum smart-card hook.
- **`ci.yml` trimmed** to not run on `main` pushes (dedupe with build.yml gate).
- **`lfs: true`** on checkout in build jobs so release artifacts bundle the
  PMTiles basemap/terrain.
