// The account menu of the app shell (owner request 2026-11-17, docs/adr/0035-control-panel.md):
// for a signed-in account, its own display name, address, role and unread count, so every page
// shows who is signed in and where their own pages are. Only the account's own data; never
// cached (the shell reads it behind a Suspense boundary, per request).

import { and, count, eq, isNull } from 'drizzle-orm';

import { hasStaff2FA, requireUser } from '../auth/guards';
import { isStaffRole, type Principal, type Role } from '../auth/principal';
import { getDb } from '../db';
import { authUser, notification, person, personName } from '../db/schema';

export interface AccountMenu {
  /** The primary name of the account's own profile, else the account's name; null before onboarding. */
  displayName: string | null;
  /** BCP 47 tag of `displayName` (lang attribute). */
  lang: string;
  /** One or two letters for the round mark: from the name, else from the address. */
  initials: string;
  email: string;
  role: Role;
  roleLabel: string;
  /** A staff role: the menu offers the control panel. */
  staff: boolean;
  /** The session already passed the second factor (the control panel opens without another step). */
  staffReady: boolean;
  unreadNotifications: number;
  /** The account has a profile (/dashboard/profile has something to show). */
  hasProfile: boolean;
}

const ROLE_LABELS: Record<Role, string> = { user: 'Member', moderator: 'Moderator', archivist: 'Archivist', admin: 'Administrator' };

/** One or two capital letters from a name (its first and last word), else from an address. */
export function initialsFor(name: string | null, email: string): string {
  const words = (name ?? '').trim().split(/\s+/u).filter(Boolean);
  const letter = (word: string) => [...word][0]?.toLocaleUpperCase('en') ?? '';
  if (words.length >= 2) return `${letter(words[0]!)}${letter(words[words.length - 1]!)}`;
  if (words.length === 1) return letter(words[0]!);
  return letter(email) || '?';
}

export async function accountMenu(principal: Principal | null): Promise<AccountMenu> {
  const p = requireUser(principal);
  const db = getDb();
  const [[profile], [account], [unread]] = await Promise.all([
    db
      .select({ value: personName.value, lang: personName.lang })
      .from(person)
      .leftJoin(personName, and(eq(personName.personId, person.id), eq(personName.isPrimary, true)))
      .where(and(eq(person.claimedByUserId, p.user.id), isNull(person.deletedAt)))
      .limit(1),
    db.select({ name: authUser.name }).from(authUser).where(eq(authUser.id, p.user.id)).limit(1),
    db
      .select({ n: count() })
      .from(notification)
      .where(and(eq(notification.userId, p.user.id), isNull(notification.readAt))),
  ]);
  const accountName = account?.name.trim() || null;
  const displayName = profile?.value ?? accountName;
  return {
    displayName,
    lang: profile?.value ? (profile.lang ?? 'und-Latn') : 'und-Latn',
    initials: initialsFor(displayName, p.user.email),
    email: p.user.email,
    role: p.user.role,
    roleLabel: ROLE_LABELS[p.user.role],
    staff: isStaffRole(p.user.role),
    staffReady: hasStaff2FA(p),
    unreadNotifications: unread?.n ?? 0,
    hasProfile: profile !== undefined,
  };
}
