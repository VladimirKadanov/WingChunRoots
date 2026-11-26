// The form of "My city is missing" and its page (role replay 2026-11-25, P2-12).

export const MISSING_PLACE_FORM = 'missing-place';
export const MISSING_PLACE_PAGE = '/dashboard/places/missing';

/** The page, with the form the member came from as `next`. */
export function missingPlacePage(next: string): string {
  return next ? `${MISSING_PLACE_PAGE}?${new URLSearchParams({ next })}` : MISSING_PLACE_PAGE;
}
