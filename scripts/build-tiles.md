# Building the bundled basemap PMTiles for Coresense

The Map panel ships with ONE small bundled PMTiles file in `resources/tiles/`:

- `basemap.pmtiles` — a low-detail **world** Protomaps vector basemap at **maxzoom 5**.

It is tracked in **git-LFS** (a fresh clone needs `git lfs install && git lfs pull`).
It serves only as an offline backdrop: higher-detail tiles (zoom > 5) are
downloaded on demand from the Protomaps hosted API and require an API key. 3D
terrain / hillshade has been removed — there is no bundled terrain extract.

## Prerequisites

- `pmtiles` CLI: https://github.com/protomaps/go-pmtiles/releases (or `brew install pmtiles`)

## Basemap (Protomaps, world @ maxzoom 5)

```sh
pmtiles extract \
  https://build.protomaps.com/YYYYMMDD.pmtiles \
  resources/tiles/basemap.pmtiles \
  --maxzoom=5
```

- Pick a recent dated build from https://maps.protomaps.com/builds (replace `YYYYMMDD`).
- No `--bbox` — a whole-world extract keeps the backdrop global. At maxzoom 5 the
  file is small (~15 MB). Verify with `pmtiles show resources/tiles/basemap.pmtiles`.

## Committing

```sh
git add resources/tiles/basemap.pmtiles
git commit -m "tiles: refresh basemap extract (YYYY-MM-DD)"
```
