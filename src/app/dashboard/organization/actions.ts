'use server';

// The Server Actions of an organization's dashboard (milestone M15): thin wrappers over
// organizations.apply, update, addAdmin, removeAdmin, addMember, endMember, requestSchool and
// endSchoolLink (src/server/rpc/parity.ts), called in-process with this request's session, so the
// forms and /api/v1 run the same checks: the services decide who may do what. A failure comes back
// to the form (without JavaScript as a kept result, src/server/forms/flash.ts); a success goes to
// the organization's page with what happened (?done=…), opened at the outcome note.
//
// The supporting document of an application is uploaded by the evidence field to
// POST /api/evidence/upload first, and removed with the M10a action (evidence.discard).

import { headers } from 'next/headers';
import { redirect, unstable_rethrow } from 'next/navigation';

import { atOutcome } from '@/components/relationships/outcome-id';
import { textValue } from '@/lib/form-data';
import { type FormState, outcomeTarget } from '@/lib/form-state';
import { getRequestPrincipal } from '@/server/auth/web';
import { formResult } from '@/server/forms/flash';
import { formStateFromFailure, rpcErrorCode } from '@/server/rpc/form';
import { serverClient } from '@/server/rpc/server';
import { ADD_ADMIN_FORM, ADD_MEMBER_FORM, APPLY_FORM, DETAILS_FORM, REQUEST_SCHOOL_FORM, rowForm } from './form-ids';

const HOME = '/dashboard/organization';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KEY = /^[A-Za-z0-9_-]{8,64}$/;

const pageOf = (id: string) => (UUID.test(id) ? `${HOME}/${id}` : HOME);

async function client() {
  return serverClient(await headers(), await getRequestPrincipal());
}

function signInAgain(next: string): never {
  redirect(`/sign-in?next=${encodeURIComponent(next)}`);
}

/** The organization fields of the application and details forms, as the procedures take them. */
function readFields(form: FormData) {
  const values: Record<string, string> = {};
  for (const [name, max] of [
    ['name', 400],
    ['kind', 40],
    ['leaderName', 300],
    ['leaderTitle', 200],
    ['websiteUrl', 700],
    ['countryCode', 8],
    ['schoolsEstimate', 12],
  ] as const) {
    const value = textValue(form, name, max);
    if (value) values[name] = value;
  }
  const estimate = values.schoolsEstimate ?? '';
  return {
    input: {
      name: values.name ?? '',
      kind: (values.kind ?? '') as 'federation',
      leaderName: values.leaderName ?? '',
      leaderTitle: values.leaderTitle ?? null,
      websiteUrl: values.websiteUrl ?? null,
      countryCode: values.countryCode ?? '',
      // A number the procedure checks; anything else is refused there with the field's message.
      schoolsEstimate: (/^\d{1,9}$/.test(estimate) ? Number(estimate) : estimate) as number,
    },
    values,
  };
}

/** A refusal shown at the form; UNAUTHORIZED goes to sign in and back. */
async function failed(error: unknown, formId: string, page: string, values: Record<string, string>, single = false): Promise<FormState> {
  unstable_rethrow(error);
  if (rpcErrorCode(error) === 'UNAUTHORIZED') signInAgain(page);
  const state = formStateFromFailure(error, values);
  return formResult({ form: formId, page, anchor: outcomeTarget(formId, state, single) }, state);
}

/** "Send the application" of /dashboard/organization/apply (organizations.apply). */
export async function applyOrganizationAction(_previous: FormState, form: FormData): Promise<FormState> {
  const page = `${HOME}/apply`;
  const { input, values } = readFields(form);
  const note = textValue(form, 'note', 4000);
  const key = textValue(form, 'idempotencyKey', 64);
  const evidenceIds = form
    .getAll('evidenceIds')
    .filter((v): v is string => typeof v === 'string' && UUID.test(v))
    .slice(0, 20);
  Object.assign(values, {
    note,
    idempotencyKey: key,
    evidence: JSON.stringify(
      evidenceIds.map((id) => ({ id, name: textValue(form, `evidenceName.${id}`, 200), kindLabel: textValue(form, `evidenceKind.${id}`, 40), sizeBytes: Number(textValue(form, `evidenceSize.${id}`, 12)) || 0 })),
    ),
  });
  let organizationId: string;
  try {
    const result = await (await client()).organizations.apply({ ...input, evidenceIds, note: note || null, idempotencyKey: KEY.test(key) ? key : '' });
    organizationId = result.organizationId;
  } catch (error) {
    return failed(error, APPLY_FORM, page, values);
  }
  redirect(atOutcome(`${pageOf(organizationId)}?done=applied`));
}

