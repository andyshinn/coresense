# CoreSense — Homebrew Tap & Two-Channel Casks Design

- **Date:** 2026-07-05
- **Status:** Approved design (pre-implementation)
- **Author:** Andy Shinn (with Claude)
- **Borrows from:** Beacon's Homebrew cask setup
  (`/Users/andy/GitHub/andyshinn/beacon` — `Casks/beacon.rb`,
  `scripts/update-cask.mjs`, `.github/workflows/homebrew-cask.yml`)
- **Related:** [`2026-06-21-auto-updates-channels-design.md`](2026-06-21-auto-updates-channels-design.md)
  (the in-app stable/development update channels this mirrors),
  [`2026-06-19-ci-build-release-workflow-design.md`](2026-06-19-ci-build-release-workflow-design.md)
  (the release flow this hooks into)

## 1. Goal

Let macOS users install CoreSense with Homebrew across **two channels** — a
stable channel and a development (prerelease) channel — because CoreSense ships
tagged prereleases (`v0.0.11-dev.0`, `v0.0.12-dev.0`) alongside stable releases:

```sh
brew tap andyshinn/coresense https://github.com/andyshinn/coresense
brew install --cask coresense        # latest STABLE     → v0.0.10 today
brew install --cask coresense@dev    # latest PRERELEASE  → v0.0.12-dev.0 today
# later
brew upgrade --cask coresense
brew upgrade --cask coresense@dev
```

CoreSense is a signed, notarized Electron **GUI** app published to GitHub
Releases, so the correct Homebrew mechanism is a **Cask** (installs a pre-built
`.app` from the DMG), **not** a Formula (which builds CLI tools/libraries from
source). Casks are macOS-only; Windows (Squirrel) and Linux (deb/rpm) keep their
existing installers unchanged.

## 2. Locked decisions

| Decision | Choice | Rationale |
|---|---|---|
| Mechanism | **Cask** (not Formula) | GUI app; installs the notarized `.app` from the DMG |
| Channels | **Two casks**: `coresense` + `coresense@dev` | User chooses stable or bleeding-edge; the tagged prerelease **is** the "HEAD" |
| Cask location | **In-repo `Casks/`** | Single repo; no second repo, no cross-repo token |
| Tap command | `brew tap andyshinn/coresense https://github.com/andyshinn/coresense` | Bare `brew tap andyshinn/coresense` requires a dedicated `homebrew-coresense` repo, which we opted out of |
| Artifact | `CoreSense-<version>-universal.dmg` | The universal DMG from CI's `make:mac --arch=universal` (verified on v0.0.10 and v0.0.12-dev.0) |
| Bundle id (for `zap`) | **`com.electron.coresense`** | Electron Forge default — `forge.config.ts` does **not** set `appBundleId` (verified from the built `Info.plist`) |
| Version/sha upkeep | **CI auto-bump** on publish | Zero manual work per release; same-repo commit |
| Stable trigger | `on: release → types: [released]` | Fires only for **stable, published** releases (and prerelease→release promotions); skips drafts + prereleases |
| Dev trigger | `on: release → types: [prereleased]` | Fires when a **prerelease** is published — the case Beacon deliberately skips |
| `coresense` `auto_updates` | `true` | Stable channel silently self-updates via `update-electron-app`; the cask must not fight it |
| `coresense@dev` `auto_updates` | **omitted (false)** | Dev channel is **notify-only** (never silently self-installs a prerelease), so `brew upgrade` is the real upgrade path between dev builds |
| macOS floor | `depends_on macos: :big_sur` | Electron 42 baseline (symbol form = minimum, per `brew style`) |

### The in-repo tap tradeoff (explicit)

Homebrew resolves the tap name `andyshinn/coresense` to a repo literally named
`homebrew-coresense`. Because we keep the casks **inside the app repo** instead,
the first `brew tap` must name the repo URL once. After that,
`brew install --cask coresense` / `coresense@dev` and their `upgrade`
counterparts work by token. This is the accepted cost of avoiding a second
repository — the same tradeoff Beacon made.

### Why two casks with different `auto_updates` (the key divergence from Beacon)

The in-app updater (see the auto-updates-channels design) behaves differently per
channel, and the casks mirror that so Homebrew and the app never fight:

| | Stable channel | Development channel |
|---|---|---|
| In-app behavior (mac) | **Silent** self-update via `update-electron-app` / `update.electronjs.org` (latest stable only) | **Notify-only** — opens the release page; never silently installs |
| Cask `auto_updates` | `true` (let the app update itself) | omitted → **`brew upgrade` upgrades it** |
| Cask `livecheck` | `:github_latest` (excludes prereleases) | `:github_releases` (includes prereleases) |

Because `update.electronjs.org` serves only the latest **stable** release, a
`coresense@dev` install is never silently advanced to the next prerelease by the
app; Homebrew is the correct upgrade mechanism there, hence `auto_updates` is
left off so plain `brew upgrade --cask coresense@dev` works (no `--greedy`
needed).

