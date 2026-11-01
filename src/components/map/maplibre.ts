// MapLibre GL JS with its Web Worker (milestone M11). MapLibre 6 starts its worker from a URL it
// derives from its own module's address, which a bundle does not keep, so the worker file is
// emitted as a static asset of the build (the `?asset` rule in next.config.ts, Turbopack's `asset`
// module type: the file as published, under a hashed name in /_next/static/media/) and its address
// is handed to MapLibre before the first map. Imported only by school-map.tsx and pin-picker.tsx, which load with next/dynamic: no
// page loads MapLibre with its first JavaScript (scripts/check-bundle-budget.mjs).

import * as maplibregl from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?asset';

maplibregl.setWorkerUrl(workerUrl);

export { maplibregl };
