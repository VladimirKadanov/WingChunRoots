// Routes of descent (plan §4.10, item 2; milestone M04): one ordered list per route, from the
// earliest recorded teacher down to the person, drawn as an ink spine (Ink Register): each link is
// its state's own stroke (solid ink, dots, a broken line, a double line, a thin historical line or
// the hollow cross-lineage curve) with its seal at the middle, and its state in words beside the
// student. A gutter gives the generation, counted from the top of the route, and the year the
// training began. The route along display-primary teachers comes first (DEFAULT D05).
//
// DEFAULT D22: a person is a founder only when the record names them as a lineage's root ("as
// recorded"), wherever they are on the route; a route whose top is not a recorded root says that
// earlier teachers are not recorded.
//
// Rows grow with the reader's text size and wrap on a phone, so each link is drawn in the row of
// its teacher, from the teacher's node down to the next row's node, in an SVG that stretches with
// the row (preserveAspectRatio="none" on a vertical stroke: only its length changes). Patterned
// strokes keep their dots and dashes at any length (vector-effect="non-scaling-stroke").

import Link from 'next/link';

import { InkShapeSvg, type LinkKind } from '@/components/ink/link-stroke';
import { Seal } from '@/components/ink/seal';
import { inkShapes, type Cubic } from '@/design/ink';
import { linkStyles } from '@/design/tokens';
import type { LineageEdgeDto, LineageNodeDto, LineagePathsDto, LineageRefDto } from '@/server/dto/public';
import { LatinName, LineageName, PersonLink, PersonName } from './person-name';
import { Sep } from './relation-list';
import { EmptyState } from './states';
import { MARK_ORDER, ROUTE_MARK_LABELS, RouteMark, type RouteMarkKind } from './route-mark';
import { relationStatus, startYear, strokeOf } from './status';

export { ROUTE_MARK_LABELS, RouteMark, type RouteMarkKind };

/** The vertical stroke of one link, 100 units long in a 28-unit column (stretched by the row). */
const DOWN: Cubic = [
  [14, 0],
  [11.5, 38],
  [16.5, 62],
  [14, 100],
];

function LinkSegment({ kind }: { kind: LinkKind }) {
  const style = linkStyles[kind];
  const pattern = { fill: 'none', stroke: 'currentColor', vectorEffect: 'non-scaling-stroke' as const };
  let shape: React.ReactNode;
  switch (kind) {
    case 'verified':
      shape = <InkShapeSvg shape={inkShapes(DOWN, 'verified', { w0: 6.4, w1: 1.8, n: 40 })} />;
      break;
    case 'historical':
      shape = <InkShapeSvg shape={inkShapes(DOWN, 'verified', { w0: 1.8, w1: 1.1, n: 40 })} />;
      break;
    case 'cross_lineage': {
      // The key's sample (LinkStroke): the hollow ribbon of a link to a teacher of another
      // lineage, the same shape on the route as in the key (milestone M06, M05 review item b13).
      const ribbon = inkShapes(DOWN, 'verified', { w0: 6.4, w1: 1.8, n: 40, crossLineage: true });
      shape = ribbon.kind === 'hollow' ? <path d={ribbon.d} {...pattern} strokeWidth={1.3} strokeDasharray={ribbon.dash ?? undefined} /> : null;
      break;
    }
    case 'unconfirmed':
      shape = <path d="M14 0V100" {...pattern} strokeWidth={2.6} strokeLinecap="round" strokeDasharray="0.1 6" />;
      break;
    case 'under_review':
      shape = <path d="M14 0V100" {...pattern} strokeWidth={2.2} strokeDasharray="8 5" />;
      break;
    case 'arbitration':
      shape = <path d="M11.5 0V100M16.5 0V100" {...pattern} strokeWidth={1.4} strokeDasharray="6 4" />;
      break;
  }
  return (
    <span aria-hidden="true" className="absolute top-[calc(var(--node)+0.5rem)] bottom-[calc(0.5rem-var(--node))] left-0 w-7" data-stroke={style.stroke}>
      <svg
        viewBox="0 0 28 100"
        preserveAspectRatio="none"
        width={28}
        height="100%"
        focusable="false"
        className="block h-full overflow-visible"
        style={{ color: `var(--${style.strokeColor})` }}
      >
        {shape}
      </svg>
      <Seal kind={style.seal} size={13} className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2" />
    </span>
  );
}