> **Known interaction (accepted, not solved here):** the app's default in-app
> update channel is `stable`. A `coresense@dev` user who leaves the in-app
> channel on `stable` may see the app's own silent updater offer the latest
> **stable** build. That is pre-existing app behavior independent of the cask;
> the intended flow is that a dev-channel user also selects **Development** in
> the app's update settings. The cask does not attempt to override this.

## 3. The casks

### `Casks/coresense.rb` (stable)

```ruby
# Homebrew cask for CoreSense (stable channel). `version` + `sha256` are
# auto-managed on each STABLE release by .github/workflows/homebrew-cask.yml
# (via scripts/update-cask.mjs); edit those two lines by hand only as a fallback.
# Install with:
#   brew tap andyshinn/coresense https://github.com/andyshinn/coresense
#   brew install --cask coresense
cask "coresense" do
  version "0.0.10"
  sha256 "<real sha of CoreSense-0.0.10-universal.dmg — seeded at implementation>"

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

### `Casks/coresense@dev.rb` (development / prerelease)

Identical to the stable cask **except** the four channel-specific fields:

```ruby
# Homebrew cask for CoreSense (development / prerelease channel). `version` +
# `sha256` are auto-managed on each PRERELEASE by .github/workflows/homebrew-cask.yml.
# Install with:
#   brew tap andyshinn/coresense https://github.com/andyshinn/coresense
#   brew install --cask coresense@dev
cask "coresense@dev" do
  version "0.0.12-dev.0"
  sha256 "<real sha of CoreSense-0.0.12-dev.0-universal.dmg — seeded at implementation>"

  url "https://github.com/andyshinn/coresense/releases/download/v#{version}/CoreSense-#{version}-universal.dmg"
  name "CoreSense"
  desc "Experimental desktop MeshCore client (development builds)"
  homepage "https://github.com/andyshinn/coresense"

  livecheck do
    url :url
    strategy :github_releases   # includes prereleases (:github_latest would skip them)
  end

  # No `auto_updates` — dev channel is notify-only, so `brew upgrade` manages it.
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

Notes:

- **`version` / `sha256`** are the two fields the automation rewrites. Both are
  **seeded with real values** during implementation (§5), so both install
  commands work immediately on merge.
- **No `verified:`** on the URL — `brew audit` flags it as unnecessary because
  the download domain (`github.com`) matches the homepage domain.
- **`app "CoreSense.app"`** — `productName` is `CoreSense`, so the mounted DMG
  contains `CoreSense.app`. Both casks install the *same* `.app`, hence
  `conflicts_with` — a user has one channel installed at a time.
- **`conflicts_with cask:`** is declared for a clean pre-flight message. If
  `brew audit`/`brew style` objects to the `@`-token reference, drop it and rely
  on the natural "an App already exists" conflict (verification step §7).
- **`zap`** keys on bundle id `com.electron.coresense` (Forge default), including
  the `ShipIt` (Squirrel.Mac) updater cache.

## 4. The update script — `scripts/update-cask.mjs`

Beacon's script, verbatim in behavior, with `beacon`→`coresense` renamed and
`DEFAULT_CASK = Casks/coresense.rb`. Plain Node ESM, **zero dependencies** (CI
needs only `setup-node`, no install). Edits **only** the two anchored lines and
fails loudly rather than emit a half-updated cask.

**Interface**

```sh
# stable
node scripts/update-cask.mjs --version 0.0.10 --dmg path/to/CoreSense-0.0.10-universal.dmg
# dev — target the other cask via --cask
node scripts/update-cask.mjs --version 0.0.12-dev.0 \
  --dmg path/to/CoreSense-0.0.12-dev.0-universal.dmg --cask Casks/coresense@dev.rb
```

**Behavior**

1. Read `--version` (required), `--dmg` (required, local path), `--cask`
   (default `Casks/coresense.rb`).
2. Compute the DMG's SHA-256 (`node:crypto`, streamed).
3. Read the target cask, replace the `version "…"` and `sha256 "…"` lines via
   anchored regex (`^(\s*<field>\s+")[^"]*(")`), write it back.
4. Fail loudly (non-zero exit) if either line isn't found or the DMG is missing —
   never emit a half-updated cask.

The anchored regex handles prerelease strings (`0.0.12-dev.0`) unchanged — the
replacement value contains no `"`.

Single source of truth for the edit, callable from CI and by hand against a
downloaded release DMG.

## 5. Seeding real values on day one

Both `version`/`sha256` pairs are computed from the **already-published** DMGs so
`brew install` works the moment this merges, without waiting for the next release
to fire the workflow:

1. `gh release download v0.0.10 --pattern 'CoreSense-*-universal.dmg'`
   → `node scripts/update-cask.mjs --version 0.0.10 --dmg … --cask Casks/coresense.rb`
