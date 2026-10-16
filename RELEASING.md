# Releasing

CoreSense is built and released by [`ci.yml`](.github/workflows/ci.yml) on
`v*.*.*` tags:

- A tag **without** a `-` (e.g. `v0.1.0`) → a **draft** stable release. Publish
  it in the GitHub UI to make it live.
- A tag **with** a `-` (e.g. `v0.1.0-dev.0`) → a **published prerelease**.

## What ships in app.asar

Forge copies `node_modules` into the package and then prunes devDependencies,
so `package.json` decides what ships:

- **`dependencies`** holds only what the packaged main process `require()`s at
  runtime: the externals listed in `vite.main.config.mts` (`@stoprocent/noble`,
  `ws`, `electron-squirrel-startup`) and their dependency closure.
- **`devDependencies`** holds everything else, including every library Vite
  bundles into `.vite/` (React, Radix, MapLibre, Hono, meshcore-ts, ...).
  A bundled library listed under `dependencies` would ship twice.
- **`optionalDependencies`** holds `macos-alias`, which `appdmg` (MakerDMG)
  builds on macOS. It declares its own `nan` dependency.

When you add a package, put it in `devDependencies` unless you also add it to
the main-process `external` list. To check a build, run `pnpm package` and then
`npx @electron/asar list out/CoreSense-*/resources/app.asar` (on macOS, the asar
is under `CoreSense.app/Contents/Resources/`).

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
