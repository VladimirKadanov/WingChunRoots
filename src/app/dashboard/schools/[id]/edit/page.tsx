// /dashboard/schools/[id]/edit (milestone M11, In scope 2): the school form for one of the Sifu's
// schools (schools.update, a thin Server Action). "Find a city or town" reloads this page with
// ?city=, whose matches the city list shows first. A save goes back to the school's page
// (?saved=1); a refusal stays here with the fields. Only the account that listed the school reaches
// it. Reads the session, so it renders per request.

import type { Metadata } from 'next';
import { headers } from 'next/headers';
import Link from 'next/link';

import { LoadError } from '@/components/account/load-error';
import { LOAD_ERRORS } from '@/components/account/load-error-text';
import { PageRedirect } from '@/components/account/page-redirect';
import { guardRoute } from '@/server/auth/web';
import { readFormResult } from '@/server/forms/flash';
import { mapStyles } from '@/server/geo/map-styles';
import { pageRead, rpcErrorCode } from '@/server/rpc/form';
import { serverClient } from '@/server/rpc/server';
import { SCHOOL_FORM } from '../../form-ids';
import { CitySearch, EditorShell, SchoolNotFound } from '../../parts';
import { SchoolForm } from '../../school-form';

export const instant = false;

export const metadata: Metadata = {
  title: 'Edit your school',
  robots: { index: false },
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Props = { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function SchoolEditPage({ params, searchParams }: Props) {
  const { id } = await params;
  const valid = UUID.test(id);
  const page = `/dashboard/schools/${valid ? id : ''}`;
  const guard = await guardRoute(valid ? `${page}/edit` : page);
  if (guard.redirectTo) return <PageRedirect to={guard.redirectTo} />;
  if (guard.forbidden) return <PageRedirect to="/sign-in" />;
  const query = await searchParams;
  const city = typeof query.city === 'string' ? query.city.trim().slice(0, 100) || null : null;
  const client = serverClient(await headers(), guard.principal);

  let missing = !valid;
  const editor = valid
    ? await pageRead(
        client.schools.edit({ id, city }).catch((error: unknown) => {
          if (rpcErrorCode(error) === 'NOT_FOUND' || rpcErrorCode(error) === 'BAD_REQUEST') {
            missing = true;
            return null;
          }
          throw error;
        }),
      )
    : null;
  if (missing || (editor && !editor.school)) return <SchoolNotFound />;
  if (!editor) return <LoadError {...LOAD_ERRORS.school} retryHref={`${page}/edit`} />;
  const school = editor.school!;
  const formOutcome = await readFormResult(SCHOOL_FORM, query.outcome);

  return (
    <EditorShell
      title={`Edit ${school.name}`}
      lead={
        <>
          {school.status === 'active' ? 'The school stays listed while you edit it; a saved change shows at once. ' : null}
          <Link href={page} className="link inline-flex min-h-11 items-center">
            Back to the listing
          </Link>
        </>
      }
    >
      <CitySearch action={`${page}/edit`} query={city} />
      <SchoolForm
        school={{
          id: school.id,
          name: school.name,
          placeId: school.placeId,
          locationPrivacy: school.locationPrivacy,
          point: school.point,
          websiteUrl: school.websiteUrl,
          contactEmail: school.contactEmail,
          contactPhone: school.contactPhone,
          description: school.description,
          formsTaught: school.formsTaught,
          instructorIds: school.instructorIds,
        }}
        places={editor.places}
        cityQuery={city}
        forms={editor.forms}
        instructorOptions={editor.instructorOptions}
        styles={mapStyles()}
        idempotencyKey={null}
        initial={formOutcome}
      />
    </EditorShell>
  );
}