/** "Save" of the details form (organizations.update). */
export async function updateOrganizationAction(_previous: FormState, form: FormData): Promise<FormState> {
  const organizationId = textValue(form, 'organizationId', 40);
  const page = pageOf(organizationId);
  const { input, values } = readFields(form);
  try {
    await (await client()).organizations.update({ ...input, organizationId });
  } catch (error) {
    return failed(error, DETAILS_FORM, page, values);
  }
  redirect(atOutcome(`${page}?done=saved`));
}

/** "Add admin" (organizations.addAdmin). */
export async function addOrganizationAdminAction(_previous: FormState, form: FormData): Promise<FormState> {
  const organizationId = textValue(form, 'organizationId', 40);
  const page = pageOf(organizationId);
  const email = textValue(form, 'email', 400);
  try {
    await (await client()).organizations.addAdmin({ organizationId, email });
  } catch (error) {
    return failed(error, ADD_ADMIN_FORM, page, { email }, true);
  }
  redirect(atOutcome(`${page}?done=admin-added`));
}

/** "Remove" an admin, or "Leave" (organizations.removeAdmin). */
export async function removeOrganizationAdminAction(_previous: FormState, form: FormData): Promise<FormState> {
  const organizationId = textValue(form, 'organizationId', 40);
  const adminId = textValue(form, 'adminId', 40);
  const page = pageOf(organizationId);
  let leftYourself = false;
  try {
    await (await client()).organizations.removeAdmin({ organizationId, adminId });
    leftYourself = textValue(form, 'self', 4) === '1';
  } catch (error) {
    return failed(error, rowForm('admin', adminId), page, {}, true);
  }
  redirect(leftYourself ? atOutcome(`${HOME}?done=left`) : atOutcome(`${page}?done=admin-removed`));
}

/** "Add member" (organizations.addMember). */
export async function addOrganizationMemberAction(_previous: FormState, form: FormData): Promise<FormState> {
  const organizationId = textValue(form, 'organizationId', 40);
  const page = pageOf(organizationId);
  const values = { personSlug: textValue(form, 'personSlug', 400), role: textValue(form, 'role', 20), startsOn: textValue(form, 'startsOn', 16) };
  try {
    await (await client()).organizations.addMember({ organizationId, personSlug: values.personSlug, role: (values.role || 'member') as 'member', startsOn: values.startsOn || null });
  } catch (error) {
    return failed(error, ADD_MEMBER_FORM, page, values);
  }
  redirect(atOutcome(`${page}?done=member-added`));
}

/** "End membership" (organizations.endMember). */
export async function endOrganizationMemberAction(_previous: FormState, form: FormData): Promise<FormState> {
  const organizationId = textValue(form, 'organizationId', 40);
  const membershipId = textValue(form, 'membershipId', 40);
  const page = pageOf(organizationId);
  try {
    await (await client()).organizations.endMember({ organizationId, membershipId });
  } catch (error) {
    return failed(error, rowForm('member', membershipId), page, {}, true);
  }
  redirect(atOutcome(`${page}?done=member-ended`));
}

/** "Ask the school" (organizations.requestSchool). */
export async function requestOrganizationSchoolAction(_previous: FormState, form: FormData): Promise<FormState> {
  const organizationId = textValue(form, 'organizationId', 40);
  const page = pageOf(organizationId);
  const schoolSlug = textValue(form, 'schoolSlug', 400);
  try {
    await (await client()).organizations.requestSchool({ organizationId, schoolSlug });
  } catch (error) {
    return failed(error, REQUEST_SCHOOL_FORM, page, { schoolSlug }, true);
  }
  redirect(atOutcome(`${page}?done=school-requested`));
}

/** "Withdraw" or "End link" from the organization's side (organizations.endSchoolLink). */
export async function endOrganizationSchoolAction(_previous: FormState, form: FormData): Promise<FormState> {
  const organizationId = textValue(form, 'organizationId', 40);
  const linkId = textValue(form, 'linkId', 40);
  const page = pageOf(organizationId);
  try {
    await (await client()).organizations.endSchoolLink({ linkId });
  } catch (error) {
    return failed(error, rowForm('school', linkId), page, {}, true);
  }
  redirect(atOutcome(`${page}?done=school-ended`));
}
