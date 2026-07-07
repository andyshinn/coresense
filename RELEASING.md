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
