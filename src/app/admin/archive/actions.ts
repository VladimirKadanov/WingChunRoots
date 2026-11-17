'use server';

// The Server Actions of the archive editor (milestone M26, docs/adr/0034-archive-editor.md): thin
// wrappers over archiveEditor.createLineage, archiveEditor.updateLineage, archiveEditor.createRecord,
// archiveEditor.addLink and archiveEditor.endLink (src/server/rpc/parity.ts), called in-process with
// this request's session, so the forms and /api/v1 run the same checks (an archivist or an
// administrator with a verified second factor). A failure comes back to its form; success opens the
// page at its outcome note (#outcome), which takes the focus.

import { randomBytes } from 'node:crypto';

import { headers } from 'next/headers';
import { redirect, unstable_rethrow } from 'next/navigation';

import { atOutcome } from '@/components/relationships/outcome-id';
import { keepValues, textValue } from '@/lib/form-data';
import { type FormState, outcomeTarget } from '@/lib/form-state';
import { getRequestPrincipal } from '@/server/auth/web';
import { formResult } from '@/server/forms/flash';
import { formStateFromFailure, rpcErrorCode } from '@/server/rpc/form';
import { serverClient } from '@/server/rpc/server';
import { LINEAGE_CREATE_FORM, LINEAGE_EDIT_FORM, LINK_ADD_FORM, LINK_END_FORM, RECORD_CREATE_FORM } from './form-ids';

const HOME = '/admin/archive';
const PEOPLE = '/admin/archive/people';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KEY = /^[A-Za-z0-9_-]{8,64}$/;
const SLUG = /^[a-z0-9-]{1,120}$/;

const lineagePage = (slug: string) => (SLUG.test(slug) ? `${HOME}/lineages/${slug}` : HOME);
const doneAt = (page: string, done: string, extra = '') => atOutcome(`${page}?done=${done}${extra}&n=${randomBytes(6).toString('base64url')}`);
const key = (form: FormData) => {
  const value = textValue(form, 'idempotencyKey', 64);
  return KEY.test(value) ? value : '';
};
const files = (form: FormData) =>
  form
    .getAll('evidenceIds')
    .filter((v): v is string => typeof v === 'string' && UUID.test(v))
    .slice(0, 20);

async function client() {
  return serverClient(await headers(), await getRequestPrincipal());
}

/** A session that ended goes to sign in; one that lost its second-factor check goes to prove it. */
function sendAway(error: unknown, page: string): void {
  if (rpcErrorCode(error) === 'UNAUTHORIZED') redirect(`/sign-in?next=${encodeURIComponent(page)}`);
  if (rpcErrorCode(error) === 'SECOND_FACTOR_REQUIRED') redirect(`/account/security?next=${encodeURIComponent(page)}`);
}

/** "Create the lineage" (archiveEditor.createLineage). Success opens the new lineage's page. */
export async function createLineageAction(_previous: FormState, form: FormData): Promise<FormState> {
  const values = keepValues(form, ['name', 'description', 'rootSlug', 'reason']);
  let slug: string;
  try {
    const result = await (await client()).archiveEditor.createLineage({
      name: textValue(form, 'name', 300),
      description: textValue(form, 'description', 4000) || null,
      rootSlug: textValue(form, 'rootSlug', 200) || null,
      reason: textValue(form, 'reason', 4000),
    });
    slug = result.slug;
  } catch (error) {
    unstable_rethrow(error);
    sendAway(error, HOME);
    const state = formStateFromFailure(error, values);
    return formResult({ form: LINEAGE_CREATE_FORM, page: HOME, anchor: outcomeTarget(LINEAGE_CREATE_FORM, state, false) }, state);
  }
  redirect(doneAt(lineagePage(slug), 'created'));
}

/** "Save the lineage" (archiveEditor.updateLineage). */
export async function updateLineageAction(_previous: FormState, form: FormData): Promise<FormState> {
  const values = keepValues(form, ['lineageId', 'slug', 'name', 'description', 'rootSlug', 'reason']);
  const page = lineagePage(textValue(form, 'slug', 200));
  let changed = false;
  try {
    const result = await (await client()).archiveEditor.updateLineage({
      lineageId: textValue(form, 'lineageId', 40),
      name: textValue(form, 'name', 300),
      description: textValue(form, 'description', 4000) || null,
      rootSlug: textValue(form, 'rootSlug', 200) || null,
      reason: textValue(form, 'reason', 4000),
    });
    changed = result.changed;
  } catch (error) {
    unstable_rethrow(error);
    sendAway(error, page);
    const state = formStateFromFailure(error, values);
    return formResult({ form: LINEAGE_EDIT_FORM, page, anchor: outcomeTarget(LINEAGE_EDIT_FORM, state, false) }, state);
  }
  redirect(doneAt(page, changed ? 'saved' : 'unchanged'));
}

