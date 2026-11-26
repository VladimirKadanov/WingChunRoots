// "My city is missing" (role replay 2026-11-25, P2-12): the link under a form's city field, with
// and without JavaScript. Its own module, so a form's first JavaScript holds only this link and
// not the type-ahead (./lazy-city-field).

import Link from 'next/link';

/** "My city is missing": the page that tells the admins, back to this form afterwards. */
export function MissingCityLink({ next, countryCode }: { next: string; countryCode?: string | null }) {
  const search = new URLSearchParams({ next, ...(countryCode ? { country: countryCode } : {}) });
  return (
    <Link href={`/dashboard/places/missing?${search}`} className="link inline-flex min-h-11 items-center text-sm" data-testid="missing-city-link">
      My city is missing
    </Link>
  );
}
