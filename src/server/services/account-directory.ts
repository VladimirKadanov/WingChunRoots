// The control panel's list of accounts (owner request 2026-11-17, docs/adr/0035-control-panel.md):
// every account, a page at a time, found by address or name, filtered by role and state, sorted by
// a column. For administrators whose session passed the second factor, as /admin/accounts. It
// shows what an administrator needs to find an account and act on it (address, profile name,
// role, account type, whether the address is confirmed and the second factor is on, suspension,
// when it was created and last active); never a password, a session or an IP address. Erased
// accounts (nameless markers) are left out. Read-only: the actions stay with their own procedures.

import { and, asc, count, desc, eq, ilike, isNull, or, type SQL, sql } from 'drizzle-orm';
import * as z from 'zod';

import { requireStaff2FA } from '../auth/guards';
import type { Principal, Role } from '../auth/principal';
import { ERASED_EMAIL_DOMAIN } from '../auth/suspension';
import { getDb } from '../db';
import { authUser, person, personName, USER_ROLES } from '../db/schema';

export const ACCOUNT_PAGE_SIZE = 25;
export const ACCOUNT_SORTS = ['newest', 'oldest', 'email', 'active'] as const;
export const ACCOUNT_STATES = ['all', 'suspended', 'unconfirmed', 'staff'] as const;

export const listAccountsInput = z
  .object({
    /** Part of the address or of the profile's primary name. */
    q: z.string().trim().max(200).optional(),
    role: z.enum(USER_ROLES).optional(),
    state: z.enum(ACCOUNT_STATES).default('all'),
    sort: z.enum(ACCOUNT_SORTS).default('newest'),
    page: z.coerce.number().int().min(1).max(10_000).default(1),
  })
  .default({ state: 'all', sort: 'newest', page: 1 });

export type ListAccountsInput = z.input<typeof listAccountsInput>;

export interface AccountRow {
  id: string;
  email: string;
  /** The primary name of the account's own profile, or null. */
  name: string | null;
  nameLang: string | null;
  /** The profile's address part, for a link to its page; null without a profile. */
  personSlug: string | null;
  role: Role;
  accountType: 'student' | 'sifu';
  emailVerified: boolean;
  twoFactorEnabled: boolean;
  suspended: boolean;
  createdAt: string;
  lastActiveAt: string | null;
}

export interface AccountList {
  rows: AccountRow[];
  total: number;
  page: number;
  pages: number;
  pageSize: number;
}

/** `%`, `_` and `\` typed into the search box match themselves (ILIKE with the default escape). */
export function likePattern(text: string): string {
  return `%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

export async function listAccounts(principal: Principal | null, raw: ListAccountsInput = {}): Promise<AccountList> {
  requireStaff2FA(principal, ['admin']);
  const input = listAccountsInput.parse(raw);
  const db = getDb();
  const suspended = sql<boolean>`(${authUser.banned} AND (${authUser.banExpires} IS NULL OR ${authUser.banExpires} > now()))`;
  const conditions: SQL[] = [sql`${authUser.email} NOT LIKE ${`%@${ERASED_EMAIL_DOMAIN}`}`];
  if (input.q) {
    const pattern = likePattern(input.q);
    conditions.push(or(ilike(authUser.email, pattern), ilike(personName.value, pattern))!);
  }
  if (input.role) conditions.push(eq(authUser.role, input.role));
  if (input.state === 'suspended') conditions.push(suspended);
  if (input.state === 'unconfirmed') conditions.push(eq(authUser.emailVerified, false));
  if (input.state === 'staff') conditions.push(sql`${authUser.role} <> 'user'`);
  const where = and(...conditions);
  const order = {
    newest: [desc(authUser.createdAt), asc(authUser.id)],
    oldest: [asc(authUser.createdAt), asc(authUser.id)],
    email: [asc(authUser.email), asc(authUser.id)],
    active: [sql`${authUser.lastActiveAt} DESC NULLS LAST`, asc(authUser.id)],
  }[input.sort];

  const from = () =>
    db
      .select({
        id: authUser.id,
        email: authUser.email,
        name: personName.value,
        nameLang: personName.lang,
        personSlug: person.slug,
        role: authUser.role,
        accountType: authUser.accountType,
        emailVerified: authUser.emailVerified,
        twoFactorEnabled: authUser.twoFactorEnabled,
        suspended,
        createdAt: authUser.createdAt,
        lastActiveAt: authUser.lastActiveAt,
      })
      .from(authUser)
      .leftJoin(person, and(eq(person.claimedByUserId, authUser.id), isNull(person.deletedAt)))
      .leftJoin(personName, and(eq(personName.personId, person.id), eq(personName.isPrimary, true)));

  const [[totalRow], firstRows] = await Promise.all([
    db
      .select({ n: count() })
      .from(authUser)
      .leftJoin(person, and(eq(person.claimedByUserId, authUser.id), isNull(person.deletedAt)))
      .leftJoin(personName, and(eq(personName.personId, person.id), eq(personName.isPrimary, true)))
      .where(where),
    from()
      .where(where)
      .orderBy(...order)
      .limit(ACCOUNT_PAGE_SIZE)
      .offset((input.page - 1) * ACCOUNT_PAGE_SIZE),
  ]);
  const total = totalRow?.n ?? 0;
  const pages = Math.max(1, Math.ceil(total / ACCOUNT_PAGE_SIZE));
  return {
    rows: firstRows.map((r) => ({
      id: r.id,
      email: r.email,
      name: r.name,
      nameLang: r.nameLang,
      personSlug: r.personSlug,
      role: r.role,
      accountType: r.accountType,
      emailVerified: r.emailVerified,
      twoFactorEnabled: r.twoFactorEnabled,
      suspended: Boolean(r.suspended),
      createdAt: r.createdAt.toISOString(),
      lastActiveAt: r.lastActiveAt?.toISOString() ?? null,
    })),
    total,
    page: input.page,
    pages,
    pageSize: ACCOUNT_PAGE_SIZE,
  };
}
