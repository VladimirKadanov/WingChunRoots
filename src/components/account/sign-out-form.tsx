'use client';

// The account page's sign-out (milestone M02; M07): the same thin Server Action, and before it the
// browser forgets the search palette's recent searches (src/lib/recent-searches.ts) and the open
// palette's state: the shell stays mounted through the soft navigation to /sign-in, so the host
// unmounts the palette (SEARCH_RESET_EVENT).

import { buttonVariants } from '@/components/ui/button-variants';
import { SEARCH_RESET_EVENT, writeRecentSearches } from '@/lib/recent-searches';

function forgetSearches() {
  writeRecentSearches([]);
  window.dispatchEvent(new Event(SEARCH_RESET_EVENT));
}

export function SignOutForm({ action }: { action: () => Promise<void> }) {
  return (
    <form action={action} onSubmit={forgetSearches}>
      <button type="submit" className={buttonVariants({ variant: 'ghost' })}>
        Sign out
      </button>
    </form>
  );
}
