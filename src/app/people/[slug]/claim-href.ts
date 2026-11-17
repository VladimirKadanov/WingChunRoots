// "Is this you? Ask to claim this profile" on a person's profile (ADR 0037): where it leads, from
// the public profile alone (the record's side of the rules of claims.request,
// src/server/services/profile-claims.ts), so the page offers it only where the claim can be asked.

import type { PersonProfileDto } from '@/server/dto/public';

/**
 * The claim page of a public, unclaimed record of a living person that is not the viewer's own, or
 * null. A historical or deceased person's record and one kept by the archive are corrected, never
 * claimed. The account's side (a profile of its own, a claim waiting) is told on the claim page; a
 * visitor is sent to sign in there and comes back.
 */
export function claimProfileHref(profile: Pick<PersonProfileDto, 'slug' | 'visibility' | 'limited' | 'isOwn' | 'kind' | 'lifeStatus' | 'claimState'>): string | null {
  if (profile.visibility !== 'public' || profile.limited || profile.isOwn) return null;
  if (profile.kind !== 'living' || profile.lifeStatus !== 'living' || profile.claimState !== 'unclaimed') return null;
  return `/people/${profile.slug}/claim`;
}