function markOf(founder: boolean, person: LineageNodeDto): RouteMarkKind {
  return founder ? 'founder' : person.lifeStatus === 'living' ? 'living' : 'other';
}

/** The marks the routes of `paths` draw, in the key's order: a key lists only what is drawn. */
export function routeMarks(paths: LineagePathsDto): RouteMarkKind[] {
  const people = new Map(paths.nodes.map((n) => [n.id, n]));
  const founders = new Set(paths.lineages.map((l) => l.rootPersonId));
  const drawn = new Set(
    paths.paths.flatMap((route) => route.personIds.map((id) => people.get(id)).filter((n) => n !== undefined).map((n) => markOf(founders.has(n.id), n))),
  );
  return MARK_ORDER.filter((mark) => drawn.has(mark));
}

/** The person's node on the spine. */
function Node({ mark }: { mark: RouteMarkKind }) {
  return <RouteMark mark={mark} className="absolute top-[calc(var(--node)-0.3125rem)] left-[calc(0.875rem-0.3125rem)]" />;
}

function StateWord({ edge }: { edge: LineageEdgeDto }) {
  const status = relationStatus(edge.status);
  const kind = strokeOf(edge);
  const word = kind === 'cross_lineage' || kind === 'historical' ? `${status.label}, ${linkStyles[kind].label.toLowerCase()}` : status.label;
  return (
    <span className="font-semibold" style={{ color: `var(--${linkStyles[status.kind].labelColor})` }}>
      {word}
    </span>
  );
}

function Step({
  person,
  step,
  edge,
  next,
  teacher,
  lineage,
  founderOf,
  isTop,
  isLast,
}: {
  person: LineageNodeDto;
  step: number;
  /** The link from the teacher above to this person (none at the top). */
  edge: LineageEdgeDto | undefined;
  /** The link from this person to the student below (drawn in this row). */
  next: LineageEdgeDto | undefined;
  teacher: LineageNodeDto | undefined;
  /** The lineage to name here: at the first link and where it changes. */
  lineage: LineageRefDto | undefined;
  founderOf: readonly LineageRefDto[];
  isTop: boolean;
  isLast: boolean;
}) {
  const year = edge ? startYear(edge.periods) : null;
  const mark = markOf(founderOf.length > 0, person);
  return (
    <li className="relative grid grid-cols-[2.5rem_1.75rem_minmax(0,1fr)] gap-x-3 pb-3 [--node:1.375rem]">
      {/* The number and spine columns grow with the text, so at 200% text on a 320 px screen a
          long name may break inside a word rather than widen the page. */}
      <div className="col-start-3 row-start-1 grid min-w-0 content-start [overflow-wrap:anywhere]">
        {isLast ? (
          <span className="inline-flex min-h-11 items-center font-display text-lg">
            <PersonName person={person} />
          </span>
        ) : (
          <PersonLink person={person} className="font-display text-lg" />
        )}
        <p className="text-sm text-fg-muted">
          {/* The filled dot in words (the founder's square is in the text below). */}
          {mark === 'living' ? <span className="sr-only">Living. </span> : null}
          {teacher && edge ? (
            <>
              <span className="sr-only">
                Student of <LatinName name={teacher.displayName} />,{' '}
              </span>
              <StateWord edge={edge} />
              {lineage ? (
                <>
                  <span aria-hidden="true"> · </span>
                  <span className="sr-only">, </span>
                  <LineageName name={lineage.name} />
                </>
              ) : null}
            </>
          ) : null}
          {founderOf.length > 0 ? (
            <span className="block">
              Founder of{' '}
              {founderOf.map((l, i) => (
                <span key={l.id}>
                  {i > 0 ? ' and ' : null}
                  <LineageName name={l.name} />
                </span>
              ))}
              , as recorded
            </span>
          ) : isTop ? (
            <span className="block">Earliest teacher on the record; earlier teachers are not recorded</span>
          ) : null}
        </p>
      </div>
      <p className="col-start-1 row-start-1 grid content-start justify-items-end pt-[calc(var(--node)-0.6rem)] text-caption text-fg-subtle tabular">
        <span>
          <span className="sr-only">Generation </span>
          {step + 1}
        </span>
        {year ? (
          <span>
            <span className="sr-only">, training began </span>
            {year}
          </span>
        ) : null}
      </p>
      <div className="relative col-start-2 row-start-1">
        {next ? <LinkSegment kind={strokeOf(next)} /> : null}
        <Node mark={mark} />
      </div>
    </li>
  );
}