/** "Create the record" (archiveEditor.createRecord). Success names the new record on the editor's page. */
export async function createRecordAction(_previous: FormState, form: FormData): Promise<FormState> {
  const values = keepValues(form, ['primaryName', 'originalName', 'originalLang', 'jyutping', 'pinyin', 'lifeStatus', 'bio', 'reason', 'back']);
  // The lineage page the form was opened from, to go back to with the new record chosen.
  const back = textValue(form, 'back', 200);
  let slug: string;
  try {
    const result = await (await client()).archiveEditor.createRecord({
      primaryName: textValue(form, 'primaryName', 300),
      originalName: textValue(form, 'originalName', 300) || null,
      originalLang: textValue(form, 'originalLang', 16) || null,
      jyutping: textValue(form, 'jyutping', 300) || null,
      pinyin: textValue(form, 'pinyin', 300) || null,
      lifeStatus: (textValue(form, 'lifeStatus', 20) || '') as 'deceased',
      bio: textValue(form, 'bio', 4000) || null,
      reason: textValue(form, 'reason', 4000),
      evidenceIds: files(form),
    });
    slug = result.slug;
  } catch (error) {
    unstable_rethrow(error);
    sendAway(error, PEOPLE);
    const state = formStateFromFailure(error, values);
    return formResult({ form: RECORD_CREATE_FORM, page: `${PEOPLE}?new=record`, anchor: outcomeTarget(RECORD_CREATE_FORM, state, false) }, state);
  }
  redirect(doneAt(PEOPLE, 'record', `&record=${slug}${SLUG.test(back) ? `&back=${back}` : ''}`));
}

/** "Add the link" (archiveEditor.addLink). */
export async function addLinkAction(_previous: FormState, form: FormData): Promise<FormState> {
  const values = keepValues(form, ['lineageId', 'slug', 'teacherSlug', 'studentSlug', 'fromYear', 'toYear', 'source', 'person']);
  const base = lineagePage(textValue(form, 'slug', 200));
  // The person open in the outline's panel: the page comes back with them selected.
  const person = textValue(form, 'person', 200);
  const extra = SLUG.test(person) ? `&person=${person}` : '';
  const page = extra ? `${base}?${extra.slice(1)}` : base;
  let shown = false;
  try {
    const result = await (await client()).archiveEditor.addLink({
      lineageId: textValue(form, 'lineageId', 40),
      teacherSlug: textValue(form, 'teacherSlug', 200) || null,
      studentSlug: textValue(form, 'studentSlug', 200) || null,
      fromYear: textValue(form, 'fromYear', 8) || null,
      toYear: textValue(form, 'toYear', 8) || null,
      source: textValue(form, 'source', 4000),
      evidenceIds: files(form),
      idempotencyKey: key(form),
    });
    shown = result.shown;
  } catch (error) {
    unstable_rethrow(error);
    sendAway(error, page);
    const state = formStateFromFailure(error, values);
    return formResult({ form: LINK_ADD_FORM, page, anchor: outcomeTarget(LINK_ADD_FORM, state, false) }, state);
  }
  redirect(doneAt(base, shown ? 'linked' : 'linked-hidden', extra));
}

/** "End this link" (archiveEditor.endLink). */
export async function endLinkAction(_previous: FormState, form: FormData): Promise<FormState> {
  const relationshipId = textValue(form, 'relationshipId', 40);
  const values = keepValues(form, ['relationshipId', 'reason', 'view']);
  // From the links grid: back to it, with the link's panel open on a refusal.
  const slug = textValue(form, 'slug', 200);
  const base = textValue(form, 'view', 10) === 'links' && SLUG.test(slug) && UUID.test(relationshipId) ? `${lineagePage(slug)}/links` : lineagePage(slug);
  const page = base.endsWith('/links') ? `${base}?link=${relationshipId}` : base;
  try {
    await (await client()).archiveEditor.endLink({ relationshipId, reason: textValue(form, 'reason', 4000), idempotencyKey: key(form) });
  } catch (error) {
    unstable_rethrow(error);
    sendAway(error, page);
    const state = formStateFromFailure(error, values);
    return formResult({ form: LINK_END_FORM, page, anchor: outcomeTarget(`${LINK_END_FORM}-${relationshipId}`, state, true) }, state);
  }
  redirect(doneAt(base, 'ended'));
}
