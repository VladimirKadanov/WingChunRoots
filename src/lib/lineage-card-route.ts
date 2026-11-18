// The route a lineage card shows (ADR 0045): `?route=N` (1-based) when it names one of the card's
// routes, otherwise the longest. Pure, shared by the page and the share image.

/** The routes of a card, as lineage.paths gives them (earliest teacher first in each). */
interface Routes {
  paths: { personIds: readonly string[] }[];
}

/**
 * The route a card shows first: the longest (the most generations), then the order lineage.paths
 * gives (primary teachers first). -1 when there is no route.
 */
export function longestRoute(routes: Routes): number {
  let best = -1;
  routes.paths.forEach((route, i) => {
    if (best === -1 || route.personIds.length > routes.paths[best]!.personIds.length) best = i;
  });
  return best;
}

export function chosenRoute(card: { paths: Routes }, value: string | string[] | undefined): number {
  const raw = Array.isArray(value) ? value[0] : value;
  const n = raw && /^\d{1,2}$/.test(raw) ? Number(raw) - 1 : -1;
  if (n >= 0 && n < card.paths.paths.length) return n;
  return longestRoute(card.paths);
}
