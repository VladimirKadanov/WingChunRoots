'use client';

// The school map (milestone M11, In scope 6; plan §5.3 "the map rule", §5.8): MapLibre GL JS
// through @vis.gl/react-maplibre, in a chunk of its own that only /schools asks for (next/dynamic
// in src/components/schools/finder.tsx), so no other page loads map code or a map style
// (scripts/check-bundle-budget.mjs checks the build; @M11 checks the browser).
//
// - Style: the light or the dark one (src/server/geo/map-styles.ts: OpenFreeMap, or the local
//   minimal styles the tests use), following the page's theme. data-map-style says which one has
//   loaded (the tests wait for it). The attribution control is on (the style's sources name their
//   data: OpenStreetMap, OpenMapTiles, OpenFreeMap).
// - Markers are buttons (Tab reaches them; Enter or Space selects), 44 x 44 CSS px: an exact
//   location is a solid pin standing on its point, a city-only school a hollow dashed ring at the
//   city's centre; their names say which ("exact location" / "private club, by invitation"), and
//   the selected one carries its name beside it. Shape and text, never colour alone.
// - `paddingBottom`: the height of the phone's sheet over the map (MapLibre's padding), so the
//   centre of the view, and a selected pin moved to it, stay in the part above the sheet; a marker
//   reached with Tab under the sheet is brought into view (WCAG 2.4.11).
// - The compact attribution opens as MapLibre opens it, as wide as a phone's map. MapLibre folds it
//   to its button on a drag only; here any move of the reader's (keys, a wheel, the zoom buttons)
//   and the choice of a school fold it too, so it never covers the selected pin or "Search this
//   area" (both sit in the middle of the map, clear of the control column). Its button opens it again.
// - data-moving says whether the view is moving (the tests wait for it to settle).
// - Coordinates arrive only through the public DTO: a city-only school is at its city's centre.

import 'maplibre-gl/dist/maplibre-gl.css';
import './map-controls.css';

import { AttributionControl, Map, type MapRef, Marker, NavigationControl } from '@vis.gl/react-maplibre';
import { useEffect, useEffectEvent, useRef, useState } from 'react';

import { CityRingMark, ExactPinMark } from '@/components/schools/marks';
import { cx } from '@/lib/cx';
import { MAX_ZOOM, MIN_ZOOM } from '@/lib/school-finder';
import type { SchoolPinDto } from '@/server/dto/schools';
import { maplibregl } from './maplibre';
import { usePageTheme } from './use-theme';

export interface MapView {
  lat: number;
  lng: number;
  zoom: number;
}

export type Bounds = [west: number, south: number, east: number, north: number];

