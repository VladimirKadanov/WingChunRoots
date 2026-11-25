// "Is there a profile of you already?" on /onboarding (ADR 0056): a teacher whose students named
// them before they joined, or a member the archive recorded, has a public profile nobody has
// claimed. Setting up a new profile next to it would leave two records of one person, and the
// account could claim neither afterwards (one profile per account). So the page offers a plain GET
// search (`?find=`, no JavaScript needed) first; its results are the public records nobody has
// claimed (search.query, `invitable`), each with a link to the claim page (ADR 0040).

import Link from 'next/link';

import { NameText } from '@/components/account/person-names';
import { buttonVariants } from '@/components/ui/button-variants';
import { placeLine } from '@/lib/regions';

export interface FindYourselfHit {
  id: string;
  slug: string;
  displayName: { value: string; lang: string };
  city: string | null;
  countryCode: string | null;
  lineageName: string | null;
}

export function FindYourself({ action, next, find, hits }: { action: string; next: string | null; find: string; hits: FindYourselfHit[] | null }) {
  return (
    <details open={find !== '' || undefined} className="mb-8 rounded-sm border border-border-subtle p-4" data-testid="onboarding-find-yourself">
      <summary className="flex min-h-11 cursor-pointer items-center text-ui font-semibold">Is there a profile of you already?</summary>
      <div className="mt-3 grid gap-3">
        <p className="max-w-[60ch] text-sm text-fg-muted">
          If your students named you before you joined, or the archive records you, claim that profile instead of setting up a new one. Reviewers check the claim.
        </p>
        <form method="get" action={action} role="search" className="grid gap-3">
          {next ? <input type="hidden" name="next" value={next} /> : null}
          <label htmlFor="onboarding-find" className="text-sm font-semibold">
            Your name
          </label>
          <input
            id="onboarding-find"
            name="find"
            defaultValue={find}
            autoComplete="off"
            maxLength={100}
            className="block min-h-12 w-full rounded-sm border border-border-strong bg-surface-1 px-4 text-field text-fg"
          />
          <div>
            <button type="submit" className={buttonVariants({ variant: 'secondary' })}>
              Look for my profile
            </button>
          </div>
        </form>
        {hits ? (
          hits.length === 0 ? (
            <p role="status" className="text-sm text-fg-muted">
              No profile waiting to be claimed matches that name. Set up your own below.
            </p>
          ) : (
            <ul className="grid gap-2" aria-label="Profiles nobody has claimed yet">
              {hits.map((hit) => (
                <li key={hit.id} className="grid gap-1 rounded-sm bg-surface-2 p-3">
                  <span className="grid gap-0.5">
                    <NameText name={hit.displayName} className="font-display text-lg" />
                    <span className="text-sm text-fg-muted">{placeLine({ city: hit.city, countryCode: hit.countryCode, lineage: hit.lineageName })}</span>
                  </span>
                  <span className="flex flex-wrap gap-x-4">
                    <Link href={`/people/${hit.slug}/claim`} className="link inline-flex min-h-11 items-center font-semibold">
                      This is me: ask to claim it
                    </Link>
                    <Link href={`/people/${hit.slug}`} className="link inline-flex min-h-11 items-center">
                      See the profile
                    </Link>
                  </span>
                </li>
              ))}
            </ul>
          )
        ) : null}
      </div>
    </details>
  );
}
