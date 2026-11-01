// /dashboard/schools/new (milestone M11, In scope 2): a Sifu lists a school. It is saved as a draft
// that only they see (schools.create, a thin Server Action); the school's page in the dashboard then
// sends it for the listing review. "Find a city or town" first (?city=), since a form cannot hold
// another. Reads the session, so it renders per request.

import { randomUUID } from 'node:crypto';

import type { Metadata } from 'next';
import { headers } from 'next/headers';
import Link from 'next/link';

import { LoadError } from '@/components/account/load-error';
import { LOAD_ERRORS } from '@/components/account/load-error-text';
import { PageRedirect } from '@/components/account/page-redirect';
import { ArrowRightIcon } from '@/components/icons';
import { buttonVariants } from '@/components/ui/button-variants';
import { guardRoute } from '@/server/auth/web';
import { readFormResult } from '@/server/forms/flash';
import { mapStyles } from '@/server/geo/map-styles';
import { pageRead } from '@/server/rpc/form';
import { serverClient } from '@/server/rpc/server';
import { SCHOOL_FORM } from '../form-ids';
import { CitySearch, EditorShell } from '../parts';
import { SchoolForm } from '../school-form';

export const instant = false;

export const metadata: Metadata = {
  title: 'List a school',
  robots: { index: false },
};

const PAGE = '/dashboard/schools/new';

type Search = Promise<Record<string, string | string[] | undefined>>;

export default async function NewSchoolPage({ searchParams }: { searchParams: Search }) {
  const guard = await guardRoute(PAGE);
  if (guard.redirectTo) return <PageRedirect to={guard.redirectTo} />;
  if (guard.forbidden) return <PageRedirect to="/sign-in" />;
  const query = await searchParams;
  const city = typeof query.city === 'string' ? query.city.trim().slice(0, 100) || null : null;
  const client = serverClient(await headers(), guard.principal);
  const mine = await pageRead(client.schools.mine());
  if (!mine) return <LoadError {...LOAD_ERRORS.schools} retryHref={PAGE} />;
  const lead = 'A draft is seen only by you. Send it for review from its page; a moderator checks it before it is public.';

  if (mine.accountType !== 'sifu' || !mine.hasProfile) {
    return (
      <EditorShell title="List a school" lead={lead}>
        <div data-testid="school-needs-first" className="grid justify-items-start gap-3 rounded-sm border-l-4 border-fg bg-surface-2 px-4 py-4">
          <p className="text-ui">
            {mine.accountType !== 'sifu'
              ? 'Schools are listed from a Sifu account. Your account is a Student account.'
              : 'You are the head instructor of the schools you list, so your profile comes first.'}
          </p>
          <Link
            href={mine.accountType !== 'sifu' ? '/dashboard/settings' : `/onboarding?next=${encodeURIComponent(PAGE)}`}
            className={buttonVariants({ variant: 'secondary' })}
          >
            {mine.accountType !== 'sifu' ? 'Account type and plan' : 'Set up your profile'}
            <ArrowRightIcon />
          </Link>
        </div>
      </EditorShell>
    );
  }

  const [editor, initial] = await Promise.all([pageRead(client.schools.options({ city })), readFormResult(SCHOOL_FORM, query.outcome)]);
  if (!editor) return <LoadError {...LOAD_ERRORS.schools} retryHref={PAGE} />;
  return (
    <EditorShell title="List a school" lead={lead}>
      <CitySearch action={PAGE} query={city} />
      <SchoolForm
        school={null}
        places={editor.places}
        cityQuery={city}
        forms={editor.forms}
        instructorOptions={editor.instructorOptions}
        styles={mapStyles()}
        idempotencyKey={randomUUID()}
        initial={initial}
      />
    </EditorShell>
  );
}
