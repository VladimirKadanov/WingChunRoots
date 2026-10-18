// Milestone M01b, Done when 3: every template renders its sample data to HTML and to plain text,
// has a subject and leaves no unreplaced variable; names keep their `lang` attribute.

import { describe, expect, it } from 'vitest';

import { EMAIL_TEMPLATES, type EmailTemplate, renderEmail, TemplateDataError, type NameData } from './email';
import { NOTIFICATION_TEMPLATES, NotificationDataError, renderNotification } from './notifications';

// What a missing or mistyped variable leaves behind in the output.
const UNREPLACED = /\{\{|\}\}|\$\{|\bundefined\b|\bnull\b|\bNaN\b|\[object Object\]/;

/** Every string the sample data shows, however deeply nested (a name's `lang` is an attribute). */
function strings(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(strings);
  if (value && typeof value === 'object') {
    return Object.entries(value).flatMap(([key, v]) => (key === 'lang' ? [] : strings(v)));
  }
  return [];
}

/** Every name ({ value, lang }) in the sample data. */
function names(value: unknown): NameData[] {
  if (Array.isArray(value)) return value.flatMap(names);
  if (value && typeof value === 'object') {
    const { value: text, lang } = value as Partial<NameData>;
    if (typeof text === 'string' && typeof lang === 'string') return [{ value: text, lang }];
    return Object.values(value).flatMap(names);
  }
  return [];
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;');

describe('e-mail templates', () => {
  const entries = Object.entries(EMAIL_TEMPLATES) as [keyof typeof EMAIL_TEMPLATES, EmailTemplate<unknown>][];

  it('the registry is not empty and every key is the template name', () => {
    expect(entries.length).toBeGreaterThan(0);
    for (const [key, template] of entries) expect(template.name).toBe(key);
  });

  for (const [name, template] of entries) {
    describe(name, () => {
      it('renders the sample data to HTML and plain text with a subject and no unreplaced variable', async () => {
        const email = await renderEmail(name, template.sample);
        expect(email.subject.trim().length).toBeGreaterThan(0);
        expect(email.subject).not.toMatch(/\n/);
        expect(email.html).toMatch(/^<!DOCTYPE html/i);
        expect(email.html).toMatch(/<html[^>]*\blang="en"/);
        expect(email.text.trim().length).toBeGreaterThan(0);
        expect(email.text).not.toMatch(/<[a-z!/][^>]*>/i);
        for (const [part, value] of Object.entries(email)) expect(value, part).not.toMatch(UNREPLACED);
        expect(template.preview(template.sample)).not.toMatch(UNREPLACED);
        for (const s of strings(template.sample)) {
          expect(email.text, `text contains ${s}`).toContain(s);
        }
      });

      it('shows every name with its lang attribute and translate="no"', async () => {
        const { html } = await renderEmail(name, template.sample);
        const sampleNames = names(template.sample);
        expect(sampleNames.length).toBeGreaterThan(0);
        for (const n of sampleNames) {
          expect(html).toContain(`<span lang="${n.lang}" translate="no">${escapeHtml(n.value)}</span>`);
        }
      });

      it('parses its own sample data unchanged', () => {
        expect(template.parse(template.sample)).toEqual(template.sample);
      });

      it('parses its parsed data to the same value (the outbox stores parsed data; the worker parses it again)', () => {
        const once = template.parse(template.sample);
        expect(template.parse(JSON.parse(JSON.stringify(once)))).toStrictEqual(once);
      });
    });
  }

  it('refuses an unknown template and data the template cannot render', async () => {
    await expect(renderEmail('no-such-template', {})).rejects.toBeInstanceOf(TemplateDataError);
    await expect(renderEmail('mail-check', null)).rejects.toBeInstanceOf(TemplateDataError);
    await expect(renderEmail('mail-check', { recipientNames: [] })).rejects.toThrow(/1 to 4 names/);
    await expect(renderEmail('mail-check', { recipientNames: [{ value: '示範學生', lang: 'zh-Hant' }] })).rejects.toThrow(
      /Latin-script/,
    );
    await expect(renderEmail('mail-check', { recipientNames: [{ value: 'Demo Student', lang: 'not a tag' }] })).rejects.toThrow(
      /BCP 47/,
    );
  });

  it('mail-check without recipient names greets without a name (pnpm mail:check without --name)', async () => {
    expect(EMAIL_TEMPLATES['mail-check'].parse({})).toStrictEqual({});
    const { text, html } = await renderEmail('mail-check', {});
    expect(text).toContain('Hello,');
    expect(html).not.toContain('translate="no"');
  });

  it('escapes markup in the data', async () => {
    const { html } = await renderEmail('mail-check', { recipientNames: [{ value: 'Demo <b>Student</b>', lang: 'en' }] });
    expect(html).not.toContain('<b>Student</b>');
    expect(html).toContain('Demo &lt;b&gt;Student&lt;/b&gt;');
  });
});

describe('account e-mails (M02)', () => {
  const cases = [
    { name: 'verify-email', path: '/verify-email', subject: /Confirm your e-mail address/ },
    { name: 'reset-password', path: '/reset-password', subject: /Reset your WingChunRoots password/ },
    { name: 'finish-sign-up', path: '/reset-password', subject: /Finish creating your WingChunRoots account/ },
  ] as const;

  for (const { name, path, subject } of cases) {
    describe(name, () => {
      const url = `http://127.0.0.1:3100${path}?token=demo-token-123`;

      it('without names (before onboarding) parses to data that parses again', () => {
        const once = EMAIL_TEMPLATES[name].parse({ url, expiresInHours: 1 });
        expect(once).toStrictEqual({ url, expiresInHours: 1 });
        expect(EMAIL_TEMPLATES[name].parse(JSON.parse(JSON.stringify(once)))).toStrictEqual(once);
      });

      it('shows the link as a button and as text, and how long it works, without a name before onboarding', async () => {
        const email = await renderEmail(name, { url, expiresInHours: 1 });
        expect(email.subject).toMatch(subject);
        expect(email.html).toContain(`href="${url.replaceAll('&', '&amp;')}"`);
        expect(email.text).toContain(url);
        expect(email.text).toContain('Hello,');
        expect(email.text).toContain('1 hour ');
        expect(email.html).not.toContain('translate="no"');
      });

      it('refuses a link to another page, without a token or not over http(s), and odd lifetimes', async () => {
        await expect(renderEmail(name, { url: 'http://127.0.0.1:3100/elsewhere?token=x', expiresInHours: 1 })).rejects.toThrow(
          new RegExp(`point at ${path}`),
        );
        await expect(renderEmail(name, { url: `http://127.0.0.1:3100${path}`, expiresInHours: 1 })).rejects.toThrow(/with a token/);
        await expect(renderEmail(name, { url: `javascript:alert(1)//${path}?token=x`, expiresInHours: 1 })).rejects.toThrow(/http\(s\)/);
        await expect(renderEmail(name, { url, expiresInHours: 0 })).rejects.toThrow(/hours/);
        await expect(renderEmail(name, { url, expiresInHours: 1.5 })).rejects.toThrow(/hours/);
        await expect(renderEmail(name, { url })).rejects.toBeInstanceOf(TemplateDataError);
      });
    });
  }
});

describe('notification templates', () => {
  const entries = Object.entries(NOTIFICATION_TEMPLATES);

  it('the registry is not empty and every key is the template name', () => {
    expect(entries.length).toBeGreaterThan(0);
    for (const [key, template] of entries) expect(template.name).toBe(key);
  });

  for (const [name, template] of entries) {
    it(`${name} renders the sample data with a title, a body and no unreplaced variable`, () => {
      const rendered = renderNotification(name, template.sample);
      expect(rendered.title.trim().length).toBeGreaterThan(0);
      expect(rendered.body.length).toBeGreaterThan(0);
      expect(rendered.title).not.toMatch(UNREPLACED);
      for (const segment of rendered.body) {
        const text = 'text' in segment ? segment.text : segment.name.value;
        expect(text.trim().length).toBeGreaterThan(0);
        expect(text).not.toMatch(UNREPLACED);
      }
    });
  }

  it('refuses an unknown template', () => {
    expect(() => renderNotification('no-such-template', {})).toThrow(NotificationDataError);
  });

  it('links only to a local path of the app (M08)', () => {
    for (const [name, template] of entries) {
      const { action } = renderNotification(name, template.sample);
      if (!action) continue;
      expect(action.label.trim().length, name).toBeGreaterThan(0);
      expect(action.href, name).toMatch(/^\/(?!\/)[^\s\\]*$/);
    }
  });

  it('the plan notifications refuse a plan an admin cannot grant, a request id that is not one and odd names (M08)', () => {
    const sample = NOTIFICATION_TEMPLATES['pilot-access.requested'].sample;
    expect(() => renderNotification('pilot-access.requested', { ...sample, planCode: 'federation' })).toThrow(NotificationDataError);
    expect(() => renderNotification('pilot-access.requested', { ...sample, requestId: '../users' })).toThrow(NotificationDataError);
    expect(() => renderNotification('pilot-access.requested', { ...sample, requester: { value: 'Demo', lang: '"><b>' } })).toThrow(NotificationDataError);
    expect(renderNotification('pilot-access.requested', { ...sample, requester: null }).body[0]).toEqual({ text: 'An account without a profile' });
    expect(() => renderNotification('plan.granted', { planCode: 'pro_sifu', endsAt: 'tomorrow' })).toThrow(NotificationDataError);
    expect(() => renderNotification('plan.revoked', null)).toThrow(NotificationDataError);
  });

  it('the plan notifications promise no payment and keep confirmed links (M08)', () => {
    const granted = renderNotification('plan.granted', { planCode: 'pro_sifu', endsAt: '2026-12-31T00:00:00.000Z' });
    expect(granted.body.map((segment) => ('text' in segment ? segment.text : '')).join('')).toContain('until 31 December 2026. No payment is involved.');
    const revoked = renderNotification('plan.revoked', { planCode: 'pro_sifu' });
    expect(revoked.body.map((segment) => ('text' in segment ? segment.text : '')).join('')).toContain('Every confirmed link stays confirmed and public');
  });
});

describe('account-exists (M02)', () => {
  const data = { signInUrl: 'http://127.0.0.1:3100/sign-in', resetUrl: 'http://127.0.0.1:3100/reset-password' };

  it('links to sign-in and to a new password, with no token', async () => {
    const email = await renderEmail('account-exists', data);
    expect(email.subject).toBe('You already have a WingChunRoots account');
    expect(email.html).toContain('href="http://127.0.0.1:3100/sign-in"');
    expect(email.html).toContain('href="http://127.0.0.1:3100/reset-password"');
    expect(email.text).toContain('nothing was changed');
  });

  it('refuses links elsewhere, with a query or not over http(s)', async () => {
    await expect(renderEmail('account-exists', { ...data, signInUrl: 'http://127.0.0.1:3100/account' })).rejects.toThrow(/point at \/sign-in/);
    await expect(renderEmail('account-exists', { ...data, resetUrl: 'http://127.0.0.1:3100/reset-password?token=x' })).rejects.toThrow(
      /point at \/reset-password/,
    );
    await expect(renderEmail('account-exists', { ...data, signInUrl: 'javascript:alert(1)//sign-in' })).rejects.toThrow(/http\(s\)/);
  });
});

describe('secret fields (M02 fix round 1)', () => {
  it('every template whose data carries a token declares it secret, so the outbox seals it', () => {
    for (const [name, template] of Object.entries(EMAIL_TEMPLATES) as [string, EmailTemplate<unknown>][]) {
      const tokenFields = Object.entries(template.sample as Record<string, unknown>)
        .filter(([, value]) => typeof value === 'string' && /[?&]token=/.test(value))
        .map(([field]) => field);
      expect(template.secretFields ?? [], name).toEqual(tokenFields);
    }
  });
});
