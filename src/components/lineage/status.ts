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

/** An en dash between two ends: closed up between years, spaced when an end has a space in it. */
function range(from: string, to: string): string {
  return from.includes(' ') || to.includes(' ') ? `${from} – ${to}` : `${from}–${to}`;
}

/** "1981–1983, 1985–present", "Feb 1992 – present", "from 1990" or "Dates not recorded". */
export function periodText(periods: readonly PeriodDto[]): string {
  const parts = periods
    .map((p) => {
      const from = p.from ? dateText(p.from) : null;
      const to = p.to ? dateText(p.to) : null;
      if (p.ongoing) return from ? range(from, 'present') : 'Ongoing';
      if (from && to) return from === to ? from : range(from, to);
      if (from) return `from ${from}`;
      if (to) return `until ${to}`;
      return null;
    })
    .filter((p): p is string => p !== null);
  return parts.length > 0 ? parts.join(', ') : 'Dates not recorded';
}

type EdgeLike = Pick<LineageEdgeDto, 'status' | 'periods'> & { kind?: LineageEdgeDto['kind'] };

/**
 * The kinds a list of edges draws, for its legend: each edge's state, and the historical and
 * cross-lineage marks. Only what is drawn (a legend lists nothing else).
 */
export function kindsOf(edges: readonly EdgeLike[]): LinkKind[] {
  const kinds = new Set<LinkKind>();
  for (const e of edges) {
    kinds.add(relationStatus(e.status).kind);
    if (isHistoricalRelation(e.periods)) kinds.add('historical');
    if (e.kind === 'crossLineage') kinds.add('cross_lineage');
  }
  return [...kinds];
}

/**
 * A student's row draws its state and whether training ended, never the cross-lineage curve
 * (design review: that mark belongs to the student's own teachers). The edges as a student's row
 * draws them, for the key.
 */
export function asStudentEdges(edges: readonly EdgeLike[]): EdgeLike[] {
  return edges.map((e) => ({ status: e.status, periods: e.periods }));
}

/**
 * The one stroke a row draws for its relationship: a state that is not verified first (it is what
 * the reader must notice), then the cross-lineage curve (on a teacher's row only), then the thin
 * historical line, then verified ink.
 */
export function strokeOf(edge: EdgeLike): LinkKind {
  const status = relationStatus(edge.status).kind;
  if (status !== 'verified') return status;
  if (edge.kind === 'crossLineage') return 'cross_lineage';
  if (isHistoricalRelation(edge.periods)) return 'historical';
  return 'verified';
}

/** The year training began: the earliest dated start, or null. */
export function startYear(periods: readonly PeriodDto[]): string | null {
  const years = periods.map((p) => p.from?.slice(0, 4)).filter((y): y is string => Boolean(y));
  return years.length > 0 ? years.sort()[0]! : null;
}

/**
 * Short notes that tell apart people with the same name in one list (design review: two
 * "Oscar Stubbard" read as a cycle). Only names that occur more than once get a note: the start
 * year when theirs differ, else the lineage, else what the caller has (such as another teacher).
 */
export function sameNameNotes(
  rows: readonly { id: string; displayName: string; year?: string | null; lineage?: string | null; other?: string | null }[],
): Map<string, string> {
  const notes = new Map<string, string>();
  const byName = new Map<string, typeof rows>();
  for (const row of rows) byName.set(row.displayName, [...(byName.get(row.displayName) ?? []), row]);
  for (const group of byName.values()) {
    if (group.length < 2) continue;
    const distinct = (values: (string | null | undefined)[]) => new Set(values).size === values.length && values.every(Boolean);
    const pick = distinct(group.map((r) => r.year))
      ? (r: (typeof group)[number]) => `since ${r.year}`
      : distinct(group.map((r) => r.lineage))
        ? (r: (typeof group)[number]) => r.lineage!
        : distinct(group.map((r) => r.other))
          ? (r: (typeof group)[number]) => r.other!
          : null;
    group.forEach((r, i) => notes.set(r.id, pick ? pick(r) : `record ${i + 1} of ${group.length}`));
  }
  return notes;
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
