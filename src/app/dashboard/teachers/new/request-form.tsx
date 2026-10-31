'use client';

// The request form of /dashboard/teachers/new (milestone M09, In scope 1): the teacher, chosen with
// the search palette in select mode (people only, any spelling, public profiles); the lineage
// (optional: the teacher's own when left empty); one or more training periods, each with a start
// (a year, or a year and a month), an end or "I still train with this teacher", and a school
// (optional); and the wish that this teacher be drawn as the main line (DEFAULT D05, visual only).
//
// The same form corrects a declined request and sends it again (`relationshipId`): the teacher is
// fixed then. A plain form (no form library: the route's JavaScript stays inside the budget of
// plan §5.8 (c); docs/plan/questions/M09.md), posted to a thin Server Action over
// relationships.request or relationships.resubmit with an idempotency key the page made for it, so
// a double press or a retried post sends one request.
//
// Without JavaScript the palette cannot open: the page offers a search form of its own above this
// one (`<noscript>`), whose results choose the teacher through the address (?teacher=<slug>).

import { lazy, Suspense, useActionState, useRef, useState } from 'react';

import { CheckboxField, FormMessage, SelectField, SubmitButton, TextField, useFocusOnError, useFormId } from '@/components/account/fields';
import { NameText } from '@/components/account/person-names';
import { SearchIcon } from '@/components/icons';
import { buttonVariants } from '@/components/ui/button-variants';
import type { PersonHit } from '@/components/ui/search-palette';
import { cx } from '@/lib/cx';
import { fieldId, type FormState } from '@/lib/form-state';
import { REQUEST_FORM } from '../form-ids';
import { requestTeacherAction, resubmitRequestAction } from '../actions';

const loadPalette = () => import('@/components/ui/search-palette');
const SearchPalette = lazy(loadPalette);

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export interface RequestFormOptions {
  lineages: { id: string; name: string }[];
  schools: { id: string; name: string; city: string; countryCode: string }[];
  earliestYear: number;
  maxPeriods: number;
}

/** The chosen teacher as the form shows it: the display name with its language, and where. */
interface ChosenTeacher {
  id: string;
  name: string;
  lang: string;
  where: string;
}

const regions = typeof Intl.DisplayNames === 'function' ? new Intl.DisplayNames(['en'], { type: 'region' }) : null;

function whereOf(hit: PersonHit): string {
  const country = hit.countryCode ? (regions?.of(hit.countryCode) ?? hit.countryCode) : null;
  return [hit.city, country, hit.lineageName].filter(Boolean).join(' · ');
}

function teacherFrom(values: Record<string, string> | undefined): ChosenTeacher | null {
  if (!values?.teacherId || !values.teacherName) return null;
  return { id: values.teacherId, name: values.teacherName, lang: values.teacherLang || 'und', where: values.teacherWhere ?? '' };
}

const SELECTS = ['fromMonth', 'toMonth', 'schoolId'] as const;

function MonthOptions({ none }: { none: string }) {
  return (
    <>
      <option value="">{none}</option>
      {MONTHS.map((month, index) => (
        <option key={month} value={String(index + 1)}>
          {month}
        </option>
      ))}
    </>
  );
}

