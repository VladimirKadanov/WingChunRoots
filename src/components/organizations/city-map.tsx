// The cities of an organization's schools (ADR 0052): a small ink map of dots, one per city at the
// city's own centre (GeoNames, public data; never a school's point), sized by how many schools are
// there, with the cities named in a list beside it, so nothing depends on the drawing. Server-
// rendered SVG, no map library and no JavaScript.

import { cx } from '@/lib/cx';
import type { OrganizationPageDto } from '@/server/dto/organizations';

const W = 320;
const H = 200;
const PAD = 28;

type City = OrganizationPageDto['cities'][number];

/** Each city's place in the box: an equirectangular projection fitted to the cities, north up. */
export function placeCities(cities: readonly City[]): { city: City; x: number; y: number; r: number }[] {
  if (cities.length === 0) return [];
  const midLat = cities.reduce((sum, c) => sum + c.lat, 0) / cities.length;
  const k = Math.cos((midLat * Math.PI) / 180);
  const xs = cities.map((c) => c.lng * k);
  const ys = cities.map((c) => -c.lat);
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  // A span too small to scale (one city, or cities a few km apart) sits in the middle.
  const span = Math.max(maxX - minX, maxY - minY, 0.5);
  const scale = Math.min((W - 2 * PAD) / span, (H - 2 * PAD) / span);
  const cx0 = (minX + maxX) / 2;
  const cy0 = (minY + maxY) / 2;
  const most = Math.max(...cities.map((c) => c.schools));
  return cities.map((city, i) => ({
    city,
    x: Math.round((W / 2 + (xs[i]! - cx0) * scale) * 10) / 10,
    y: Math.round((H / 2 + (ys[i]! - cy0) * scale) * 10) / 10,
    r: 4 + Math.round((6 * city.schools) / most),
  }));
}

export function CityMap({ cities, className }: { cities: readonly City[]; className?: string }) {
  const placed = placeCities(cities);
  if (placed.length === 0) return null;
  return (
    <div className={cx('grid gap-3', className)} data-testid="organization-cities">
      <svg aria-hidden="true" focusable="false" viewBox={`0 0 ${W} ${H}`} className="block w-full rounded-sm border border-border-subtle bg-art-ground">
        {/* A faint graticule: the drawing is a diagram, not a map of the land. */}
        {[1, 2, 3].map((i) => (
          <line key={`h${i}`} x1="0" x2={W} y1={(H / 4) * i} y2={(H / 4) * i} stroke="var(--art-far)" strokeWidth="1" />
        ))}
        {[1, 2, 3, 4, 5].map((i) => (
          <line key={`v${i}`} y1="0" y2={H} x1={(W / 6) * i} x2={(W / 6) * i} stroke="var(--art-far)" strokeWidth="1" />
        ))}
        {placed.map(({ city, x, y, r }) => (
          <g key={`${city.countryCode}-${city.name}`}>
            <circle cx={x} cy={y} r={r + 4} fill="none" stroke="var(--art-line)" strokeWidth="1" />
            <circle cx={x} cy={y} r={r} fill="var(--art-ink)" />
          </g>
        ))}
      </svg>
      <ul className="grid gap-1 text-sm">
        {placed.map(({ city }) => (
          <li key={`${city.countryCode}-${city.name}`} className="flex items-baseline justify-between gap-3 border-b border-border-subtle py-1.5" data-testid="organization-city">
            <span>
              {city.name}, {city.countryCode}
            </span>
            <span className="text-fg-muted">{city.schools === 1 ? '1 school' : `${city.schools} schools`}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
