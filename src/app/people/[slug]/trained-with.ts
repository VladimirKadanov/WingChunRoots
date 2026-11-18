// "I trained with <name>" on a person's profile: where it leads, from the public profile alone
// (the rules of relationships.request and relationships.requestHistorical), so the page offers it
// only where the form can take it.

import type { PersonProfileDto } from '@/server/dto/public';

/**
 * Where "I trained with <name>" leads, or null when a student cannot name this person: a living
 * person with their own account is asked through relationships.request (/dashboard/teachers/new);
 * a historical or deceased one is confirmed by the reviewers from evidence
 * (/dashboard/teachers/historical). A living record without its own account cannot be asked yet
 * (relationships.request refuses it), nor can a record that is not public or one's own. A visitor
 * goes to sign-in first, with the form as `next`, so the chosen teacher survives the sign-in (the
 * dashboard guard alone would drop the query).
 */
export function trainedWithHref(
  profile: Pick<PersonProfileDto, 'slug' | 'visibility' | 'limited' | 'isOwn' | 'kind' | 'lifeStatus' | 'claimState'>,
  signedIn: boolean,
): string | null {
  if (profile.visibility !== 'public' || profile.limited || profile.isOwn) return null;
  const teacher = `?teacher=${encodeURIComponent(profile.slug)}`;
  let path: string;
  if (profile.kind === 'historical' || profile.lifeStatus === 'deceased') path = `/dashboard/teachers/historical${teacher}`;
  else if (profile.kind === 'living' && profile.claimState === 'claimed') path = `/dashboard/teachers/new${teacher}`;
  else return null;
  return signedIn ? path : `/sign-in?next=${encodeURIComponent(path)}`;
}