export interface SchoolMapProps {
  schools: readonly SchoolPinDto[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  styles: { light: string; dark: string };
  /**
   * Where the map opens: the view in the address, else the bounds of the search's circle, else the
   * bounds of the schools (one school: its point at zoom 10; none: the whole world).
   */
  initial: { view: MapView | null; bounds: Bounds | null };
  /** The height of a bottom sheet over the map, in CSS px (0 without one). */
  paddingBottom: number;
  /** The view after a move settles (the finder writes it into the address); `byUser`: a drag, a key, a wheel or a button. */
  onViewChange: (view: MapView, byUser: boolean) => void;
  /** The map failed to start (no WebGL context): the finder shows the list instead. */
  onFail: () => void;
}

/** The view that shows every school: the bounds of their points (null for fewer than two). */
function boundsOf(schools: readonly SchoolPinDto[]): Bounds | null {
  if (schools.length < 2) return null;
  let [west, south, east, north] = [180, 90, -180, -90];
  for (const s of schools) {
    west = Math.min(west, s.point.lng);
    east = Math.max(east, s.point.lng);
    south = Math.min(south, s.point.lat);
    north = Math.max(north, s.point.lat);
  }
  return [west, south, east, north];
}

function reducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

const padding = (bottom: number) => ({ top: 0, left: 0, right: 0, bottom });

/** Folds the compact attribution to its button, as MapLibre does on a drag (AttributionControl._updateCompactMinimize). */
function foldAttribution(container: HTMLElement) {
  container.querySelector('.maplibregl-ctrl-attrib.maplibregl-compact-show')?.classList.remove('maplibregl-compact-show');
}

export default function SchoolMap({ schools, selectedId, onSelect, styles, initial, paddingBottom, onViewChange, onFail }: SchoolMapProps) {
  const theme = usePageTheme();
  const map = useRef<MapRef>(null);
  const [loadedStyle, setLoadedStyle] = useState<'light' | 'dark' | null>(null);
  const [moving, setMoving] = useState(false);
  // The theme whose style was asked for last, for the style.load listener (set after each render).
  const requested = useRef(theme);
  useEffect(() => {
    requested.current = theme;
  }, [theme]);
  // Only the first render's values open the map (initialViewState); later ones are ignored.
  const bounds = initial.view ? null : (initial.bounds ?? boundsOf(schools));
  const only = !initial.view && !bounds && schools.length === 1 ? schools[0]!.point : null;

  // A selected school comes to the centre of the part of the map above the sheet, and comes back
  // there when the sheet changes height (it stays visible above the sheet). Without a selection a
  // new sheet height only moves the centre of the view (MapLibre's padding).
  const place = useEffectEvent((animate: boolean) => {
    const m = map.current?.getMap();
    if (!m) return;
    const school = schools.find((s) => s.id === selectedId);
    if (!school) {
      m.setPadding(padding(paddingBottom));
      return;
    }
    m.easeTo({ center: [school.point.lng, school.point.lat], padding: padding(paddingBottom), duration: animate && !reducedMotion() ? 450 : 0 });
  });
  useEffect(() => {
    place(true);
  }, [selectedId, paddingBottom]);
  useEffect(() => {
    const container = selectedId ? map.current?.getMap().getContainer() : null;
    if (container) foldAttribution(container);
  }, [selectedId]);

  // A marker reached with the keyboard under the sheet comes into view first (WCAG 2.4.11).
  const revealIfHidden = (element: HTMLElement, school: SchoolPinDto) => {
    const m = map.current?.getMap();
    if (!m || !element.matches(':focus-visible')) return;
    const frame = m.getContainer().getBoundingClientRect();
    const box = element.getBoundingClientRect();
    const hidden = box.bottom > frame.bottom - paddingBottom || box.top < frame.top || box.left < frame.left || box.right > frame.right;
    if (hidden) m.easeTo({ center: [school.point.lng, school.point.lat], padding: padding(paddingBottom), duration: 0 });
  };

  return (
    <div
      className="relative size-full"
      data-testid="school-map"
      data-map-style={loadedStyle ?? ''}
      data-theme-wanted={theme}
      data-map-theme={theme}
      data-moving={moving ? 'true' : 'false'}
      data-padding-bottom={paddingBottom}
    >
      <Map
        ref={map}
        mapLib={maplibregl}
        mapStyle={styles[theme]}
        // A new theme loads the other style whole, so style.load fires for it (data-map-style).
        styleDiffing={false}
        initialViewState={
          initial.view
            ? { longitude: initial.view.lng, latitude: initial.view.lat, zoom: initial.view.zoom }
            : bounds
              ? { bounds, fitBoundsOptions: { padding: { top: 64, left: 48, right: 48, bottom: 48 + paddingBottom }, maxZoom: 11 } }
              : { longitude: only?.lng ?? 15, latitude: only?.lat ?? 30, zoom: only ? 10 : 1.5 }
        }
        minZoom={MIN_ZOOM}
        maxZoom={MAX_ZOOM}
        attributionControl={false}
        dragRotate={false}
        touchPitch={false}
        style={{ width: '100%', height: '100%' }}
        onLoad={(event) => {
          const m = event.target;
          m.getCanvas().setAttribute('aria-label', 'Map of the schools. Use the arrow keys to move it and + or − to zoom.');
          m.setPadding(padding(paddingBottom));
          const settle = () => setLoadedStyle(requested.current);
          m.on('style.load', settle);
          settle();
        }}
        onMoveStart={(event) => {
          setMoving(true);
          if (event.originalEvent) foldAttribution(event.target.getContainer());
        }}
        onMoveEnd={(event) => {
          setMoving(false);
          const c = event.target.getCenter();
          onViewChange({ lat: c.lat, lng: c.lng, zoom: event.target.getZoom() }, !!event.originalEvent);
        }}
        onError={(event) => {
          // A context that cannot start is not a passing hiccup: the list takes over. Tile and
          // style errors (a network that drops) leave the map as it is.
          if (/webgl|context/i.test(String(event.error?.message ?? ''))) onFail();
        }}
      >
        <AttributionControl position="top-right" compact />
        <NavigationControl position="top-right" showCompass={false} />
        {schools.map((school) => {
          const selected = school.id === selectedId;
          const exact = school.precision === 'exact';
          return (
            <Marker key={school.id} longitude={school.point.lng} latitude={school.point.lat} anchor={exact ? 'bottom' : 'center'} style={{ zIndex: selected ? 2 : 1 }}>
              <button
                type="button"
                data-testid="school-marker"
                data-slug={school.slug}
                data-precision={school.precision}
                data-selected={selected ? 'true' : undefined}
                aria-pressed={selected}
                aria-label={`${school.name}, ${school.city}: ${exact ? 'exact location' : 'private club, by invitation (city only)'}`}
                onClick={(event) => {
                  event.stopPropagation();
                  onSelect(school.id);
                }}
                onFocus={(event) => revealIfHidden(event.currentTarget, school)}
                className={cx(
                  'relative grid size-11 cursor-pointer text-fg outline-offset-2',
                  exact ? 'place-items-end justify-items-center' : 'place-items-center',
                )}
              >
                {exact ? <ExactPinMark size={selected ? 38 : 30} /> : <CityRingMark size={selected ? 38 : 30} />}
                {selected ? (
                  <span
                    aria-hidden="true"
                    className="absolute top-full left-1/2 mt-1 max-w-[12rem] -translate-x-1/2 rounded-sm border border-border-strong bg-surface-1 px-2 py-0.5 text-center text-xs font-semibold whitespace-nowrap shadow-sm"
                  >
                    {school.name}
                  </span>
                ) : null}
              </button>
            </Marker>
          );
        })}
      </Map>
    </div>
  );
}