2. `gh release download v0.0.12-dev.0 --pattern 'CoreSense-*-universal.dmg'`
   → `node scripts/update-cask.mjs --version 0.0.12-dev.0 --dmg … --cask Casks/coresense@dev.rb`

Verified assets: `CoreSense-0.0.10-universal.dmg` (stable, `prerelease:false`)
and `CoreSense-0.0.12-dev.0-universal.dmg` (dev, `prerelease:true`).

## 6. The automation — `.github/workflows/homebrew-cask.yml`

One workflow, both channels — a single `bump` job that selects the target cask
from the release's `prerelease` flag.

```yaml
name: Homebrew cask
on:
  release:
    types: [released, prereleased]   # released = stable publish; prereleased = dev publish
permissions:
  contents: write
concurrency:
  group: homebrew-cask
  cancel-in-progress: false          # serialize bumps; never drop one
```

**Job steps**

1. `actions/checkout` **main** (`ref: main`) with the write token — commit the
   bump onto the branch head, not the tagged commit.
2. `actions/setup-node` with `node-version: '24'` (no `.nvmrc`; matches ci.yml's
   `NODE_VERSION: '24.15.0'`).
3. Select the target cask from `github.event.release.prerelease`:
   `true` → `Casks/coresense@dev.rb`, else → `Casks/coresense.rb` (exported to
   `$GITHUB_ENV` as `CASK`).
4. `gh release download "$TAG" --repo "$GITHUB_REPOSITORY" --pattern 'CoreSense-*-universal.dmg' --dir dist`
   (`GH_TOKEN: ${{ github.token }}`) — fetch the exact published universal DMG.
5. `node scripts/update-cask.mjs --version "${TAG#v}" --dmg "${dmgs[0]}" --cask "$CASK"`
   (fail if no universal DMG is found).
6. If `$CASK` changed: commit as `github-actions[bot]` with message
   `chore: bump homebrew cask to <TAG> [skip ci]` and `git push origin HEAD:main`.
   No-op cleanly if unchanged (re-runs are idempotent). `[skip ci]` prevents the
   push from re-triggering `ci.yml`.

**Why `released` + `prereleased` and not the tag build:** the tag build drafts
stable releases (and publishes prereleases), and a draft's DMG URL isn't publicly
downloadable. Bumping only on **publish** guarantees the `url` resolves and the
`sha256` matches the final bytes, with no draft-release race. `released` covers
stable publishes (and prerelease→release promotions); `prereleased` covers dev
publishes — together they cover every case the app actually ships.

**Push-race note:** like Beacon's workflow, the `git push origin HEAD:main` does
not rebase. A concurrent human push to `main` between checkout and push could
make it fail; `concurrency` serializes workflow-vs-workflow, and re-publishing
the release re-runs the (idempotent) bump. Accepted for simplicity.

## 7. Docs

- **README.md** — add an "Install (macOS)" section: the tap line plus both
  install lines, noting `coresense` = stable and `coresense@dev` = latest
  prerelease, and the one-time explicit tap URL (in-repo tap).
- **New `RELEASING.md`** — note that the casks auto-bump on publish (stable on
  `released` → `coresense.rb`; prerelease on `prereleased` → `coresense@dev.rb`)
  via `homebrew-cask.yml`, and how to bump by hand with `update-cask.mjs`.

## 8. Testing / verification

- `brew style --cask Casks/coresense.rb Casks/coresense@dev.rb` and
  `brew audit --cask` pass (or the only note is the `conflicts_with @`-token one,
  handled per §3). Both casks are syntactically valid Ruby and lint clean.
- `scripts/update-cask.mjs` run against a downloaded release DMG produces a
  well-formed sha and edits only the two intended lines (verify with `git diff`),
  for **both** the default cask and `--cask Casks/coresense@dev.rb`.
- Workflow YAML parses (`actionlint` if available; otherwise a careful read),
  and the `prerelease`-based file selection is exercised by reading the branch
  for both `true` and `false`.
- End-to-end sanity (optional, local): `brew install --cask ./Casks/coresense.rb`
  installs `CoreSense.app`; `brew uninstall --cask` (and `--zap`) removes it.

## 9. Out of scope

- A rolling **nightly-from-`main`** HEAD cask (rejected in favor of tagged
  prereleases as the "HEAD"; would need a `nightly` rolling release + a ci.yml
  change to publish main builds).
- Submitting CoreSense to `homebrew-cask` (homebrew-core) — this is a personal tap.
- A dedicated `homebrew-coresense` tap repo (deferred; would enable the bare
  `brew tap andyshinn/coresense`).
- Linux/Windows Homebrew (casks are macOS-only) — existing deb/rpm/Squirrel
  installers unchanged.
- Solving the "dev cask + in-app stable channel" silent-update interaction (§2) —
  pre-existing app behavior, out of scope for the cask.
