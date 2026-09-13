import { setWorkerUrl } from 'maplibre-gl';
// `?worker&url`, not `?url`: the dist worker imports its sibling
// maplibre-gl-shared.mjs, which plain `?url` doesn't emit — that only 404s in
// the production build. Vite's worker pipeline inlines it into one chunk.
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';

// MapLibre 6 is ESM-only and no longer inlines its worker as a blob. Its
// default URL (`new URL('./maplibre-gl-worker.mjs', import.meta.url)`) resolves
// next to OUR chunk, which 404s under both the Vite dev server and the packaged
// build — silently: the map fires neither `load` nor `error`, it just stays
// blank. Don't "fix" dev with optimizeDeps.exclude; that only hides the
// production 404. Imported for its side effect by MapCanvas, the one place a
// Map is constructed.
setWorkerUrl(workerUrl);