export function RoutesOfDescent({
  paths,
  focusName,
  moreHref,
}: {
  paths: LineagePathsDto;
  focusName: string;
  /** Where "show all routes" leads; null when every route is shown. */
  moreHref: string | null;
}) {
  if (paths.paths.length === 0) {
    return (
      <EmptyState>
        No teachers are on the record for <LatinName name={focusName} />, so there is no route to show yet.
      </EmptyState>
    );
  }
  const people = new Map(paths.nodes.map((n) => [n.id, n]));
  const edges = new Map(paths.edges.map((e) => [e.id, e]));
  const lineages = new Map(paths.lineages.map((l) => [l.id, l]));
  const founded = (id: string) => paths.lineages.filter((l) => l.rootPersonId === id);
  const more = paths.totalPaths - paths.paths.length;
  const total = `${paths.totalPaths.toLocaleString('en')}${paths.totalPathsCapped ? '+' : ''}`;

  return (
    <div className="grid gap-5">
      <p className="text-ui text-fg-muted">
        {paths.totalPaths === 1 ? 'One route' : `${total} routes`} from the earliest recorded teachers to <LatinName name={focusName} />.
      </p>
      <ol aria-label={`Routes of descent to ${focusName}`} className="grid gap-5 lg:grid-cols-2">
        {paths.paths.map((route, index) => {
          const top = people.get(route.personIds[0]!)!;
          const primaryRoute = route.edgeIds.every((id) => edges.get(id)?.kind === 'primary');
          return (
            <li key={route.edgeIds.join('-')} className="grid content-start gap-3 rounded-sm border border-border-subtle bg-surface-1 px-4 pt-3 pb-1 [--seal-ground:var(--surface-1)]">
              <h3 className="eyebrow">
                {/* Generations as the gutter counts them: every person on the route, the top one
                    included (final check, screens-3); the separators are pauses, not read out. */}
                Route {index + 1}
                {primaryRoute ? (
                  <>
                    <Sep />
                    primary line
                  </>
                ) : null}
                <Sep />
                {route.personIds.length} {route.personIds.length === 1 ? 'generation' : 'generations'}
              </h3>
              <ol aria-label={`Route ${index + 1}, from ${top.displayName} to ${focusName}`} className="grid">
                {route.personIds.map((id, step) => {
                  const edge = step > 0 ? edges.get(route.edgeIds[step - 1]!) : undefined;
                  const previous = step > 1 ? edges.get(route.edgeIds[step - 2]!) : undefined;
                  const lineage = edge && edge.lineageId !== previous?.lineageId ? lineages.get(edge.lineageId) : undefined;
                  return (
                    <Step
                      key={id}
                      person={people.get(id)!}
                      step={step}
                      edge={edge}
                      next={edges.get(route.edgeIds[step] ?? '')}
                      teacher={step > 0 ? people.get(route.personIds[step - 1]!) : undefined}
                      lineage={lineage}
                      founderOf={founded(id)}
                      isTop={step === 0}
                      isLast={step === route.personIds.length - 1}
                    />
                  );
                })}
              </ol>
            </li>
          );
        })}
      </ol>
      {more > 0 ? (
        <p className="text-ui">
          {paths.totalPathsCapped ? 'More than ' : ''}
          {more.toLocaleString('en')} more {more === 1 ? 'route' : 'routes'}.{' '}
          {moreHref ? (
            <Link href={moreHref} prefetch={false} className="link inline-flex min-h-11 items-center">
              Show up to 200 routes
            </Link>
          ) : null}
        </p>
      ) : null}
    </div>
  );
}
