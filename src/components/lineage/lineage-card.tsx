// The lineage card (ADR 0045): one public route of descent, from the earliest known teacher down
// to the member, as a designed card in the seal look of the Ink Register direction. Server
// rendered; the print stylesheet (tokens.css, print:) gives paper and ink whatever the theme, and
// the card never breaks across pages. Names keep their own `lang` and translate="no".

import { BrandSealStack } from '@/components/brand/brand-mark';
import { cx } from '@/lib/cx';
import type { LineageCardDto, LineageEdgeDto, LineageNodeDto } from '@/server/dto/public';

import { PersonName } from './person-name';
import { startYear } from './status';

export interface CardStep {
  person: LineageNodeDto;
  /** The relationship with the teacher above (null for the earliest teacher). */
  fromTeacher: LineageEdgeDto | null;
}

/** The people of route `index`, earliest teacher first, with the edge from the teacher above. */
export function cardSteps(card: LineageCardDto, index: number): CardStep[] {
  const route = card.paths.paths[index];
  if (!route) return [];
  const people = new Map(card.paths.nodes.map((n) => [n.id, n]));
  const edges = new Map(card.paths.edges.map((e) => [e.id, e]));
  return route.personIds.flatMap((id, i) => {
    const person = people.get(id);
    if (!person) return [];
    return [{ person, fromTeacher: i === 0 ? null : (edges.get(route.edgeIds[i - 1]!) ?? null) }];
  });
}

/** The lineage a route belongs to: the lineage of its last link (the member's own). */
export function routeLineage(card: LineageCardDto, index: number): string | null {
  const route = card.paths.paths[index];
  const lastEdge = route ? card.paths.edges.find((e) => e.id === route.edgeIds[route.edgeIds.length - 1]) : undefined;
  return lastEdge ? (card.paths.lineages.find((l) => l.id === lastEdge.lineageId)?.name ?? null) : null;
}

/** "5 generations", counting the member. */
export function generationsText(count: number): string {
  return count === 1 ? '1 generation' : `${count} generations`;
}

export function LineageCard({ card, index, className }: { card: LineageCardDto; index: number; className?: string }) {
  const steps = cardSteps(card, index);
  const lineage = routeLineage(card, index);
  return (
    <article
      aria-labelledby="lineage-card-title"
      data-testid="lineage-card"
      className={cx(
        'relative grid gap-6 rounded-sm border border-border-strong bg-surface-2 p-6 shadow-(--elevation-raise) md:p-10 print:break-inside-avoid print:shadow-none',
        className,
      )}
    >
      <header className="flex items-start justify-between gap-6">
        <div className="grid gap-1">
          <p className="eyebrow">Lineage card</p>
          <h2 id="lineage-card-title" className="font-display text-2xl md:text-3xl">
            {lineage ? (
              <span translate="no">{lineage}</span>
            ) : (
              'Route of descent'
            )}
          </h2>
          <p className="text-sm text-fg-muted">{generationsText(steps.length)}, from the earliest known teacher</p>
        </div>
        <BrandSealStack height={64} className="shrink-0" />
      </header>
      <ol className="relative grid gap-0" data-testid="lineage-card-steps">
        {steps.map((step, i) => {
          const last = i === steps.length - 1;
          const year = step.fromTeacher ? startYear(step.fromTeacher.periods) : null;
          return (
            <li key={step.person.id} className="relative grid grid-cols-[2rem_minmax(0,1fr)] gap-x-3 pb-5 last:pb-0" data-testid="lineage-card-step">
              {/* The ink spine between the generations (decorative). */}
              {!last ? <span aria-hidden="true" className="absolute top-6 bottom-0 left-[calc(1rem-1px)] w-0.5 bg-fg" /> : null}
              <span
                aria-hidden="true"
                className={cx(
                  'relative z-10 mt-1.5 grid size-8 place-items-center rounded-full border-2 text-xs font-semibold tabular-nums',
                  last ? 'border-brand bg-brand text-on-brand' : 'border-fg bg-surface-2 text-fg',
                )}
              >
                {i + 1}
              </span>
              <div className="grid gap-0.5">
                <PersonName person={step.person} className={cx('font-display', last ? 'text-2xl' : 'text-xl')} />
                <p className="text-sm text-fg-muted">
                  {i === 0 ? 'Earliest known teacher' : last ? 'This member' : `Generation ${i + 1}`}
                  {year ? <> · trained from {year}</> : null}
                </p>
              </div>
            </li>
          );
        })}
      </ol>
      <footer className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 border-t border-border-subtle pt-4 text-xs text-fg-muted">
        <span>WingChunRoots · confirmed teaching links</span>
        <span>Only people with public profiles are shown.</span>
      </footer>
    </article>
  );
}
