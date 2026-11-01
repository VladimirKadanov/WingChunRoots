// The school finder's state in the address (milestone M11, In scope 6): pure, shared by the
// /schools page (its server part reads it) and the map island (it writes the view back).
//
//   /schools?near=Sofia&radius=50&lineage=<root id>&view=map&lat=42.7&lng=23.32&z=9
//
// - near: a city or town, looked up in the GeoNames extract (no geocoding service): the centre of
//   the search. Without `near`, lat and lng are the centre when a radius is given.
// - radius: kilometres around the centre (RADIUS_CHOICES_KM in the form; any whole number up to
//   MAX_RADIUS_KM is read). Without a centre there is no radius: every public school.
// - lineage: the id of the person at the root of a lineage (the explorer's ids).
// - view: map (the default) or list.
// - lat, lng, z: the map's view. The island writes them when the map stops moving (replaceState,
//   at most every VIEW_WRITE_MS), so a reload or a shared link opens the same view.
//
// A value that does not parse is dropped, never an error page: the finder opens without it.

export const RADIUS_CHOICES_KM = [10, 25, 50, 100, 250] as const;
export const DEFAULT_RADIUS_KM = 50;
export const MAX_RADIUS_KM = 500;
/** The map writes its view into the address at most this often. */
export const VIEW_WRITE_MS = 500;
export const MIN_ZOOM = 1;
export const MAX_ZOOM = 17;

export type FinderView = 'map' | 'list';

export interface FinderParams {
  near: string | null;
  lat: number | null;
  lng: number | null;
  z: number | null;
  radius: number | null;
  lineage: string | null;
  view: FinderView;
}

type Query = Record<string, string | string[] | undefined>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NUMBER = /^-?\d{1,3}(\.\d{1,8})?$/;

function one(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function inRange(value: string | undefined, min: number, max: number): number | null {
  if (value === undefined || !NUMBER.test(value.trim())) return null;
  const n = Number(value.trim());
  return Number.isFinite(n) && n >= min && n <= max ? n : null;
}

/** The finder's state from the address; anything malformed is dropped. */
export function finderParams(query: Query): FinderParams {
  const near = (one(query.near) ?? '').normalize('NFC').trim().slice(0, 100) || null;
  const lat = inRange(one(query.lat), -90, 90);
  const lng = inRange(one(query.lng), -180, 180);
  const both = lat !== null && lng !== null;
  const radiusText = one(query.radius)?.trim();
  const radius = radiusText && /^\d{1,3}$/.test(radiusText) && Number(radiusText) >= 1 && Number(radiusText) <= MAX_RADIUS_KM ? Number(radiusText) : null;
  const lineageText = one(query.lineage)?.trim();
  return {
    near,
    lat: both ? lat : null,
    lng: both ? lng : null,
    z: both ? inRange(one(query.z), MIN_ZOOM, MAX_ZOOM) : null,
    radius,
    lineage: lineageText && UUID.test(lineageText) ? lineageText.toLowerCase() : null,
    view: one(query.view) === 'list' ? 'list' : 'map',
  };
}

/** The search the address asks for: the centre is `near` (looked up by the page), else lat and lng with a radius. */
export function searchCenterOf(params: FinderParams): { lat: number; lng: number } | null {
  return params.radius !== null && params.lat !== null && params.lng !== null ? { lat: params.lat, lng: params.lng } : null;
}

/** /schools with these keys, in a fixed order; empty values are left out (the map view is the default). */
export function finderHref(params: Partial<FinderParams>): string {
  const search = new URLSearchParams();
  if (params.near) search.set('near', params.near);
  if (params.radius) search.set('radius', String(params.radius));
  if (params.lineage) search.set('lineage', params.lineage);
  if (params.view === 'list') search.set('view', 'list');
  if (params.lat !== null && params.lat !== undefined && params.lng !== null && params.lng !== undefined) {
    search.set('lat', roundCoordinate(params.lat));
    search.set('lng', roundCoordinate(params.lng));
    if (params.z !== null && params.z !== undefined) search.set('z', roundZoom(params.z));
  }
  const text = search.toString();
  return text ? `/schools?${text}` : '/schools';
}

/** Four decimals: about 11 m, enough for a map view (the address never carries a private point). */
export function roundCoordinate(n: number): string {
  return String(Math.round(n * 1e4) / 1e4);
}

export function roundZoom(n: number): string {
  return String(Math.round(Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, n)) * 100) / 100);
}

/**
 * The address with the map's view written into it (the island's replaceState). Without a search
 * centre (`searching` false) a radius in the address would turn the written view into one, so it
 * is dropped: a reload shows what the page shows now.
 */
export function withView(href: string, view: { lat: number; lng: number; zoom: number }, searching = true): string {
  const url = new URL(href, 'http://finder.invalid');
  if (!searching) url.searchParams.delete('radius');
  // Longitude wraps when the map is panned round the world.
  const lng = ((((view.lng + 180) % 360) + 360) % 360) - 180;
  url.searchParams.set('lat', roundCoordinate(Math.max(-90, Math.min(90, view.lat))));
  url.searchParams.set('lng', roundCoordinate(lng));
  url.searchParams.set('z', roundZoom(view.zoom));
  return `${url.pathname}${url.search}${url.hash}`;
}

/** The bounds [west, south, east, north] of a circle of `radiusKm` around `center` (the map's first view of a search). */
export function circleBounds(center: { lat: number; lng: number }, radiusKm: number): [number, number, number, number] {
  const dLat = radiusKm / 111.32;
  const cos = Math.max(0.01, Math.cos((center.lat * Math.PI) / 180));
  const dLng = Math.min(180, radiusKm / (111.32 * cos));
  return [Math.max(-180, center.lng - dLng), Math.max(-90, center.lat - dLat), Math.min(180, center.lng + dLng), Math.min(90, center.lat + dLat)];
}

/** The great-circle distance in km (the "Search this area" button: has the view left the search?). */
export function distanceKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371.0088 * Math.asin(Math.min(1, Math.sqrt(h)));
}
