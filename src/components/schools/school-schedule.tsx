// M21 (docs/adr/0024-trial-lessons.md): a school's weekly schedule and fees on its public page, and
// the trial lesson action. The times are wall-clock times in the zone of the school's city; "free
// first trial lesson" is said in words, never by a colour or an icon alone.

import Link from 'next/link';

import { buttonVariants } from '@/components/ui/button-variants';
import type { SchoolPageDto } from '@/server/dto/schools';
import type { TrialOptions } from '@/server/services/trial-lessons';

type Slot = SchoolPageDto['schedule'][number];

/** The slots by weekday, in the order of the week. */
function byDay(schedule: readonly Slot[]): { weekday: number; label: string; slots: Slot[] }[] {
  const days = new Map<number, { weekday: number; label: string; slots: Slot[] }>();
  for (const slot of schedule) {
    const day = days.get(slot.weekday) ?? { weekday: slot.weekday, label: slot.weekdayLabel, slots: [] };
    day.slots.push(slot);
    days.set(slot.weekday, day);
  }
  return [...days.values()].sort((a, b) => a.weekday - b.weekday);
}

/** The zone's own name, readable: "Europe/Sofia" as "Europe/Sofia time". */
function zoneLine(timezone: string): string {
  return timezone === 'UTC' ? 'Times are in UTC.' : `Times are local to the school (${timezone.replace(/_/g, ' ')}).`;
}

export function ScheduleAndFees({ school }: { school: Pick<SchoolPageDto, 'schedule' | 'timezone' | 'fees' | 'firstTrialFree'> }) {
  if (school.schedule.length === 0 && !school.fees && !school.firstTrialFree) return null;
  const days = byDay(school.schedule);
  return (
    <section aria-labelledby="school-schedule" data-testid="school-schedule">
      <h2 id="school-schedule" className="font-display text-xl">
        Schedule and fees
      </h2>
      {days.length > 0 ? (
        <>
          <table className="mt-3 w-full border-collapse text-left text-sm">
            <caption className="sr-only">Weekly class schedule</caption>
            <thead>
              <tr className="border-b border-border-strong text-fg-muted">
                <th scope="col" className="py-2 pr-4 font-normal">
                  Day
                </th>
                <th scope="col" className="py-2 pr-4 font-normal">
                  Time
                </th>
                <th scope="col" className="py-2 font-normal">
                  Class
                </th>
              </tr>
            </thead>
            <tbody>
              {days.flatMap((day) =>
                day.slots.map((slot, i) => (
                  <tr key={`${day.weekday}-${slot.startsAt}-${i}`} className="border-b border-border-subtle" data-testid="school-schedule-slot">
                    {i === 0 ? (
                      <th scope="row" rowSpan={day.slots.length} className="py-2 pr-4 align-top font-medium">
                        {day.label}
                      </th>
                    ) : null}
                    <td className="py-2 pr-4 whitespace-nowrap tabular-nums">
                      {slot.startsAt}–{slot.endsAt}
                    </td>
                    <td className="py-2 [overflow-wrap:anywhere]">{slot.label ?? '—'}</td>
                  </tr>
                )),
              )}
            </tbody>
          </table>
          <p className="mt-2 text-sm text-fg-muted">{zoneLine(school.timezone)}</p>
        </>
      ) : null}
      {school.firstTrialFree ? (
        <p className="mt-3 font-medium" data-testid="school-first-trial-free">
          The first trial lesson is free.
        </p>
      ) : null}
      {school.fees ? (
        <div className="mt-3">
          <h3 className="text-sm text-fg-muted">Fees</h3>
          <p className="mt-1 whitespace-pre-line [overflow-wrap:anywhere]" data-testid="school-fees">
            {school.fees}
          </p>
        </div>
      ) : null}
    </section>
  );
}

/** The trial lesson action of a public school page, by what trial.options says of this viewer. */
export function TrialAction({ slug, options }: { slug: string; options: TrialOptions | null }) {
  const trialHref = `/schools/${slug}/trial`;
  let body: React.ReactNode;
  if (!options || options.state === 'ready') {
    body = (
      <Link href={trialHref} className={buttonVariants({ variant: 'primary' })} data-testid="school-trial-request">
        Request a trial lesson
      </Link>
    );
  } else if (options.state === 'sign_in') {
    body = (
      <Link href={`/sign-in?next=${encodeURIComponent(trialHref)}`} className={buttonVariants({ variant: 'secondary' })} data-testid="school-trial-sign-in">
        Sign in to request a trial lesson
      </Link>
    );
  } else if (options.state === 'open') {
    body = (
      <p className="text-sm" data-testid="school-trial-state" data-state="open">
        {options.reason}{' '}
        <Link href="/dashboard/trial-lessons" className="link inline-flex min-h-11 items-center">
          Your trial lesson requests
        </Link>
      </p>
    );
  } else {
    body = (
      <p className="text-sm text-fg-muted" data-testid="school-trial-state" data-state={options.state}>
        {options.reason}
      </p>
    );
  }
  return (
    <section aria-labelledby="school-trial" data-testid="school-trial">
      <h2 id="school-trial" className="font-display text-xl">
        Trial lesson
      </h2>
      <p className="mt-2 max-w-[56ch] text-fg-muted">Ask the school for a first lesson. The school sees your profile name and the contact you choose, and answers here.</p>
      <div className="mt-3">{body}</div>
    </section>
  );
}
