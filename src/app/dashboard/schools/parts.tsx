// The parts of the school editor pages (milestone M11): the page frame and "Find a city or town",
// a GET form of its own (a form cannot sit inside the school form) whose matches the city select
// lists first. Server components: they work without JavaScript.

import Link from 'next/link';
import type { ReactNode } from 'react';

import { SearchIcon } from '@/components/icons';
import { fieldClassName } from '@/components/account/fields';
import { buttonVariants } from '@/components/ui/button-variants';
import { cx } from '@/lib/cx';

export function EditorShell({ title, lead, children }: { title: string; lead: ReactNode; children: ReactNode }) {
  return (
    <div className="mx-auto max-w-content px-page pt-6 pb-10 md:pt-11 md:pb-14">
      <div className="max-w-[46rem]">
        <p className="eyebrow">
          <Link href="/dashboard/schools" className="link inline-flex min-h-11 items-center">
            Your schools
          </Link>
        </p>
        <h1 className="mt-2 font-display text-feature [overflow-wrap:anywhere]">{title}</h1>
        <div className="mt-3 max-w-[60ch] text-ui text-fg-muted">{lead}</div>
        <div className="mt-8 grid gap-8">{children}</div>
      </div>
    </div>
  );
}

/** The answer for an address that is not one of the account's schools. */
export function SchoolNotFound() {
  return (
    <EditorShell title="School not found" lead="This school is not one you listed, or the address is mistyped.">
      <p>
        <Link href="/dashboard/schools" className={buttonVariants({ variant: 'secondary' })}>
          Your schools
        </Link>
      </p>
    </EditorShell>
  );
}

/** "Find a city or town": reloads the editor with ?city=, which puts the matches first in the city list. */
export function CitySearch({ action, query }: { action: string; query: string | null }) {
  return (
    <form method="get" action={action} role="search" aria-label="Find a city or town" className="grid gap-1.5 rounded-sm bg-surface-2 p-4" data-testid="city-search">
      <label htmlFor="school-city-search" className="text-sm font-semibold">
        Find a city or town
      </label>
      <p id="school-city-search-hint" className="text-sm text-fg-muted">
        Any spelling works: Sofia, София. The matches come first in the city list below.
      </p>
      <div className="flex gap-2">
        <input
          id="school-city-search"
          name="city"
          type="search"
          defaultValue={query ?? ''}
          maxLength={100}
          autoComplete="off"
          enterKeyHint="search"
          aria-describedby="school-city-search-hint"
          className={fieldClassName}
        />
        <button type="submit" className={cx(buttonVariants({ variant: 'secondary' }), 'min-h-12 shrink-0')}>
          <SearchIcon size={18} />
          Find
        </button>
      </div>
    </form>
  );
}
