// How a relationship reads in the lineage screens (plan §4.6, §4.10; milestone M04): its state as
// a seal and a word (never colour alone), its training periods as text, and whether it is
// historical. Shared by the profile, the list view and the explorer (M05).

import type { LinkKind } from '@/components/ink/link-stroke';
import type { LineageEdgeDto, PeriodDto, RelationshipStatusDto } from '@/server/dto/public';

export interface RelationStatus {
  /** The seal and stroke of plan §4.6. */
  kind: LinkKind;
  /** The word shown next to the seal. */
  label: string;
}

/**
 * The state of a relationship as the reader sees it. A request that waits for the teacher
 * (pending_teacher, awaiting_claim) is "Pending": only its two participants ever see it
 * (DEFAULT D03), drawn with the unconfirmed seal.
 */
export function relationStatus(status: RelationshipStatusDto): RelationStatus {
  switch (status) {
    case 'verified':
      return { kind: 'verified', label: 'Verified' };
    case 'in_arbitration':
      return { kind: 'arbitration', label: 'In arbitration' };
    case 'under_review':
      return { kind: 'under_review', label: 'Under review' };
    case 'pending_teacher':
    case 'awaiting_claim':
      return { kind: 'unconfirmed', label: 'Pending' };
    default:
      // Ended relationships (rejected, withdrawn, revoked) are never part of an answer.
      return { kind: 'unconfirmed', label: 'Not confirmed' };
  }
}

/** Every period has ended: none is ongoing and at least one has an end. */
export function isHistoricalRelation(periods: readonly PeriodDto[]): boolean {
  return periods.length > 0 && periods.every((p) => !p.ongoing) && periods.some((p) => p.to !== null);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** 1985, Feb 1992 or 3 Feb 1992, by the precision the date was recorded with. */
function dateText(prefix: string): string {
  const [year, month, day] = prefix.split('-');
  if (!month) return year!;
  const name = MONTHS[Number(month) - 1] ?? month;
  return day ? `${Number(day)} ${name} ${year}` : `${name} ${year}`;
}

/** "1981–1983, 1985 – present", "since Feb 1992" or "Dates not recorded". */
export function periodText(periods: readonly PeriodDto[]): string {
  const parts = periods
    .map((p) => {
      const from = p.from ? dateText(p.from) : null;
      const to = p.to ? dateText(p.to) : null;
      if (p.ongoing) return from ? `${from} – present` : 'Ongoing';
      if (from && to) return from === to ? from : `${from}–${to}`;
      if (from) return `from ${from}`;
      if (to) return `until ${to}`;
      return null;
    })
    .filter((p): p is string => p !== null);
  return parts.length > 0 ? parts.join(', ') : 'Dates not recorded';
}

/** The kinds a list of edges uses, for its legend; historical and cross-lineage marks included. */
export function kindsOf(
  edges: readonly (Pick<LineageEdgeDto, 'status' | 'periods'> & { kind?: LineageEdgeDto['kind'] })[],
  extra: readonly LinkKind[] = [],
): LinkKind[] {
  const kinds = new Set<LinkKind>(extra);
  for (const e of edges) {
    kinds.add(relationStatus(e.status).kind);
    if (isHistoricalRelation(e.periods)) kinds.add('historical');
    if (e.kind === 'crossLineage') kinds.add('cross_lineage');
  }
  return [...kinds];
}

/** Life status in words. */
export function lifeText(lifeStatus: string, kind?: string): string {
  const life = lifeStatus === 'living' ? 'Living' : lifeStatus === 'deceased' ? 'Deceased' : 'Not recorded';
  return kind === 'historical' && lifeStatus !== 'living' ? `${life} · historical record` : life;
}

/** Who keeps the record (plan §6.4: an unclaimed record is never presented as the person's own account). */
export function claimText(claimState: string): string {
  if (claimState === 'claimed') return 'Claimed by the person';
  if (claimState === 'platform') return 'Kept by the archive';
  return 'Unclaimed record';
}
