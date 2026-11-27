// The form of "My lineage is not listed" and its page (journey review 2026-11-26, P2-2).

export const MISSING_LINEAGE_FORM = 'missing-lineage';
export const MISSING_LINEAGE_PAGE = '/dashboard/lineages/missing';

/** The page, with the form the member came from as `next`. */
export function missingLineagePage(next: string): string {
  return next ? `${MISSING_LINEAGE_PAGE}?${new URLSearchParams({ next })}` : MISSING_LINEAGE_PAGE;
}
