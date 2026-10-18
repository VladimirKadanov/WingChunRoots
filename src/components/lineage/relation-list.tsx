// Teachers and students of a person (plan §4.10; milestone M04): one row per person, with the
// lineage, the training period, the state as a seal and a word, and whether the training has
// ended (historical). A relationship only its participants can see says so (DEFAULT D03).

import { StatusBadge } from '@/components/ui/status-badge';
import { cx } from '@/lib/cx';
import type { LineageEdgeDto, LineageRefDto } from '@/server/dto/public';
import { type PersonNameData, PersonLink } from './person-name';
import { isHistoricalRelation, periodText, relationStatus } from './status';

export interface RelationRow {
  person: PersonNameData & { id: string; visibility: 'public' | 'involved_only' };
  /** The person's relationships with the focus (usually one; one per lineage otherwise). */
  edges: (Pick<LineageEdgeDto, 'id' | 'lineageId' | 'status' | 'visibility' | 'periods'> & { kind?: LineageEdgeDto['kind'] })[];
}

/** The seal-and-word badges of one relationship. */
export function RelationBadges({ edge }: { edge: RelationRow['edges'][number] }) {
  const status = relationStatus(edge.status);
  return (
    <span className="flex flex-wrap items-center gap-x-4 gap-y-1">
      <StatusBadge state={status.kind} label={status.label} size="sm" />
      {isHistoricalRelation(edge.periods) ? <StatusBadge state="historical" label="Historical" size="sm" /> : null}
      {edge.kind === 'crossLineage' ? <StatusBadge state="cross_lineage" size="sm" /> : null}
    </span>
  );
}

function lineageOf(lineages: ReadonlyMap<string, LineageRefDto>, id: string): string {
  return lineages.get(id)?.name ?? 'Lineage not named';
}

/**
 * The rows of a teachers or students list. `detail` "full" (the list view) names every field;
 * "compact" (the profile) puts lineage and period on one line.
 */
export function RelationList({
  rows,
  lineages,
  detail = 'compact',
  label,
  className,
}: {
  rows: readonly RelationRow[];
  lineages: ReadonlyMap<string, LineageRefDto>;
  detail?: 'compact' | 'full';
  /** The accessible name of the list. */
  label: string;
  className?: string;
}) {
  return (
    <ul aria-label={label} className={cx('grid', className)}>
      {rows.map((row) => (
        <li key={row.person.id} data-person={row.person.slug} className="grid gap-1 border-t border-border-subtle py-3 first:border-t-0 first:pt-0">
          <PersonLink person={row.person} className="font-display text-xl" />
          {row.edges.map((edge) =>
            detail === 'full' ? (
              <dl key={edge.id} className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-x-3 gap-y-1 text-sm">
                <dt className="text-fg-muted">Lineage</dt>
                <dd>{lineageOf(lineages, edge.lineageId)}</dd>
                <dt className="text-fg-muted">Training</dt>
                <dd>
                  {periodText(edge.periods)}
                  <span className="text-fg-muted">{isHistoricalRelation(edge.periods) ? ' · historical (training ended)' : ' · current'}</span>
                </dd>
                <dt className="text-fg-muted">Status</dt>
                <dd>
                  <RelationBadges edge={edge} />
                </dd>
              </dl>
            ) : (
              <div key={edge.id} className="grid gap-1">
                <p className="text-sm text-fg-muted">
                  {lineageOf(lineages, edge.lineageId)} <span aria-hidden="true">·</span> <span>{periodText(edge.periods)}</span>
                </p>
                <RelationBadges edge={edge} />
              </div>
            ),
          )}
          {row.edges.some((e) => e.visibility === 'involved_only') ? (
            <p className="text-sm text-fg-muted">Visible only to the two people in this request until it is confirmed.</p>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

/** Groups edges by the other person, in the order given. */
export function groupRelations<E extends RelationRow['edges'][number]>(
  edges: readonly E[],
  otherOf: (edge: E) => string,
  personOf: (id: string) => RelationRow['person'] | undefined,
): RelationRow[] {
  const rows = new Map<string, RelationRow>();
  for (const edge of edges) {
    const id = otherOf(edge);
    const person = personOf(id);
    if (!person) continue;
    const row = rows.get(id) ?? { person, edges: [] };
    row.edges.push(edge);
    rows.set(id, row);
  }
  return [...rows.values()];
}
