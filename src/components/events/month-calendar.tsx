// The Month view of /events (docs/adr/0052-public-page-redesign.md): a grid of the month from
// Monday, each event on the day it starts in its own zone. Server-rendered, no JavaScript: every
// day with events is a link that chooses it (?day=), the previous and next months are links. From
// 768 px each day lists its events by title; on a phone a day shows the shapes of its kinds and the
// list under the grid names them. Shapes and words, never colour alone.

import Link from 'next/link';

import { ArrowLeftIcon } from '@/components/icons';
import { cx } from '@/lib/cx';
import { formatEventWhen, monthLabel, monthWeeks, shortMonthName } from '@/lib/event-time';
import type { EventSummaryDto } from '@/server/dto/events';
import { KindShape } from './event-card';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const WEEKDAYS_LONG = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

/** The events of a month by the day they start in their own zone ("2027-03-13"). */
export function eventsByDay(items: readonly EventSummaryDto[]): Map<string, EventSummaryDto[]> {
  const days = new Map<string, EventSummaryDto[]>();
  for (const item of items) {
    const day = formatEventWhen(new Date(item.startsAt), new Date(item.endsAt), item.timezone).startDay;
    const list = days.get(day);
    if (list) list.push(item);
    else days.set(day, [item]);
  }
  return days;
}

const dayNumber = (day: string) => Number(day.slice(8));

export function MonthNav({ month, prevHref, nextHref }: { month: string; prevHref: string; nextHref: string }) {
  return (
    <nav aria-label="Months" className="flex items-center justify-between gap-3 sm:justify-start">
      <Link href={prevHref} className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-sm border border-border-strong hover:bg-surface-3" data-testid="month-prev">
        <ArrowLeftIcon size={18} />
        <span className="sr-only">Previous month</span>
      </Link>
      <h2 className="min-w-48 text-center font-display text-2xl" data-testid="month-title">
        {monthLabel(month)}
      </h2>
      <Link href={nextHref} className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-sm border border-border-strong hover:bg-surface-3" data-testid="month-next">
        <ArrowLeftIcon size={18} className="rotate-180" />
        <span className="sr-only">Next month</span>
      </Link>
    </nav>
  );
}

export function MonthGrid({
  month,
  byDay,
  selected,
  dayHref,
}: {
  month: string;
  byDay: Map<string, EventSummaryDto[]>;
  selected: string | null;
  dayHref: (day: string | null) => string;
}) {
  const weeks = monthWeeks(month);
  const monthName = monthLabel(month).split(' ')[0];
  return (
    <table className="w-full table-fixed border-collapse overflow-hidden rounded-md border border-border-subtle bg-surface-1" data-testid="month-grid">
      <caption className="sr-only">Events in {monthLabel(month)}, by the day they start</caption>
      <thead>
        <tr className="border-b border-border-strong">
          {WEEKDAYS.map((d, i) => (
            <th key={d} scope="col" className="px-1 py-2 text-center text-caption font-semibold uppercase text-fg-subtle md:px-2 md:text-left">
              <abbr title={WEEKDAYS_LONG[i]} className="no-underline">
                {d}
              </abbr>
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {weeks.map((week, w) => (
          <tr key={w}>
            {week.map((day, i) => {
              if (!day) return <td key={i} className="border border-border-subtle bg-bg md:h-32" />;
              const events = byDay.get(day) ?? [];
              const isSelected = day === selected;
              const n = dayNumber(day);
              return (
                <td key={day} className="border border-border-subtle p-0.5 align-top md:h-32 md:p-1.5" data-testid="month-day" data-day={day} data-count={events.length}>
                  {events.length > 0 ? (
                    <Link
                      href={dayHref(isSelected ? null : day)}
                      aria-current={isSelected ? 'date' : undefined}
                      className={cx(
                        'flex min-h-12 flex-col items-center justify-center gap-0.5 rounded-sm text-ui font-semibold md:min-h-9 md:w-9',
                        isSelected ? 'bg-fg text-fg-inverse' : 'hover:bg-surface-3',
                      )}
                    >
                      <span>{n}</span>
                      <span className="sr-only">
                        {' '}
                        {monthName}, {events.length === 1 ? '1 event' : `${events.length} events`}
                      </span>
                      <span aria-hidden="true" className="flex gap-0.5 md:hidden">
                        {events.slice(0, 3).map((e) => (
                          <KindShape key={e.slug} kind={e.kind} online={e.online} size={8} />
                        ))}
                      </span>
                    </Link>
                  ) : (
                    <span className="flex min-h-12 items-center justify-center text-ui text-fg-subtle md:min-h-9 md:w-9">{n}</span>
                  )}
                  {events.length > 0 ? (
                    <ul className="mt-1 hidden min-w-0 gap-1 overflow-hidden md:grid">
                      {events.slice(0, 3).map((e) => (
                        <li key={e.slug} className="min-w-0">
                          <Link
                            href={`/events/${e.slug}`}
                            className={cx(
                              'flex min-h-7 w-full items-center gap-1.5 overflow-hidden rounded-xs border border-border-strong bg-surface-2 px-1.5 text-xs font-semibold whitespace-nowrap hover:bg-surface-3',
                              e.status === 'cancelled' && 'line-through',
                            )}
                          >
                            <span className="shrink-0">
                              <KindShape kind={e.kind} online={e.online} size={9} />
                            </span>
                            <span className="truncate">{e.title}</span>
                            {e.status === 'cancelled' ? <span className="sr-only"> (cancelled)</span> : null}
                          </Link>
                        </li>
                      ))}
                      {events.length > 3 ? <li className="px-1.5 text-caption text-fg-muted">+{events.length - 3} more</li> : null}
                    </ul>
                  ) : null}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** "13 Mar" for "2027-03-13". */
export function dayLabel(day: string): string {
  return `${dayNumber(day)} ${shortMonthName(Number(day.slice(5, 7)))}`;
}

export function KindLegend() {
  const items: [Parameters<typeof KindShape>[0], string][] = [
    [{ kind: 'seminar' }, 'Seminar'],
    [{ kind: 'camp' }, 'Camp'],
    [{ kind: 'exam_session' }, 'Exam session'],
    [{ kind: 'other' }, 'Other event'],
    [{ kind: 'seminar', online: true }, 'Online'],
  ];
  return (
    <ul aria-label="Kinds of event" className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-fg-muted">
      {items.map(([shape, label]) => (
        <li key={label} className="inline-flex items-center gap-1.5">
          <KindShape {...shape} />
          {label}
        </li>
      ))}
    </ul>
  );
}