export function RequestForm({
  options,
  relationshipId,
  fixedTeacher,
  prefill,
  idempotencyKey,
  initial,
}: {
  options: RequestFormOptions;
  /** Set when a declined request is corrected and sent again: the teacher cannot change. */
  relationshipId?: string;
  /** The teacher of a request sent again: shown, never sent (the procedure keeps it). */
  fixedTeacher?: { name: string; lang: string; where: string };
  /** The values the form starts with: a chosen teacher (?teacher=), or the declined request. */
  prefill: Record<string, string>;
  idempotencyKey: string;
  /** The outcome of a post without JavaScript (src/server/forms/flash.ts). */
  initial?: FormState | null;
}) {
  const resubmit = relationshipId !== undefined;
  const start: FormState = initial ?? { status: 'idle', values: prefill };
  const [state, action, pending] = useActionState(resubmit ? resubmitRequestAction : requestTeacherAction, start);
  const generatedId = useFormId(REQUEST_FORM);
  // The outcome of a post without JavaScript is opened at its summary or message (../form-ids.ts).
  const formId = initial ? REQUEST_FORM : generatedId;
  useFocusOnError(formId, state);

  const [teacher, setTeacher] = useState<ChosenTeacher | null>(() => teacherFrom(initial?.values ?? prefill));
  const [announce, setAnnounce] = useState('');
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteLoaded, setPaletteLoaded] = useState(false);
  const chooser = useRef<HTMLButtonElement>(null);
  const [count, setCount] = useState(() => Math.min(Math.max(Number((initial?.values ?? prefill).periodCount) || 1, 1), options.maxPeriods));
  // The selects are controlled: React resets the form after its action, which would drop a choice
  // made before a refused submit (finding H2 of M02).
  const [selects, setSelects] = useState<Record<string, string>>(() => {
    const start = initial?.values ?? prefill;
    const picked: Record<string, string> = { lineageId: start.lineageId ?? '' };
    for (let i = 0; i < options.maxPeriods; i += 1) for (const name of SELECTS) picked[`periods.${i}.${name}`] = start[`periods.${i}.${name}`] ?? '';
    return picked;
  });
  const select = (name: string) => ({ value: selects[name] ?? '', onValue: (value: string) => setSelects((current) => ({ ...current, [name]: value })) });

  const teacherError = state.status === 'error' ? state.fields?.teacherId : undefined;
  const teacherFieldId = fieldId(formId, 'teacherId');

  function choose(hit: PersonHit) {
    setTeacher({ id: hit.id, name: hit.displayName.value, lang: hit.displayName.lang, where: whereOf(hit) });
    setAnnounce(`Chosen: ${hit.displayName.value}.`);
    // The palette gives the focus back to where it was opened from: the chooser, now "Choose another teacher".
    requestAnimationFrame(() => chooser.current?.focus());
  }

  const labels: Record<string, string> = { teacherId: 'Teacher', lineageId: 'Lineage' };
  for (let i = 0; i < count; i += 1) {
    const n = count > 1 ? ` ${i + 1}` : '';
    labels[`periods.${i}.fromYear`] = `Period${n}, started`;
    labels[`periods.${i}.toYear`] = `Period${n}, ended`;
    labels[`periods.${i}.schoolId`] = `Period${n}, school`;
  }

  return (
    <form id={formId} action={action} noValidate aria-busy={pending || undefined} className="grid gap-8" data-testid="teacher-request-form">
      <FormMessage form={formId} state={state} labels={labels} />
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
      <input type="hidden" name="periodCount" value={String(count)} />
      {resubmit ? <input type="hidden" name="relationshipId" value={relationshipId} /> : null}

      {/* The teacher. */}
      <section aria-labelledby={`${formId}-teacher`} className="grid gap-3">
        <h2 id={`${formId}-teacher`} className="font-display text-2xl">
          Your teacher
        </h2>
        {resubmit && fixedTeacher ? (
          <p data-testid="chosen-teacher" className="grid gap-0.5">
            <NameText name={{ value: fixedTeacher.name, lang: fixedTeacher.lang }} className="font-display text-xl" />
            {fixedTeacher.where ? <span className="text-sm text-fg-muted">{fixedTeacher.where}</span> : null}
          </p>
        ) : (
          <div data-field="" className={cx('grid justify-items-start gap-2', teacherError && 'border-l-4 border-danger pl-3')}>
            {teacher ? (
              <>
                <input type="hidden" name="teacherId" value={teacher.id} />
                <input type="hidden" name="teacherName" value={teacher.name} />
                <input type="hidden" name="teacherLang" value={teacher.lang} />
                <input type="hidden" name="teacherWhere" value={teacher.where} />
                <p data-testid="chosen-teacher" className="grid gap-0.5">
                  <NameText name={{ value: teacher.name, lang: teacher.lang }} className="font-display text-xl" />
                  {teacher.where ? <span className="text-sm text-fg-muted">{teacher.where}</span> : null}
                </p>
              </>
            ) : (
              <p className="max-w-[56ch] text-ui text-fg-muted">
                Find your teacher by name, in any spelling. Only teachers with a public profile on WingChunRoots can confirm a request.
              </p>
            )}
            {teacherError ? (
              <p id={`${teacherFieldId}-error`} className="text-sm text-danger">
                {teacherError}
              </p>
            ) : null}
            <button
              ref={chooser}
              id={teacherFieldId}
              type="button"
              aria-haspopup="dialog"
              aria-describedby={teacherError ? `${teacherFieldId}-error` : undefined}
              onClick={() => {
                setPaletteLoaded(true);
                setPaletteOpen(true);
              }}
              onPointerEnter={() => void loadPalette()}
              onFocus={() => void loadPalette()}
              className={buttonVariants({ variant: teacher ? 'secondary' : 'ink' })}
            >
              <SearchIcon />
              {teacher ? 'Choose another teacher' : 'Find your teacher'}
            </button>
            <p role="status" className="sr-only">
              {announce}
            </p>
            {paletteLoaded ? (
              <Suspense fallback={null}>
                <SearchPalette open={paletteOpen} onOpenChange={setPaletteOpen} onSelect={choose} selectLabel="Choose your teacher" />
              </Suspense>
            ) : null}
          </div>
        )}
      </section>

      {/* The lineage. */}
      <section aria-labelledby={`${formId}-lineage`} className="grid gap-3">
        <h2 id={`${formId}-lineage`} className="font-display text-2xl">
          Lineage
        </h2>
        <SelectField
          form={formId}
          name="lineageId"
          label="Lineage of this training"
          optional
          autoComplete="off"
          hint="Leave it as the teacher’s own lineage unless you trained with them in another one."
          state={state}
          className="max-w-[34rem]"
          {...select('lineageId')}
        >
          <option value="">The teacher’s own lineage</option>
          {options.lineages.map((lineage) => (
            <option key={lineage.id} value={lineage.id}>
              {lineage.name}
            </option>
          ))}
        </SelectField>
      </section>

      {/* The periods. */}
      <section aria-labelledby={`${formId}-periods`} className="grid gap-4">
        <h2 id={`${formId}-periods`} className="font-display text-2xl">
          When you trained
        </h2>
        <p className="max-w-[60ch] text-sm text-fg-muted">
          Give the year you started, and the month if you remember it. If you trained with this teacher at different times, add a period for each.
        </p>
        {Array.from({ length: count }, (_, i) => {
          const name = (field: string) => `periods.${i}.${field}`;
          return (
            <fieldset key={i} data-testid="training-period" className="grid gap-4 rounded-sm border border-border-subtle p-4">
              <legend className="px-1 text-ui font-semibold">{count > 1 ? `Period ${i + 1}` : 'Training period'}</legend>
              <div className="grid grid-cols-[minmax(0,8rem)_minmax(0,1fr)] gap-3 sm:max-w-[30rem]">
                <TextField
                  form={formId}
                  name={name('fromYear')}
                  label="Started (year)"
                  autoComplete="off"
                  inputMode="numeric"
                  maxLength={4}
                  state={state}
                />
                <SelectField form={formId} name={name('fromMonth')} label="Month" optional autoComplete="off" state={state} {...select(name('fromMonth'))}>
                  <MonthOptions none="Not sure" />
                </SelectField>
              </div>
              <CheckboxField form={formId} name={name('ongoing')} label="I still train with this teacher" state={state} />
              <div className="grid grid-cols-[minmax(0,8rem)_minmax(0,1fr)] gap-3 sm:max-w-[30rem]">
                <TextField
                  form={formId}
                  name={name('toYear')}
                  label="Ended (year)"
                  optional
                  autoComplete="off"
                  inputMode="numeric"
                  maxLength={4}
                  state={state}
                />
                <SelectField form={formId} name={name('toMonth')} label="Month" optional autoComplete="off" state={state} {...select(name('toMonth'))}>
                  <MonthOptions none="Not sure" />
                </SelectField>
              </div>
              <p className="-mt-2 text-sm text-fg-muted">Leave the end empty when you still train with this teacher.</p>
              <SelectField
                form={formId}
                name={name('schoolId')}
                label="School"
                optional
                autoComplete="off"
                state={state}
                className="sm:max-w-[30rem]"
                {...select(name('schoolId'))}
              >
                <option value="">No school, or not listed</option>
                {options.schools.map((school) => (
                  <option key={school.id} value={school.id}>
                    {school.name} ({school.city})
                  </option>
                ))}
              </SelectField>
            </fieldset>
          );
        })}
        <div className="flex flex-wrap gap-3">
          {count < options.maxPeriods ? (
            <button type="button" onClick={() => setCount(count + 1)} className={buttonVariants({ variant: 'secondary' })}>
              Add another period
            </button>
          ) : null}
          {count > 1 ? (
            <button type="button" onClick={() => setCount(count - 1)} className={buttonVariants({ variant: 'ghost' })}>
              Remove period {count}
            </button>
          ) : null}
        </div>
      </section>

      {/* How the lineage is drawn (DEFAULT D05). */}
      <section aria-labelledby={`${formId}-display`} className="grid gap-2">
        <h2 id={`${formId}-display`} className="font-display text-2xl">
          How your lineage is drawn
        </h2>
        <CheckboxField
          form={formId}
          name="displayPrimary"
          label="Draw this teacher as my main line"
          hint="Only changes how the lineage is drawn once the teacher confirms. Every confirmed teacher stays on your profile."
          state={state}
        />
      </section>

      <div className="grid gap-3">
        <p className="max-w-[60ch] text-sm text-fg-muted">
          Until the teacher answers, only you, the teacher and the reviewers see this request. When the teacher confirms it, the link is shown publicly,
          and so are both profiles, unless you have withdrawn your consent to be shown publicly.
        </p>
        <div>
          <SubmitButton pending={pending} pendingLabel="Sending…">
            {resubmit ? 'Send the request again' : 'Send the request'}
          </SubmitButton>
        </div>
      </div>
    </form>
  );
}
