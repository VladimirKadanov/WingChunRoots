// ADR 0052: where each city of an organization's schools sits in the small ink diagram of its page.
// The server turns the cities' own centres (GeoNames, public) into positions in a unit square,
// fitted to the cities with north up (an equirectangular projection), so the public answer carries
// no coordinate at all: only where a dot goes in the drawing. Pure TypeScript, shared by the
// service and its tests.

export interface CityCentre {
  lat: number;
  lng: number;
}

/** A span smaller than this (one city, or cities a few km apart) is not stretched: they sit in the middle. */
const MIN_SPAN_DEGREES = 0.5;

/**
 * Each city's place in the unit square: `x` from west (0) to east (1), `y` from north (0) to south
 * (1), rounded to 0.001. The longer side of the cities' extent fills the square; the shorter one is
 * centred, so distances keep their proportions.
 */
export function cityDiagramPositions(cities: readonly CityCentre[]): { x: number; y: number }[] {
  if (cities.length === 0) return [];
  const midLat = cities.reduce((sum, c) => sum + c.lat, 0) / cities.length;
  const k = Math.cos((midLat * Math.PI) / 180);
  const xs = cities.map((c) => c.lng * k);
  const ys = cities.map((c) => -c.lat);
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const span = Math.max(maxX - minX, maxY - minY, MIN_SPAN_DEGREES);
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const round = (v: number) => Math.round(v * 1000) / 1000;
  return cities.map((_, i) => ({ x: round(0.5 + (xs[i]! - cx) / span), y: round(0.5 + (ys[i]! - cy) / span) }));
}
