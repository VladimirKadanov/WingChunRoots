// The school finder's "no results" (milestone M11), with the next step for an instructor: list a
// school. Shared by the list without JavaScript (/schools?view=list) and the map view's island.

import Link from 'next/link';

export function SchoolEmpty() {
  return (
    <div className="grid gap-1 py-4" data-testid="school-empty">
      <p className="text-fg-muted">No public school matches this search. Try a larger radius, another place or all lineages.</p>
      <p className="text-sm text-fg-muted">
        Teach Wing Chun?{' '}
        <Link href="/dashboard/schools/new" prefetch={false} className="link inline-flex min-h-11 items-center">
          List your school
        </Link>
      </p>
    </div>
  );
}
