// Where a person is, as the pages write it (M09 review, screens-8): the English name of an ISO
// 3166-1 region code ("United Kingdom" for "GB") through Intl.DisplayNames, or the code itself
// where the runtime knows no name for it. Pure, so a server page and a client island describe the
// same teacher the same way (the request form's palette choice, its ?teacher= start and the search
// results of its form without JavaScript).

const regions = typeof Intl !== 'undefined' && typeof Intl.DisplayNames === 'function' ? new Intl.DisplayNames(['en'], { type: 'region', fallback: 'code' }) : null;

/** The country's English name; null without a code. */
export function countryName(code: string | null | undefined): string | null {
  if (!code) return null;
  try {
    return regions?.of(code) ?? code;
  } catch {
    // Not a region code at all (a RangeError): shown as it is.
    return code;
  }
}

/** "Sofia · Bulgaria · Demo Lineage A": the city, the country and the lineage that are known. */
export function placeLine({ city, countryCode, lineage }: { city?: string | null; countryCode?: string | null; lineage?: string | null }): string {
  return [city, countryName(countryCode), lineage].filter(Boolean).join(' · ');
}
