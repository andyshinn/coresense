# Building PMTiles extracts for Coresense

The Map panel ships with two bundled PMTiles files in `resources/tiles/`:

- `basemap.pmtiles` — Protomaps vector basemap extract
- `terrain.pmtiles` — Mapterhorn raster terrain extract

These are tracked in **git-LFS**. A fresh clone needs `git lfs install && git lfs pull` to materialize them. The app builds and runs without these files (the Map panel will render a "missing tiles" empty-state), but a release build should always include them.

## Prerequisites

- `pmtiles` CLI: https://github.com/protomaps/go-pmtiles/releases (or `brew install pmtiles`)
- A bounding box for your area of interest (e.g. from https://boundingbox.klokantech.com — pick the **CSV** raw format: `west,south,east,north`)

## Basemap (Protomaps)

Extract from the planet-scale Protomaps build hosted by Protomaps:

```sh
pmtiles extract \
  https://build.protomaps.com/YYYYMMDD.pmtiles \
  resources/tiles/basemap.pmtiles \
  --bbox=WEST,SOUTH,EAST,NORTH \
  --maxzoom=14
```

- Pick a recent dated build from https://maps.protomaps.com/builds (replace `YYYYMMDD`).
- Cap `--maxzoom` so the extract stays small (~14 is a good default for a regional extract). Anything above this is covered by the online fallback at runtime.

## Terrain (Mapterhorn)

```sh
pmtiles extract \
  https://download.mapterhorn.com/mapterhorn.pmtiles \
  resources/tiles/terrain.pmtiles \
  --bbox=WEST,SOUTH,EAST,NORTH \
  --maxzoom=12
```

Terrain doesn't need as high a zoom — `--maxzoom=12` keeps the file manageable while still giving good hillshade detail.

## Size budget

Target combined size **< 200 MB**. If you exceed this, lower `--maxzoom` or tighten the bbox. Verify with:

```sh
ls -lh resources/tiles/
pmtiles show resources/tiles/basemap.pmtiles
pmtiles show resources/tiles/terrain.pmtiles
```

## Committing

```sh
git lfs install
git add resources/tiles/basemap.pmtiles resources/tiles/terrain.pmtiles
git commit -m "tiles: refresh extracts (YYYY-MM-DD)"
```

LFS will handle the binary storage transparently.
