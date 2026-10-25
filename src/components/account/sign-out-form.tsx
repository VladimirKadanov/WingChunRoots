'use client';

// The account page's sign-out (milestone M02; M07): the same thin Server Action, and before it the
// browser forgets the search palette's recent searches (src/lib/recent-searches.ts).

import { buttonVariants } from '@/components/ui/button-variants';
import { writeRecentSearches } from '@/lib/recent-searches';

export function SignOutForm({ action }: { action: () => Promise<void> }) {
  return (
    <form action={action} onSubmit={() => writeRecentSearches([])}>
      <button type="submit" className={buttonVariants({ variant: 'ghost' })}>
        Sign out
      </button>
    </form>
  );
}
