// Routes of descent (plan §4.10, item 2; milestone M04): one ordered list per route, from the
// earliest recorded teacher down to the person, each step with the state of its link. The route
// along display-primary teachers comes first (DEFAULT D05). DEFAULT D22: a route's top is a
// lineage's founder only when the record names that person as the root; otherwise it is the
// earliest teacher on the record, and the page says that earlier teachers are not recorded.

import Link from 'next/link';

import type { LineagePathsDto } from '@/server/dto/public';
import { PersonLink, PersonName } from './person-name';
import { RelationBadges } from './relation-list';
import { EmptyState } from './states';

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
    return <EmptyState>No teachers are on the record for {focusName}, so there is no route to show yet.</EmptyState>;
  }
  const people = new Map(paths.nodes.map((n) => [n.id, n]));
  const edges = new Map(paths.edges.map((e) => [e.id, e]));
  const lineages = new Map(paths.lineages.map((l) => [l.id, l]));
  const more = paths.totalPaths - paths.paths.length;
  const total = `${paths.totalPaths.toLocaleString('en')}${paths.totalPathsCapped ? '+' : ''}`;

  return (
    <div className="grid gap-5">
      <p className="text-ui text-fg-muted">
        {paths.totalPaths === 1 ? 'One route' : `${total} routes`} from the earliest recorded teachers to {focusName}.
      </p>
      <ol aria-label={`Routes of descent to ${focusName}`} className="grid gap-6">
        {paths.paths.map((route, index) => {
          const top = people.get(route.personIds[0]!)!;
          const firstLineage = lineages.get(edges.get(route.edgeIds[0]!)?.lineageId ?? '');
          const founder = firstLineage?.rootPersonId === top.id ? firstLineage : null;
          const primaryRoute = route.edgeIds.every((id) => edges.get(id)?.kind === 'primary');
          return (
            <li key={route.edgeIds.join('-')} className="grid gap-2 rounded-sm border border-border-subtle bg-surface-1 px-4 py-3 [--seal-ground:var(--surface-1)]">
              <h3 className="eyebrow">
                Route {index + 1}
                {primaryRoute ? ' · primary line' : ''} · {route.edgeIds.length} {route.edgeIds.length === 1 ? 'generation' : 'generations'}
              </h3>
              <ol aria-label={`Route ${index + 1}, from ${top.displayName} to ${focusName}`} className="grid">
                {route.personIds.map((id, step) => {
                  const person = people.get(id)!;
                  const edge = step > 0 ? edges.get(route.edgeIds[step - 1]!) : undefined;
                  const lineage = edge ? lineages.get(edge.lineageId) : undefined;
                  const last = step === route.personIds.length - 1;
                  return (
                    <li key={id} className="relative grid gap-0.5 border-l-2 border-border-strong py-1.5 pl-4">
                      <span aria-hidden="true" className="absolute top-4 -left-[5px] size-2 rotate-45 bg-fg" />
                      {last ? (
                        <span className="inline-flex min-h-11 items-center font-display text-lg">
                          <PersonName person={person} />
                        </span>
                      ) : (
                        <PersonLink person={person} className="font-display text-lg" />
                      )}
                      {step === 0 ? (
                        <span className="text-sm text-fg-muted">
                          {founder ? `Founder of ${founder.name}, as recorded` : 'Earliest teacher on the record; earlier teachers are not recorded'}
                        </span>
                      ) : edge ? (
                        <span className="grid gap-1 text-sm text-fg-muted">
                          <span>
                            Student of {people.get(route.personIds[step - 1]!)!.displayName}
                            {lineage ? ` · ${lineage.name}` : ''}
                          </span>
                          <RelationBadges edge={edge} />
                        </span>
                      ) : null}
                    </li>
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
            <Link href={moreHref} prefetch={false} className="link">
              Show up to 200 routes
            </Link>
          ) : null}
        </p>
      ) : null}
    </div>
  );
}
