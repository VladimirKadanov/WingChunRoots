// The MapLibre worker file, imported as a static asset (./maplibre.ts, the `?asset` rule in
// next.config.ts): its URL.
declare module 'maplibre-gl/dist/maplibre-gl-worker.mjs?asset' {
  const url: string;
  export default url;
}
