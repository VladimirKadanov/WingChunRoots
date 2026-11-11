'use client';

// The organization's school heatmap on a map (milestone M24; docs/adr/0027-organization-tools.md):
// the squares of organizationTools.heatmap drawn as filled squares, darker where more schools are,
// each with its count in text (a marker) so the density is never told by colour alone. It shows
// only what the server sent: squares of at least the minimum count, by their corners; no school's
// point ever reaches this file. Loaded with React.lazy when the admin asks for the map, so the
// page loads no map code until then (scripts/check-bundle-budget.mjs, LAZY_ONLY). The table on the
// page holds the same numbers and is the way without a pointer or WebGL; the map is hidden from
// assistive technology (aria-hidden) and from the tab order apart from its own zoom controls.

import 'maplibre-gl/dist/maplibre-gl.css';
import './map-controls.css';

import { AttributionControl, Layer, Map, Marker, NavigationControl, Source } from '@vis.gl/react-maplibre';

import { maplibregl } from './maplibre';
import { usePageTheme } from './use-theme';

export interface HeatSquare {
  south: number;
  west: number;
  size: number;
  count: number;
}

export interface HeatmapMapProps {
  cells: readonly HeatSquare[];
  styles: { light: string; dark: string };
}

function bounds(cells: readonly HeatSquare[]): [[number, number], [number, number]] {
  const west = Math.min(...cells.map((c) => c.west));
  const south = Math.min(...cells.map((c) => c.south));
  const east = Math.max(...cells.map((c) => c.west + c.size));
  const north = Math.max(...cells.map((c) => c.south + c.size));
  return [
    [west - 1, south - 1],
    [east + 1, north + 1],
  ];
}

export default function HeatmapMap({ cells, styles }: HeatmapMapProps) {
  const theme = usePageTheme();
  const max = Math.max(1, ...cells.map((c) => c.count));
  const data = {
    type: 'FeatureCollection' as const,
    features: cells.map((c) => ({
      type: 'Feature' as const,
      properties: { weight: c.count / max },
      geometry: {
        type: 'Polygon' as const,
        coordinates: [
          [
            [c.west, c.south],
            [c.west + c.size, c.south],
            [c.west + c.size, c.south + c.size],
            [c.west, c.south + c.size],
            [c.west, c.south],
          ],
        ],
      },
    })),
  };
  // The brand red of the theme (src/design/generated/tokens.css: --brand-fg dark, --brand light).
  const fill = theme === 'dark' ? '#F2665F' : '#C62828';
  return (
    <div className="relative h-80 overflow-hidden rounded-sm border border-border-strong md:h-[28rem]" data-testid="organization-heatmap-map" data-map-theme={theme}>
      <Map
        mapLib={maplibregl}
        mapStyle={styles[theme]}
        styleDiffing={false}
        initialViewState={cells.length > 0 ? { bounds: bounds(cells) } : { longitude: 15, latitude: 45, zoom: 2 }}
        minZoom={1}
        maxZoom={8}
        attributionControl={false}
        dragRotate={false}
        touchPitch={false}
        style={{ width: '100%', height: '100%' }}
        onLoad={(event) => {
          event.target.getCanvas().setAttribute('aria-hidden', 'true');
          event.target.getContainer().setAttribute('data-map-loaded', 'true');
        }}
      >
        <AttributionControl position="bottom-right" compact />
        <NavigationControl position="top-right" showCompass={false} />
        <Source id="heat" type="geojson" data={data}>
          <Layer id="heat-fill" type="fill" paint={{ 'fill-color': fill, 'fill-opacity': ['+', 0.2, ['*', 0.5, ['get', 'weight']]] }} />
          <Layer id="heat-line" type="line" paint={{ 'line-color': fill, 'line-width': 1.5 }} />
        </Source>
        {cells.map((c) => (
          <Marker key={`${c.south}:${c.west}`} longitude={c.west + c.size / 2} latitude={c.south + c.size / 2} anchor="center">
            <span aria-hidden="true" className="grid min-w-8 place-items-center rounded-sm border border-border-strong bg-surface px-1.5 py-0.5 text-sm font-semibold text-fg tabular-nums">
              {c.count}
            </span>
          </Marker>
        ))}
      </Map>
    </div>
  );
}
