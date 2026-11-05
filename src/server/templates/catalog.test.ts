// The notification catalog (milestone M18, In scope 1, 2, 3, 9): every kind of notice has one entry,
// a category, a channel and a text; the categories that cannot be switched off are e-mailed always;
// the limit notice is never e-mailed; and no code writes a notice past notify().

import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

import { describe, expect, it } from 'vitest';

import { findFomo } from '../../lib/copy/no-fomo';
import { CATEGORIES, catalogEntry, emailWanted, isNotificationCategory, isNotificationKind, kindsOf, NOTIFICATION_CATALOG, NOTIFICATION_CATEGORIES, type NotificationKind } from './catalog';
import { EMAIL_TEMPLATES } from './email';
import { NOTIFICATION_TEMPLATES, renderNotification } from './notifications';

const KINDS = Object.keys(NOTIFICATION_CATALOG) as NotificationKind[];
const ROOT = join(import.meta.dirname, '..', '..', '..');

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return files(path);
    return /\.(ts|tsx)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

describe('notification catalog', () => {
  it('has exactly one entry for every notification template, and a template for every entry', () => {
    expect(KINDS.slice().sort()).toEqual(Object.keys(NOTIFICATION_TEMPLATES).sort());
    for (const kind of KINDS) expect(isNotificationKind(kind)).toBe(true);
    expect(isNotificationKind('no.such-kind')).toBe(false);
  });

  it('puts every kind in one of the eight categories, and every category has a kind', () => {
    expect(NOTIFICATION_CATEGORIES).toEqual(['security', 'account', 'plan', 'teaching', 'review', 'schools', 'organizations', 'events']);
    for (const kind of KINDS) expect(isNotificationCategory(catalogEntry(kind).category), kind).toBe(true);
    for (const category of NOTIFICATION_CATEGORIES) expect(kindsOf(category).length, category).toBeGreaterThan(0);
  });

  it('names only e-mail templates that exist', () => {
    for (const kind of KINDS) {
      const { email } = catalogEntry(kind);
      if (email !== null) expect(Object.keys(EMAIL_TEMPLATES), kind).toContain(email);
    }
  });

  it('never lets security or the account notices be switched off, and e-mails them by default', () => {
    for (const category of ['security', 'account'] as const) {
      expect(CATEGORIES[category].optOut).toBe(false);
      expect(CATEGORIES[category].emailDefault).toBe(true);
    }
    for (const kind of kindsOf('security')) {
      expect(catalogEntry(kind).email, kind).not.toBeNull();
      expect(emailWanted(kind, false), kind).toBe(true);
    }
    expect(emailWanted('content.removed', false)).toBe(true);
  });

  it('has e-mail on by default for plan, teaching, review, schools and organizations, and off for events (DEFAULT M18, question 1)', () => {
    for (const category of ['plan', 'teaching', 'review', 'schools', 'organizations'] as const) {
      expect(CATEGORIES[category].optOut).toBe(true);
      expect(CATEGORIES[category].emailDefault).toBe(true);
    }
    expect(CATEGORIES.events.optOut).toBe(true);
    expect(CATEGORIES.events.emailDefault).toBe(false);
    expect(emailWanted('event.published', undefined)).toBe(false);
    expect(emailWanted('event.published', true)).toBe(true);
    expect(emailWanted('plan.expiring', undefined)).toBe(true);
    expect(emailWanted('plan.expiring', false)).toBe(false);
  });

  it('never e-mails the limit notice, whatever the account chose (In scope 5)', () => {
    expect(catalogEntry('limit.reached').email).toBeNull();
    expect(emailWanted('limit.reached', true)).toBe(false);
    expect(emailWanted('limit.reached', undefined)).toBe(false);
  });

  it('e-mails the new notices of M18 with the generic notice e-mail', () => {
    for (const kind of [
      'security.password-changed',
      'security.two-factor-enabled',
      'security.two-factor-disabled',
      'security.backup-codes',
      'security.email-changed',
      'plan.expiring',
      'plan.expired',
      'content.removed',
      'relationship.ended',
      'invitation.claimed',
      'school.reviewed',
      'organization.reviewed',
    ] as const) {
      expect(catalogEntry(kind).email, kind).toBe('notice');
    }
  });

  it('renders every sample without urgency, scarcity or a countdown (CLAUDE.md §11)', () => {
    for (const kind of KINDS) {
      const template = NOTIFICATION_TEMPLATES[kind];
      const rendered = renderNotification(kind, template.sample, { createdAt: new Date(Date.UTC(2026, 9, 1)) });
      const text = [rendered.title, ...rendered.body.map((s) => ('text' in s ? s.text : 'Name')), rendered.action?.label ?? ''].join(' ');
      expect(findFomo(text), kind).toEqual([]);
    }
  });

  it('the security notices name no address, IP address or place', () => {
    for (const kind of kindsOf('security')) {
      const template = NOTIFICATION_TEMPLATES[kind];
      const rendered = renderNotification(kind, template.sample, { createdAt: new Date(Date.UTC(2026, 9, 1)) });
      const text = [rendered.title, ...rendered.body.map((s) => ('text' in s ? s.text : ''))].join(' ');
      expect(text, kind).not.toMatch(/@|\b\d{1,3}(\.\d{1,3}){3}\b|\bIP\b|location/i);
    }
  });

  it('no code but notify() writes a notice (In scope 2)', () => {
    const writers = files(join(ROOT, 'src'))
      .filter((file) => /\.insert\(\s*notification\s*\)|INSERT INTO notification\b/.test(readFileSync(file, 'utf8')))
      .map((file) => relative(ROOT, file).split(sep).join('/'));
    expect(writers).toEqual(['src/server/services/notify.ts']);
  });
});
