// "Directions" (role replay 2026-11-25, P2-9; docs/adr/0062-event-how-to-join.md). A plain link,
// never a script, a frame or a pop-up: the Google Maps URLs open the maps app on Android and iOS
// and the maps site on a computer (DEFAULT, no D number: a widely installed app, recorded in the
// ADR). The link carries only what the page already shows publicly.

const BASE = 'https://www.google.com/maps';

/** A search for a public place line ("Demo hall, Sofia, Bulgaria"). */
export function mapsSearchHref(query: string): string {
  return `${BASE}/search/?api=1&query=${encodeURIComponent(query)}`;
}

/** Directions to a public point: only for a school whose owner chose the exact location. */
export function mapsDirectionsHref(point: { lat: number; lng: number }): string {
  return `${BASE}/dir/?api=1&destination=${point.lat},${point.lng}`;
}
